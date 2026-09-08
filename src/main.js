import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';
import { chromium } from 'patchright';

const DEFAULT_START_URL = 'https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html';
const TRIPADVISOR_GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';
const HOTEL_LIST_QUERY_ID = process.env.TRIPADVISOR_LIST_QUERY_ID || 'f101de74ce917363';
const RATING_HISTOGRAM_QUERY_ID = 'b6d4e00c5b27f98e';
const SUBRATINGS_QUERY_ID = '6d1d0d458eddcc5f';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_MAX_PAGES = 5;
const DEFAULT_RESULTS_WANTED = 20;
const LIST_PAGE_SIZE = 30;
const MAX_PAGES_LIMIT = 200;
const MAX_START_URLS = 10000;
const MAX_ROOMS = 20;
const MAX_GUESTS = 50;
const MAX_CHILDREN = 20;
const PAGE_STALL_THRESHOLD = 2;
const REQUEST_TIMEOUT_MS = 60000;
const BROWSER_DISCOVERY_TIMEOUT_MS = 45000;
const RETRYABLE_STATUS_CODES = new Set([408, 413, 429, 500, 502, 503, 504, 521, 522, 524]);

const DEFAULT_SORT = 'BEST_VALUE';
const SUPPORTED_SORTS = new Set([
    'BEST_VALUE',
    'PRICE_LOW_TO_HIGH',
    'DISTANCE',
    'POPULARITY',
]);

const DEFAULT_LIST_FILTERS = {
    selectTravelersChoiceWinner: false,
    selectTravelersChoiceBOTBWinner: false,
    minRating: null,
    neighborhoodsOrNear: null,
    priceRange: null,
    amenities: null,
    brands: null,
    classes: null,
    styles: null,
    hoteltypes: null,
    categories: null,
    anyTags: null,
    hotelowners: null,
};

await Actor.init();

function wait(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function fetchWithRetry(client, url, options = {}, label = 'request') {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await client.fetch(url, {
                timeout: REQUEST_TIMEOUT_MS,
                ...options,
            });

            if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === maxAttempts) return response;

            const delay = Math.min(attempt * 1500 + Math.random() * 750, 6000);
            log.warning(`${label} returned HTTP ${response.status}; retrying (${attempt}/${maxAttempts}).`);
            await wait(delay);
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            const delay = Math.min(attempt * 1000 + Math.random() * 500, 4000);
            log.warning(`${label} failed; retrying (${attempt}/${maxAttempts}): ${error.message}`);
            await wait(delay);
        }
    }

    throw new Error(`${label} failed after ${maxAttempts} attempts.`);
}

function buildRandomRequestedBy(length = 180) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let index = 0; index < length; index++) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return value;
}

function sanitizeString(value) {
    if (typeof value !== 'string') return value;
    const withoutControlCharacters = [...value]
        .filter((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint >= 32 && codePoint !== 127 && (codePoint < 0xFFF9 || codePoint > 0xFFFB);
        })
        .join('');
    const cleaned = withoutControlCharacters
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || undefined;
}

function compactValue(value) {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

    if (Array.isArray(value)) {
        const compacted = value.map(compactValue).filter((item) => item !== undefined);
        return compacted.length ? compacted : undefined;
    }

    if (typeof value === 'object') {
        const compacted = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            const cleanValue = compactValue(nestedValue);
            if (cleanValue !== undefined) compacted[key] = cleanValue;
        }
        return Object.keys(compacted).length ? compacted : undefined;
    }

    return value;
}

function compactRecord(record) {
    return compactValue(record) || {};
}

function toPositiveInteger(value, fallback, maximum) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1) return fallback;
    const integerValue = Math.floor(numericValue);
    return maximum ? Math.min(integerValue, maximum) : integerValue;
}

function validNumber(value, minimum, maximum) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return undefined;
    if (minimum !== undefined && numericValue < minimum) return undefined;
    if (maximum !== undefined && numericValue > maximum) return undefined;
    return numericValue;
}

function validInteger(value, minimum = 0) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue < minimum) return undefined;
    return numericValue;
}

function absoluteTripadvisorUrl(pathOrUrl) {
    const value = sanitizeString(String(pathOrUrl || ''));
    if (!value) return undefined;

    try {
        const parsed = new URL(value, 'https://www.tripadvisor.com');
        if (!parsed.hostname.toLowerCase().includes('tripadvisor.')) return undefined;
        parsed.protocol = 'https:';
        parsed.hostname = 'www.tripadvisor.com';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return undefined;
    }
}

function convertPhotoTemplateToAbsoluteUrl(template, width = 1200, height = 800) {
    const value = sanitizeString(String(template || ''));
    if (!value) return undefined;
    return value.replace('{width}', String(width)).replace('{height}', String(height));
}

function toCookieHeader(setCookieHeader) {
    if (!Array.isArray(setCookieHeader)) return undefined;
    const cookies = setCookieHeader
        .map((cookie) => String(cookie).split(';')[0]?.trim())
        .filter(Boolean);
    return cookies.length ? cookies.join('; ') : undefined;
}

function extractGeoIdFromUrl(url) {
    const value = String(url || '');
    const geoMatch = value.match(/(?:^|[-_/])g(\d+)(?:[-_/]|$)/i);
    if (geoMatch?.[1]) return Number(geoMatch[1]);

    try {
        const parsed = new URL(value);
        const queryGeo = parsed.searchParams.get('geo') || parsed.searchParams.get('geoId');
        if (queryGeo && Number.isFinite(Number(queryGeo))) return Number(queryGeo);
    } catch {
        return undefined;
    }

    return undefined;
}

function decodeBase64UrlSafe(value) {
    const source = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const missingPadding = source.length % 4;
    const padded = missingPadding ? source.padEnd(source.length + (4 - missingPadding), '=') : source;
    return Buffer.from(padded, 'base64').toString('utf8');
}

function extractDecodedClientLink(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const wrapped = parsed.searchParams.get('value');
        if (!wrapped) return undefined;
        const decoded = decodeBase64UrlSafe(decodeURIComponent(wrapped));
        const pathMatch = decoded.match(/(\/(?:Hotels|HotelsList|Hotel_Review)[^\s]*?\.html)/i);
        return pathMatch?.[1] ? `https://www.tripadvisor.com${pathMatch[1]}` : undefined;
    } catch {
        return undefined;
    }
}

function normalizeTripadvisorUrl(candidate) {
    if (typeof candidate !== 'string') return undefined;
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;

    const candidateValue = extractDecodedClientLink(trimmed) || trimmed;
    let withProtocol = candidateValue;
    if (!/^https?:\/\//i.test(candidateValue)) {
        withProtocol = candidateValue.startsWith('//') ? `https:${candidateValue}` : `https://${candidateValue}`;
    }

    let parsed;
    try {
        parsed = new URL(withProtocol);
    } catch {
        return undefined;
    }

    if (!parsed.hostname.toLowerCase().includes('tripadvisor.')) return undefined;
    parsed.protocol = 'https:';
    parsed.hostname = 'www.tripadvisor.com';
    parsed.hash = '';

    const geoId = extractGeoIdFromUrl(parsed.toString());
    if (geoId && /\/Hotel_Review-/i.test(parsed.pathname)) {
        parsed.pathname = `/Hotels-g${geoId}-Hotels.html`;
        parsed.search = '';
    }

    const safeQuery = new URLSearchParams();
    const queryGeo = parsed.searchParams.get('geo') || parsed.searchParams.get('geoId');
    if (queryGeo && Number.isFinite(Number(queryGeo))) safeQuery.set('geo', String(Number(queryGeo)));
    parsed.search = safeQuery.toString();
    return parsed.toString();
}

function splitPossibleUrls(rawValue) {
    if (typeof rawValue !== 'string') return [];
    const value = rawValue.trim();
    if (!value) return [];

    const strictMatches = value.match(/https?:\/\/[^\s,;]+/gi);
    if (strictMatches?.length) return strictMatches;
    const domainMatches = value.match(/(?:www\.)?tripadvisor\.[^\s,;]+/gi);
    return domainMatches?.length ? domainMatches : [value];
}

function collectUrlCandidates(value, output, depth = 0) {
    if (depth > 6 || value === null || value === undefined) return;

    if (typeof value === 'string') {
        output.push(...splitPossibleUrls(value));
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) collectUrlCandidates(item, output, depth + 1);
        return;
    }

    if (typeof value === 'object') {
        for (const key of ['url', 'href', 'link', 'startUrl', 'startURL', 'start_url']) {
            collectUrlCandidates(value[key], output, depth + 1);
        }
        for (const key of ['startUrls', 'urls', 'items', 'records', 'data']) {
            collectUrlCandidates(value[key], output, depth + 1);
        }
    }
}

function normalizeDestinationGeoId(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const numericValue = Number(value);
    if (Number.isInteger(numericValue) && numericValue > 0) return numericValue;
    return extractGeoIdFromUrl(value);
}

function normalizeStartUrls(input, destinationGeoId) {
    const candidates = [];
    collectUrlCandidates(input?.startUrls, candidates);
    collectUrlCandidates(input?.start_urls, candidates);
    collectUrlCandidates(input?.startUrl, candidates);
    collectUrlCandidates(input?.url, candidates);
    collectUrlCandidates(input?.urls, candidates);
    if (!candidates.length && destinationGeoId) {
        candidates.push(`https://www.tripadvisor.com/Hotels-g${destinationGeoId}-Hotels.html`);
    }
    if (!candidates.length) candidates.push(DEFAULT_START_URL);

    const normalized = [];
    const seen = new Set();
    for (const candidate of candidates) {
        const url = normalizeTripadvisorUrl(candidate);
        if (!url || seen.has(url.toLowerCase())) continue;
        seen.add(url.toLowerCase());
        normalized.push(url);
        if (normalized.length >= MAX_START_URLS) break;
    }

    return normalized.length ? normalized : [DEFAULT_START_URL];
}

async function readJsonFileIfExists(filePath) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code !== 'ENOENT') log.warning(`Could not read ${filePath}: ${error.message}`);
        return {};
    }
}

function formatDateAsIso(date) {
    return date.toISOString().slice(0, 10);
}

function getDefaultTravelDates() {
    const checkIn = new Date();
    checkIn.setUTCHours(0, 0, 0, 0);
    checkIn.setUTCDate(checkIn.getUTCDate() + 1);
    const checkOut = new Date(checkIn);
    checkOut.setUTCDate(checkOut.getUTCDate() + 1);
    return {
        checkInDate: formatDateAsIso(checkIn),
        checkOutDate: formatDateAsIso(checkOut),
    };
}

function normalizeDate(value) {
    const date = sanitizeString(value);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || formatDateAsIso(parsed) !== date) return undefined;
    return date;
}

function normalizeChildrenAges(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((age) => validInteger(age, 0))
        .filter((age) => age !== undefined && age <= 17)
        .slice(0, MAX_CHILDREN);
}

function buildTravelInfo(input) {
    const rawCheckInDate = input.checkInDate ?? input.check_in;
    const rawCheckOutDate = input.checkOutDate ?? input.check_out;
    const checkInDate = normalizeDate(rawCheckInDate);
    const checkOutDate = normalizeDate(rawCheckOutDate);
    const hasDateInput = rawCheckInDate !== undefined || rawCheckOutDate !== undefined;
    const hasValidDateRange = checkInDate && checkOutDate && checkOutDate > checkInDate;
    const rooms = toPositiveInteger(input.rooms, undefined, MAX_ROOMS);
    const guests = toPositiveInteger(input.guests ?? input.adults, undefined, MAX_GUESTS);
    const childrenAges = normalizeChildrenAges(input.childrenAges ?? input.childAges);
    const hasOccupancyInput = rooms !== undefined || guests !== undefined || childrenAges.length > 0;

    if (!hasDateInput && !hasOccupancyInput) return undefined;
    if (hasDateInput && !hasValidDateRange) {
        log.warning('Ignoring the date filter because checkInDate/checkOutDate must be valid YYYY-MM-DD dates with checkout after check-in.');
    }

    const defaultDates = getDefaultTravelDates();
    return {
        usedDefaultDates: !hasValidDateRange,
        checkInDate: hasValidDateRange ? checkInDate : defaultDates.checkInDate,
        checkOutDate: hasValidDateRange ? checkOutDate : defaultDates.checkOutDate,
        rooms: rooms || 1,
        adults: guests || 2,
        childrenAges,
    };
}

function normalizeSort(value) {
    const requested = sanitizeString(value);
    if (!requested) return DEFAULT_SORT;
    const normalized = requested.toUpperCase().replace(/[\s-]+/g, '_');
    if (SUPPORTED_SORTS.has(normalized)) return normalized;
    log.warning(`Unsupported sorting value "${requested}"; using ${DEFAULT_SORT}.`);
    return DEFAULT_SORT;
}

function buildListVariables({
    geoId,
    offset,
    requestNumber,
    pageviewId,
    sessionId,
    travelInfo,
    sorting,
    template = {},
}) {
    return {
        ...template,
        geoId,
        blenderId: template.blenderId ?? null,
        boundingBox: template.boundingBox ?? null,
        centerAndRadius: template.centerAndRadius ?? null,
        travelInfo: travelInfo ?? null,
        currency: template.currency || DEFAULT_CURRENCY,
        pricingMode: template.pricingMode ?? null,
        filters: { ...DEFAULT_LIST_FILTERS, ...(template.filters || {}) },
        offset,
        limit: LIST_PAGE_SIZE,
        sort: sorting || DEFAULT_SORT,
        clientType: 'DESKTOP',
        loadMapSpecificData: false,
        viewType: 'LIST',
        productId: 'Hotels',
        pageviewId,
        sessionId,
        route: {
            page: 'HotelsFusion',
            params: {
                ...(template.route?.params || {}),
                geoId,
                contentType: 'hotel',
                webVariant: 'HotelsFusion',
            },
        },
        userEngagedFilters: false,
        loadPoiThumbnail: false,
        loadLocationSEOData: true,
        loadLocationInfoData: false,
        loadNearbyPointOfInterestPlaceType: false,
        metaMarketingQueryString: '',
        loadReviewSubratingAvgs: false,
        isSplitMapView: false,
        polling: false,
        tertiaryOffers: false,
        includePhotoSizes: false,
        requestNumber,
    };
}

async function initializeSession({ client, startUrl }) {
    const response = await fetchWithRetry(client, startUrl, {}, 'Session bootstrap');
    return {
        cookieHeader: toCookieHeader(response.headers.getSetCookie?.()),
        resolvedUrl: response.url || startUrl,
        statusCode: response.status,
    };
}

async function postGraphql({ client, cookieHeader, startUrl, operations, label }) {
    const response = await fetchWithRetry(client, TRIPADVISOR_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: 'https://www.tripadvisor.com',
            referer: startUrl,
            'x-requested-by': buildRandomRequestedBy(),
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(operations),
    }, label);

    if (response.status >= 400) throw new Error(`${label} returned HTTP ${response.status}.`);

    try {
        return await response.json();
    } catch (error) {
        throw new Error(`${label} returned malformed JSON: ${error.message}`);
    }
}

async function fetchHotelListPage({
    client,
    cookieHeader,
    startUrl,
    geoId,
    offset,
    requestNumber,
    pageviewId,
    sessionId,
    queryId,
    variablesTemplate,
    travelInfo,
    sorting,
}) {
    const variables = buildListVariables({
        geoId,
        offset,
        requestNumber,
        pageviewId,
        sessionId,
        travelInfo,
        sorting,
        template: variablesTemplate,
    });
    const response = await postGraphql({
        client,
        cookieHeader,
        startUrl,
        label: `Hotel list page ${requestNumber}`,
        operations: [{ variables, extensions: { preRegisteredQueryId: queryId } }],
    });

    const operation = response?.[0];
    const graphqlError = operation?.errors?.map((error) => error?.message).filter(Boolean).join(' | ');
    if (graphqlError) throw new Error(`Hotel list GraphQL error: ${graphqlError}`);

    const list = operation?.data?.list;
    if (!list || !Array.isArray(list.results)) {
        const keys = Object.keys(operation?.data || {}).join(', ') || 'none';
        throw new Error(`Hotel list response missing data.list.results. Data keys: ${keys}.`);
    }

    return list;
}

function toPatchrightProxy(proxyUrl) {
    if (!proxyUrl) return undefined;
    try {
        const parsed = new URL(proxyUrl);
        return compactRecord({
            server: `${parsed.protocol}//${parsed.host}`,
            username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
            password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
        });
    } catch {
        return { server: proxyUrl };
    }
}

function isHotelListOperation(operation) {
    const variables = operation?.variables;
    return Boolean(
        variables
        && Number.isFinite(Number(variables.offset))
        && Number.isFinite(Number(variables.limit))
        && Number.isFinite(Number(variables.geoId))
        && variables.productId === 'Hotels',
    );
}

async function discoverHotelListOperation({ startUrl, proxyUrl }) {
    log.warning('The stored hotel-list operation changed. Starting Patchright discovery.');
    const context = await chromium.launchPersistentContext('', {
        channel: 'chrome',
        headless: false,
        noViewport: true,
        proxy: toPatchrightProxy(proxyUrl),
    });
    const page = context.pages()[0] || await context.newPage();

    let resolveCapture;
    let rejectCapture;
    const capturePromise = new Promise((resolve, reject) => {
        resolveCapture = resolve;
        rejectCapture = reject;
    });
    const timeout = setTimeout(() => {
        rejectCapture(new Error('Timed out waiting for a paginated TripAdvisor hotel-list operation.'));
    }, BROWSER_DISCOVERY_TIMEOUT_MS);

    page.on('request', async (request) => {
        if (!request.url().includes('/data/graphql/ids')) return;
        try {
            const operations = JSON.parse(request.postData() || '[]');
            for (const operation of operations) {
                const queryId = operation?.extensions?.preRegisteredQueryId;
                if (!queryId || !isHotelListOperation(operation)) continue;
                resolveCapture({
                    queryId,
                    variablesTemplate: operation.variables,
                    cookieHeader: (await context.cookies()).map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
                });
                return;
            }
        } catch {
            // Ignore unrelated or unreadable GraphQL responses during discovery.
        }
    });

    try {
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: REQUEST_TIMEOUT_MS });
        const capture = await capturePromise;
        log.info('Patchright discovered a working paginated hotel-list operation.');
        return capture;
    } finally {
        clearTimeout(timeout);
        await context.close().catch(() => {});
    }
}

async function discoverHotelListQueryFromAssets({ client, startUrl }) {
    log.warning('Patchright discovery was challenged. Checking the public Hotels page assets.');
    const pageResponse = await fetchWithRetry(client, startUrl, {}, 'Hotels asset page');
    if (pageResponse.status >= 400) {
        throw new Error(`Hotels asset page returned HTTP ${pageResponse.status}.`);
    }
    const pageBody = await pageResponse.text();
    const scriptUrls = [...new Set(
        [...pageBody.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
            .map((match) => new URL(match[1], startUrl).href),
    )];
    if (!scriptUrls.length) throw new Error('No script assets were found on the Hotels page.');

    const queryPatterns = [
        /data\?\.list\?\.isComplete[\s\S]{0,500}?id:"([0-9a-f]{16})"/,
        /data\?\.list\?\.results\?\.length===0[\s\S]{0,500}?id:"([0-9a-f]{16})"/,
    ];

    for (let index = 0; index < scriptUrls.length; index += 8) {
        const batch = scriptUrls.slice(index, index + 8);
        const candidates = await Promise.all(batch.map(async (scriptUrl) => {
            try {
                const response = await fetchWithRetry(client, scriptUrl, {}, `Hotel asset ${index + 1}`);
                if (response.status >= 400) return undefined;
                const responseBody = await response.text();
                for (const pattern of queryPatterns) {
                    const queryId = responseBody.match(pattern)?.[1];
                    if (queryId) return queryId;
                }
            } catch {
                return undefined;
            }
            return undefined;
        }));
        const queryId = candidates.find(Boolean);
        if (queryId) {
            log.info('Discovered the current hotel-list operation from public page assets.');
            return queryId;
        }
    }

    throw new Error('Could not identify a paginated hotel-list operation in public page assets.');
}

function mapOffer(offer) {
    if (!offer || typeof offer !== 'object') return undefined;
    return compactRecord({
        availability_status: offer.availabilityStatus,
        display_price: offer.displayPrice,
        short_display_price: offer.shortDisplayPrice,
        base_price: validNumber(offer.basePrice, 0),
        currency_code: offer.currencyCode,
        provider: offer.provider?.displayName || offer.provider?.rawName,
        pricing_mode: offer.pricingMode,
        price_trend_tier: offer.priceTrendTier,
        time_of_payment: offer.timeOfPayment,
        free_cancellation_date: offer.freeCancellationDate,
        rooms_remaining: validInteger(offer.roomsRemaining, 0),
        is_member_rate: offer.isMemberRate,
        is_mobile_rate: offer.isMobileRate,
        is_supplier_direct: offer.isSupplierDirect,
    });
}

function mapReviewSnippet(seoItems) {
    const snippet = seoItems.find((item) => item?.seoContentType === 'HOVER_ROOM_REVIEW_SNIPPET');
    if (!snippet) return undefined;
    return compactRecord({
        text: snippet.text,
        title: snippet.review?.title,
        rating: validNumber(snippet.review?.rating, 0, 5),
        created_date: snippet.review?.createdDate,
        reviewer_name: snippet.review?.userProfile?.displayName,
        review_url: absoluteTripadvisorUrl(snippet.reviewUrl?.webLinkUrl),
    });
}

function mapHotelListItem({ item, sourceUrl, geoId, position }) {
    const location = item?.location || {};
    const info = location?.locationV2 || {};
    const meta = item?.resultDetail?.hotelMetaResult || {};
    const thumbnail = location?.thumbnail || {};
    const thumbnailSize = thumbnail?.photoSizeDynamic || {};
    const ranking = info?.hotelHierarchicalPopIndex || {};
    const address = info?.contact?.streetAddress || {};
    const award = info?.bestAwardForActiveYear || {};
    const seoItems = Array.isArray(info?.seoContent?.items) ? info.seoContent.items : [];
    const summary = seoItems.find((entry) => entry?.seoContentType === 'LLM_GENERATED_SUMMARY')?.text;
    const amenityItems = item?.resultDetail?.amenities?.highlightedAmenities || [];
    const amenities = amenityItems.map((amenity) => amenity?.amenityName).filter(Boolean);
    const containingLocations = (info?.containingLocations || [])
        .map((entry) => entry?.containingLocation?.names?.name)
        .filter(Boolean);
    const labelItems = item?.resultDetail?.merchandisingLabels || [];
    const labels = labelItems.map((label) => label?.text || label?.id).filter(Boolean);
    const primaryOffers = (meta?.primaryOffers || []).map(mapOffer).filter((offer) => Object.keys(offer || {}).length);
    const secondaryOffers = (meta?.secondaryOffers || []).map(mapOffer).filter((offer) => Object.keys(offer || {}).length);
    const emailLink = item?.resultDetail?.businessAdvantageInfo?.contactLinks
        ?.find((link) => link?.contactLinkType === 'EMAIL' && Array.isArray(link.emailParts));
    const email = emailLink?.emailParts?.join('');
    const locationId = validInteger(item?.locationId || info?.locationId, 1);
    const hotelName = info?.names?.name;
    const hotelUrl = absoluteTripadvisorUrl(location?.url);

    if (!locationId || !sanitizeString(String(hotelName || '')) || !hotelUrl) return undefined;

    return compactRecord({
        item_type: 'hotel_shelf_listing',
        source_url: sourceUrl,
        geo_id: geoId,
        api_variant: 'HPS_getHotelList',
        listing_position_on_shelf: position,
        hotel_result_key: item?.hotelResultKey,
        location_id: locationId,
        hotel_name: hotelName,
        hotel_url: hotelUrl,
        rating: validNumber(location?.reviewSummary?.rating, 0, 5),
        reviews_count: validInteger(location?.reviewSummary?.count, 0),
        ranking_type_text: ranking?.localizedCategoryPopIndexString,
        ranking_position: validInteger(ranking?.rank, 1),
        ranking_out_of: validInteger(ranking?.outof, 1),
        accommodation_type: info?.accommodationType?.name,
        accommodation_category: location?.accommodationCategory,
        star_rating_tag_ids: info?.starRating?.tags?.map((tag) => validInteger(tag?.tagId, 1)).filter(Boolean),
        thumbnail_url: convertPhotoTemplateToAbsoluteUrl(thumbnailSize?.urlTemplate),
        thumbnail_width: validInteger(thumbnailSize?.maxWidth, 1),
        thumbnail_height: validInteger(thumbnailSize?.maxHeight, 1),
        thumbnail_caption: thumbnail?.caption,
        thumbnail_lang: thumbnail?.lang,
        lowest_offer: meta?.lowestPrice,
        lowest_price: meta?.lowestPrice,
        offer_count: validInteger(meta?.offerCount, 0),
        available_offer_count: validInteger(meta?.availableOfferCount, 0),
        primary_offers: primaryOffers,
        secondary_offers: secondaryOffers,
        price_range: {
            minimum: validNumber(info?.hotelPriceRanges?.minimum, 0),
            maximum: validNumber(info?.hotelPriceRanges?.maximum, 0),
        },
        price_range_usd: {
            minimum: validNumber(info?.hotelPriceRangesUSD?.minimum, 0),
            maximum: validNumber(info?.hotelPriceRangesUSD?.maximum, 0),
        },
        full_address: address?.fullAddress,
        street_1: address?.street1,
        street_2: address?.street2,
        city: address?.city,
        state: address?.state,
        postal_code: address?.postalCode,
        country: address?.country,
        latitude: validNumber(info?.geocode?.latitude, -90, 90),
        longitude: validNumber(info?.geocode?.longitude, -180, 180),
        parent_geo_name: info?.names?.parentGeo || info?.hierarchy?.parent?.names?.name,
        neighborhoods: [...new Set(containingLocations)],
        country_id: validInteger(location?.countryId, 1),
        iso_country_code: location?.isoCountryCode,
        amenities: [...new Set(amenities)],
        amenity_details: amenityItems.map((amenity) => compactRecord({
            name: amenity?.amenityName,
            tag_id: validInteger(amenity?.tagId, 1),
            icon: amenity?.icon,
        })),
        hotel_description: info?.description || summary,
        review_snippet: mapReviewSnippet(seoItems),
        phone: info?.contact?.telephone,
        email,
        best_award_type: award?.awardType,
        best_award_year: validInteger(award?.year, 1900),
        merchandising_labels: [...new Set(labels)],
        special_offer: item?.resultDetail?.businessAdvantageInfo?.specialOffer,
        is_sponsored: String(item?.hotelResultKey || '').includes(':s:') || labels.includes('Sponsored'),
        is_smb_or_kasm: info?.hotelInformationV2?.isSmbOrKasm,
    });
}

async function fetchHotelEnrichment({ client, cookieHeader, startUrl, locationIds }) {
    if (!locationIds.length) return new Map();
    const operations = [];
    for (const locationId of locationIds) {
        operations.push({
            variables: { locationId },
            extensions: { preRegisteredQueryId: RATING_HISTOGRAM_QUERY_ID },
        });
        operations.push({
            variables: { locationId },
            extensions: { preRegisteredQueryId: SUBRATINGS_QUERY_ID },
        });
    }

    const response = await postGraphql({
        client,
        cookieHeader,
        startUrl,
        operations,
        label: 'Hotel review enrichment',
    });
    const enrichment = new Map();

    for (let index = 0; index < locationIds.length; index++) {
        const locationId = locationIds[index];
        const histogramItem = response?.[index * 2];
        const subratingsItem = response?.[index * 2 + 1];
        const ratingCounts = histogramItem?.data?.locations?.[0]?.reviewAggregations?.ratingCounts;
        const subRatings = subratingsItem?.data?.hotelSubratingsData?.[0]?.subRatings;

        enrichment.set(locationId, compactRecord({
            rating_histogram: Array.isArray(ratingCounts) && ratingCounts.length === 5
                ? {
                    five: validInteger(ratingCounts[4], 0),
                    four: validInteger(ratingCounts[3], 0),
                    three: validInteger(ratingCounts[2], 0),
                    two: validInteger(ratingCounts[1], 0),
                    one: validInteger(ratingCounts[0], 0),
                }
                : undefined,
            sub_ratings: subRatings,
        }));
    }

    return enrichment;
}

async function enrichPageRecords({ records, client, cookieHeader, startUrl }) {
    const locationIds = records.map((record) => record.location_id).filter(Boolean);
    const enrichment = new Map();

    for (let index = 0; index < locationIds.length; index += 25) {
        const batchIds = locationIds.slice(index, index + 25);
        try {
            const batch = await fetchHotelEnrichment({ client, cookieHeader, startUrl, locationIds: batchIds });
            for (const [locationId, value] of batch) enrichment.set(locationId, value);
        } catch (error) {
            log.warning(`Review enrichment batch skipped: ${error.message}`);
        }
    }

    return records.map((record) => compactRecord({
        ...record,
        ...(enrichment.get(record.location_id) || {}),
    }));
}

function deduplicationKey(record) {
    return record.location_id || record.hotel_url || record.hotel_result_key;
}

async function runActor() {
    const runtimeInput = (await Actor.getInput()) || {};
    const fallbackInput = await readJsonFileIfExists('INPUT.json');
    const input = Object.keys(runtimeInput).length ? runtimeInput : fallbackInput;
    if (!Object.keys(runtimeInput).length && Object.keys(fallbackInput).length) {
        log.info('Runtime input is empty. Using INPUT.json fallback values.');
    }

    const destinationGeoId = normalizeDestinationGeoId(input.destination);
    if (input.destination !== undefined && !destinationGeoId) {
        log.warning('The destination filter must be a positive TripAdvisor geo ID or a TripAdvisor URL containing a geo ID. Using the URL destination instead.');
    }
    const startUrls = normalizeStartUrls(input, destinationGeoId);
    const resultsWanted = toPositiveInteger(input.results_wanted, DEFAULT_RESULTS_WANTED);
    const maxPages = toPositiveInteger(input.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_LIMIT);
    const travelInfo = buildTravelInfo(input);
    const sorting = normalizeSort(input.sorting ?? input.sort);
    log.info(`Start run | urls=${startUrls.length} | target=${resultsWanted} | max_pages=${maxPages} | sort=${sorting}`);

    let proxyUrl;
    if (input.proxyConfiguration) {
        try {
            const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
            proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl() : undefined;
        } catch (error) {
            log.warning(`Proxy configuration unavailable; continuing without it: ${error.message}`);
        }
    }

    let queryId = HOTEL_LIST_QUERY_ID;
    let variablesTemplate = {};
    let browserDiscoveryUsed = false;
    const seenHotels = new Set();
    let savedHotels = 0;
    let processedPages = 0;
    let stopReason = 'sources_exhausted';

    for (const startUrl of startUrls) {
        if (savedHotels >= resultsWanted) {
            stopReason = 'results_wanted_reached';
            break;
        }

        const client = new Impit({
            browser: 'chrome',
            ignoreTlsErrors: true,
            ...(proxyUrl ? { proxyUrl } : {}),
        });
        let session = { cookieHeader: undefined, resolvedUrl: startUrl, statusCode: 0 };
        try {
            session = await initializeSession({ client, startUrl });
        } catch (error) {
            log.warning(`Session bootstrap failed; trying the JSON source directly: ${error.message}`);
        }

        const geoId = destinationGeoId || extractGeoIdFromUrl(startUrl) || extractGeoIdFromUrl(session.resolvedUrl);
        if (!geoId) {
            log.warning(`Skipping URL because its TripAdvisor geo ID could not be resolved: ${startUrl}`);
            continue;
        }
        log.info(`Source ready | geo_id=${geoId} | bootstrap_http=${session.statusCode}`);

        let { cookieHeader } = session;
        const pageviewId = crypto.randomUUID();
        const sessionId = crypto.randomUUID().replace(/-/g, '').toUpperCase();
        let stalledPages = 0;

        for (let pageIndex = 0; pageIndex < maxPages && savedHotels < resultsWanted; pageIndex++) {
            const offset = pageIndex * LIST_PAGE_SIZE;
            let list;
            try {
                list = await fetchHotelListPage({
                    client,
                    cookieHeader,
                    startUrl,
                    geoId,
                    offset,
                    requestNumber: pageIndex + 1,
                    pageviewId,
                    sessionId,
                    queryId,
                    variablesTemplate,
                    travelInfo,
                    sorting,
                });
            } catch (error) {
                if (browserDiscoveryUsed) throw error;
                log.warning(`Direct list operation failed: ${error.message}`);
                let discovered;
                try {
                    discovered = await discoverHotelListOperation({ startUrl, proxyUrl });
                } catch (browserError) {
                    log.warning(`Patchright discovery did not complete: ${browserError.message}`);
                    discovered = {
                        queryId: await discoverHotelListQueryFromAssets({ client, startUrl }),
                        variablesTemplate: {},
                        cookieHeader,
                    };
                }
                browserDiscoveryUsed = true;
                queryId = discovered.queryId;
                variablesTemplate = discovered.variablesTemplate;
                cookieHeader = discovered.cookieHeader || cookieHeader;
                list = await fetchHotelListPage({
                    client,
                    cookieHeader,
                    startUrl,
                    geoId,
                    offset,
                    requestNumber: pageIndex + 1,
                    pageviewId,
                    sessionId,
                    queryId,
                    variablesTemplate,
                    travelInfo,
                    sorting,
                });
            }

            processedPages += 1;
            const rawItems = Array.isArray(list.results) ? list.results : [];
            const pageRecords = [];

            for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex++) {
                const record = mapHotelListItem({
                    item: rawItems[itemIndex],
                    sourceUrl: startUrl,
                    geoId,
                    position: offset + itemIndex + 1,
                });
                if (!record) continue;
                const key = deduplicationKey(record);
                if (!key || seenHotels.has(String(key))) continue;
                seenHotels.add(String(key));
                pageRecords.push(record);
                if (savedHotels + pageRecords.length >= resultsWanted) break;
            }

            if (!pageRecords.length) {
                stalledPages += 1;
                log.info(`Page ${pageIndex + 1} produced no new unique hotels.`);
            } else {
                stalledPages = 0;
                const enriched = await enrichPageRecords({
                    records: pageRecords,
                    client,
                    cookieHeader,
                    startUrl,
                });
                await Actor.pushData(enriched);
                savedHotels += enriched.length;
                log.info(`Saved ${enriched.length} hotels | total=${savedHotels}/${resultsWanted} | page=${pageIndex + 1}`);
            }

            if (savedHotels >= resultsWanted) {
                stopReason = 'results_wanted_reached';
                break;
            }
            if (!rawItems.length) {
                stopReason = 'empty_page';
                break;
            }
            if (stalledPages >= PAGE_STALL_THRESHOLD) {
                stopReason = 'repeated_results';
                break;
            }
        }
    }

    if (!savedHotels) {
        throw new Error('No valid hotel listings were extracted from the submitted TripAdvisor URLs.');
    }

    await Actor.setValue('RUN_INFO', {
        start_urls: startUrls,
        requested_results: resultsWanted,
        saved_results: savedHotels,
        processed_pages: processedPages,
        graphql_endpoint: TRIPADVISOR_GRAPHQL_ENDPOINT,
        list_query_id: queryId,
        page_size: LIST_PAGE_SIZE,
        pagination: 'offset/limit',
        browser_discovery_used: browserDiscoveryUsed,
        stop_reason: stopReason,
    });
    log.info(`Done | saved=${savedHotels} | pages=${processedPages} | stop_reason=${stopReason}`);
}

try {
    await runActor();
    await Actor.exit();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    await Actor.exit({ exitCode: 1 });
}
