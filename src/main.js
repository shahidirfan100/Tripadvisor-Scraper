import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { Impit } from 'impit';

const DEFAULT_START_URL = 'https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html';
const TRIPADVISOR_GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';
const UNDATED_SHELVES_QUERY_ID = '32f2e254f7f08a0d';
const HOME_SHELVES_QUERY_ID = '6504d9cf4c74d5ae';
const RATING_HISTOGRAM_QUERY_ID = 'b6d4e00c5b27f98e';
const SUBRATINGS_QUERY_ID = '6d1d0d458eddcc5f';
const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DATASET_PUSH_BATCH_SIZE = 100;
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_LIMIT = 200;
const MAX_START_URLS = 10000;
const PAGE_STALL_THRESHOLD = 2;
const REQUEST_RETRY_OPTIONS = {
    limit: 2,
    methods: ['GET', 'POST'],
    statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524],
    errorCodes: ['ETIMEDOUT', 'ECONNRESET', 'EADDRINUSE', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'ENETUNREACH', 'EAI_AGAIN'],
};

async function fetchWithRetry(client, url, options = {}) {
    const maxAttempts = REQUEST_RETRY_OPTIONS.limit + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await client.fetch(url, options);

            if (REQUEST_RETRY_OPTIONS.statusCodes.includes(response.status)) {
                if (attempt === maxAttempts) return response;
                const wait = Math.min(attempt * 2000 + Math.random() * 1000, 10000);
                log.warning(`HTTP ${response.status}, retrying in ${Math.round(wait / 1000)}s (attempt ${attempt}/${maxAttempts})`);
                await new Promise((r) => { setTimeout(r, wait); });
                continue;
            }

            return response;
        } catch (error) {
            if (attempt === maxAttempts) throw error;
            const wait = Math.min(attempt * 1000 + Math.random() * 500, 5000);
            log.warning(`Request failed (${error.message}), retrying in ${Math.round(wait / 1000)}s`);
            await new Promise((r) => { setTimeout(r, wait); });
        }
    }
    throw new Error(`All ${maxAttempts} retries failed for ${url}`);
}

await Actor.init();

function buildRandomRequestedBy(length = 180) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < length; i++) {
        value += chars[Math.floor(Math.random() * chars.length)];
    }
    return value;
}

function compactValue(value) {
    if (value === null || value === undefined) return undefined;

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed === '' ? undefined : trimmed;
    }

    if (Array.isArray(value)) {
        const compactedArray = value.map(compactValue).filter((item) => item !== undefined);
        return compactedArray.length ? compactedArray : undefined;
    }

    if (typeof value === 'object') {
        const compactedObject = {};
        for (const [key, nestedValue] of Object.entries(value)) {
            const compactedNestedValue = compactValue(nestedValue);
            if (compactedNestedValue !== undefined) compactedObject[key] = compactedNestedValue;
        }
        return Object.keys(compactedObject).length ? compactedObject : undefined;
    }

    return value;
}

function compactRecord(record) {
    return compactValue(record) || {};
}

function absoluteTripadvisorUrl(pathOrUrl) {
    if (!pathOrUrl) return undefined;
    const value = String(pathOrUrl).trim();
    if (!value) return undefined;
    return value.startsWith('http') ? value : `https://www.tripadvisor.com${value}`;
}

function convertPhotoTemplateToAbsoluteUrl(template, width = 1200, height = 800) {
    if (!template) return undefined;
    const value = String(template);
    return value
        .replace('{width}', String(width))
        .replace('{height}', String(height));
}

function toCookieHeader(setCookieHeader) {
    if (!Array.isArray(setCookieHeader)) return undefined;
    const cookies = setCookieHeader
        .map((cookie) => String(cookie).split(';')[0]?.trim())
        .filter(Boolean);
    return cookies.length ? cookies.join('; ') : undefined;
}

function toPositiveInteger(value, fallback, maximum) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 1) return fallback;
    const integerValue = Math.floor(numericValue);
    if (maximum && integerValue > maximum) return maximum;
    return integerValue;
}

function extractGeoIdFromUrl(url) {
    const value = String(url || '');
    const geoMatch = value.match(/(?:^|[-_/])g(\d+)(?:[-_/]|$)/i);
    if (geoMatch?.[1]) return Number(geoMatch[1]);

    try {
        const parsedUrl = new URL(value);
        const queryGeo = parsedUrl.searchParams.get('geo') || parsedUrl.searchParams.get('geoId');
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
        const pathMatch = decoded.match(/(\/(?:Hotels|HotelsList|Hotel_Review)[^_\s]*\.html)/i);
        if (!pathMatch?.[1]) return undefined;
        return `https://www.tripadvisor.com${pathMatch[1]}`;
    } catch {
        return undefined;
    }
}

function normalizeTripadvisorUrl(candidate) {
    if (typeof candidate !== 'string') return undefined;
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;

    const decodedClientLink = extractDecodedClientLink(trimmed);
    const candidateValue = decodedClientLink || trimmed;
    let withProtocol = candidateValue;
    if (!candidateValue.match(/^https?:\/\//i)) {
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
    const geoFromQuery = parsed.searchParams.get('geo') || parsed.searchParams.get('geoId');
    if (geoFromQuery && Number.isFinite(Number(geoFromQuery))) safeQuery.set('geo', String(Number(geoFromQuery)));
    parsed.search = safeQuery.toString();

    return parsed.toString();
}

function addGeoHintToUrl(url, geoIdHint) {
    if (!geoIdHint || !Number.isFinite(Number(geoIdHint))) return url;

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }

    const existingGeo = parsed.searchParams.get('geo') || parsed.searchParams.get('geoId');
    if (!existingGeo) parsed.searchParams.set('geo', String(Number(geoIdHint)));
    return parsed.toString();
}

function splitPossibleUrls(rawValue) {
    if (typeof rawValue !== 'string') return [];
    const value = rawValue.trim();
    if (!value) return [];

    const strictUrlMatches = value.match(/https?:\/\/[^\s,;]+/gi);
    if (strictUrlMatches?.length) return strictUrlMatches;

    const tripadvisorDomainMatches = value.match(/(?:www\.)?tripadvisor\.[^\s,;]+/gi);
    if (tripadvisorDomainMatches?.length) return tripadvisorDomainMatches;

    return [value];
}

function collectUrlCandidates(value, output, depth = 0) {
    if (depth > 6 || value === null || value === undefined) return;

    if (typeof value === 'string') {
        for (const possibleUrl of splitPossibleUrls(value)) output.push(possibleUrl);
        return;
    }

    if (Array.isArray(value)) {
        for (const arrayItem of value) collectUrlCandidates(arrayItem, output, depth + 1);
        return;
    }

    if (typeof value === 'object') {
        const directKeys = ['url', 'href', 'link', 'startUrl', 'startURL', 'start_url'];
        for (const key of directKeys) collectUrlCandidates(value[key], output, depth + 1);

        const commonCollectionKeys = ['startUrls', 'urls', 'items', 'records', 'data'];
        for (const key of commonCollectionKeys) collectUrlCandidates(value[key], output, depth + 1);
    }
}

function normalizeStartUrls(input) {
    const rawCandidates = [];
    collectUrlCandidates(input?.startUrls, rawCandidates);
    collectUrlCandidates(input?.start_urls, rawCandidates);
    collectUrlCandidates(input?.startUrl, rawCandidates);
    collectUrlCandidates(input?.url, rawCandidates);
    collectUrlCandidates(input?.urls, rawCandidates);

    if (!rawCandidates.length) rawCandidates.push(DEFAULT_START_URL);

    const normalizedUrls = [];
    const seenUrls = new Set();

    for (const candidate of rawCandidates) {
        const normalized = normalizeTripadvisorUrl(candidate);
        if (!normalized) continue;
        const dedupKey = normalized.toLowerCase();
        if (seenUrls.has(dedupKey)) continue;
        seenUrls.add(dedupKey);
        normalizedUrls.push(normalized);
        if (normalizedUrls.length >= MAX_START_URLS) break;
    }

    if (!normalizedUrls.length) normalizedUrls.push(DEFAULT_START_URL);

    return normalizedUrls;
}

async function readJsonFileIfExists(filePath) {
    try {
        const raw = await readFile(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return {};
        log.warning(`Could not read ${filePath}: ${error.message}`);
        return {};
    }
}

async function initializeSessionCookies({ startUrl, client }) {
    const response = await fetchWithRetry(client, startUrl);

    return {
        statusCode: response.status,
        cookieHeader: toCookieHeader(response.headers.getSetCookie()),
        resolvedUrl: response.url || startUrl,
    };
}

function buildUndatedShelvesPayload({ geoId, queryId, requestNumber }) {
    return [
        {
            variables: {
                geoId,
                currency: DEFAULT_CURRENCY,
                pageviewId: crypto.randomUUID(),
                sessionId: crypto.randomUUID().replace(/-/g, '').toUpperCase(),
                deviceType: 'DESKTOP',
                locale: DEFAULT_LOCALE,
                requestCaller: 'Hotels',
                requestNumber,
            },
            extensions: {
                preRegisteredQueryId: queryId,
            },
        },
    ];
}

function buildHomeShelvesPayload({ queryId, requestNumber }) {
    return [
        {
            variables: {
                currency: DEFAULT_CURRENCY,
                pageviewId: crypto.randomUUID(),
                sessionId: crypto.randomUUID().replace(/-/g, '').toUpperCase(),
                deviceType: 'DESKTOP',
                locale: DEFAULT_LOCALE,
                requestNumber,
            },
            extensions: {
                preRegisteredQueryId: queryId,
            },
        },
    ];
}

async function fetchShelves({ startUrl, client, cookieHeader, payload }) {
    const response = await fetchWithRetry(client, TRIPADVISOR_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: 'https://www.tripadvisor.com',
            referer: startUrl,
            'x-requested-by': buildRandomRequestedBy(),
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(payload),
    });

    if (response.status >= 400) {
        throw new Error(`TripAdvisor shelves request failed with HTTP ${response.status}`);
    }

    let parsedResponse;
    try {
        parsedResponse = await response.json();
    } catch (error) {
        throw new Error(`Could not parse TripAdvisor shelves response JSON: ${error.message}`);
    }

    const graphqlError = parsedResponse?.[0]?.errors?.[0]?.message;
    if (graphqlError) throw new Error(graphqlError);

    const data = parsedResponse?.[0]?.data || {};
    const undatedShelves = data?.HPS_getUndatedHotelShelves?.shelves;
    if (Array.isArray(undatedShelves)) {
        return { shelves: undatedShelves, apiVariant: 'HPS_getUndatedHotelShelves' };
    }

    const homeShelves = data?.HPS_getHotelsHomeShelves?.shelves;
    if (Array.isArray(homeShelves)) {
        return { shelves: homeShelves, apiVariant: 'HPS_getHotelsHomeShelves' };
    }

    throw new Error('TripAdvisor response did not contain shelf listings.');
}

async function fetchShelvesAcrossStrategies({ startUrl, client, cookieHeader, geoId, requestNumber }) {
    const strategies = [
        {
            queryId: UNDATED_SHELVES_QUERY_ID,
            buildPayload: () => buildUndatedShelvesPayload({ geoId, queryId: UNDATED_SHELVES_QUERY_ID, requestNumber }),
        },
        {
            queryId: HOME_SHELVES_QUERY_ID,
            buildPayload: () => buildHomeShelvesPayload({ queryId: HOME_SHELVES_QUERY_ID, requestNumber }),
        },
    ];

    const failures = [];
    const responses = [];
    for (const strategy of strategies) {
        try {
            const shelvesResponse = await fetchShelves({
                startUrl,
                client,
                cookieHeader,
                payload: strategy.buildPayload(),
            });
            responses.push({
                ...shelvesResponse,
                queryId: strategy.queryId,
            });
        } catch (error) {
            failures.push(`${strategy.queryId}: ${error.message}`);
        }
    }

    if (!responses.length) {
        throw new Error(`All shelves strategies failed. ${failures.join(' | ')}`);
    }

    return { responses, failures };
}

function mapShelfItem({ startUrl, geoId, apiVariant, shelf, shelfIndex, item, itemIndex }) {
    const location = item?.location || {};
    const detail = location?.locationDetail?.info || {};
    const reviewSummary = location?.reviewSummary?.responseData || {};
    const photo = location?.thumbnail?.photo || {};
    const photoTemplate = photo?.photoSizeDynamic?.urlTemplate;
    const photoSize = photo?.photoSizeDynamic || {};
    const award = location?.bestAwardForActiveYear || {};
    const parentGeo = detail?.parentGeo?.detail?.info;

    return compactRecord({
        item_type: 'hotel_shelf_listing',
        source_url: startUrl,
        geo_id: geoId,
        api_variant: apiVariant,
        shelf_type: shelf?.shelfType,
        shelf_title: shelf?.shelfTitle,
        shelf_is_complete: shelf?.isComplete,
        shelf_position: shelfIndex + 1,
        shelf_see_all_url: absoluteTripadvisorUrl(shelf?.seeAllRouteLink?.webLinkUrl),
        listing_position_on_shelf: itemIndex + 1,
        location_id: item?.locationId || location?.locationId,
        hotel_name: detail?.localizedName,
        hotel_url: absoluteTripadvisorUrl(item?.locationRoute?.webLinkUrl),
        lowest_offer: item?.lowestOffer,
        rating: reviewSummary?.rating,
        reviews_count: reviewSummary?.count,
        best_award_type: award?.awardType,
        best_award_year: award?.year,
        thumbnail_url: convertPhotoTemplateToAbsoluteUrl(photoTemplate),
        thumbnail_width: photoSize?.maxWidth,
        thumbnail_height: photoSize?.maxHeight,
        thumbnail_caption: photo?.caption,
        thumbnail_lang: photo?.lang,
        parent_geo_name: parentGeo?.localizedName,
    });
}

async function fetchGraphql(client, cookieHeader, startUrl, queries) {
    const response = await fetchWithRetry(client, TRIPADVISOR_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            origin: 'https://www.tripadvisor.com',
            referer: startUrl,
            'x-requested-by': buildRandomRequestedBy(),
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(queries),
    });

    if (response.status >= 400) {
        throw new Error(`TripAdvisor GraphQL enrichment request failed with HTTP ${response.status}`);
    }

    return response.json();
}

async function fetchHotelEnrichment({ client, cookieHeader, startUrl, locationIds }) {
    const result = new Map();
    for (const id of locationIds) result.set(Number(id), {});

    const BATCH_SIZE = 25;
    for (let i = 0; i < locationIds.length; i += BATCH_SIZE) {
        const slice = locationIds.slice(i, i + BATCH_SIZE);
        const queries = [];
        for (const id of slice) {
            queries.push({
                variables: { locationId: Number(id) },
                extensions: { preRegisteredQueryId: RATING_HISTOGRAM_QUERY_ID },
            });
            queries.push({
                variables: { locationId: Number(id) },
                extensions: { preRegisteredQueryId: SUBRATINGS_QUERY_ID },
            });
        }

        let parsed;
        try {
            parsed = await fetchGraphql(client, cookieHeader, startUrl, queries);
        } catch (error) {
            log.warning(`Hotel GraphQL enrichment batch failed: ${error.message}`);
            continue;
        }

        const items = Array.isArray(parsed) ? parsed : [];
        for (let k = 0; k < slice.length; k++) {
            const id = Number(slice[k]);
            const histogramItem = items[2 * k];
            const subratingsItem = items[2 * k + 1];
            const target = result.get(id);
            if (!target) continue;

            const histogramError = histogramItem?.errors?.[0]?.message;
            if (!histogramError) {
                const ratingCounts = histogramItem?.data?.locations?.[0]?.reviewAggregations?.ratingCounts;
                if (Array.isArray(ratingCounts) && ratingCounts.length === 5) {
                    target.ratingHistogram = {
                        five: ratingCounts[4],
                        four: ratingCounts[3],
                        three: ratingCounts[2],
                        two: ratingCounts[1],
                        one: ratingCounts[0],
                    };
                }
                const summary = histogramItem?.data?.reviewSummaryInfo?.[0]?.responseData;
                if (summary && (summary.rating != null || summary.count != null)) {
                    target.reviewSummary = { rating: summary.rating ?? null, count: summary.count ?? null };
                }
            }

            const subratingsError = subratingsItem?.errors?.[0]?.message;
            if (!subratingsError) {
                const subRatings = subratingsItem?.data?.hotelSubratingsData?.[0]?.subRatings;
                if (subRatings && typeof subRatings === 'object') {
                    target.subRatings = subRatings;
                }
            }
        }
    }

    return result;
}

function extractHotelDetailFromPage() {
    const out = {};
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
        try {
            const parsed = JSON.parse(script.textContent || '{}');
            const root = Array.isArray(parsed) ? parsed[0] : parsed;
            const node = root?.['@graph'] ? root['@graph'].find((n) => n?.address || n?.geo) : root;
            if (!node) continue;

            if (node.geo?.latitude != null && node.geo?.longitude != null) {
                out.latitude = Number(node.geo.latitude);
                out.longitude = Number(node.geo.longitude);
            }
            if (node.address) {
                const a = node.address;
                if (typeof a === 'string') {
                    out.full_address = a;
                } else {
                    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
                        .filter(Boolean)
                        .map(String);
                    if (parts.length) out.full_address = parts.join(', ');
                }
            }
            if (node.starRating?.ratingValue != null) out.provider_star_rating = Number(node.starRating.ratingValue);
            if (node.telephone) out.phone = String(node.telephone);
            if (node.description) out.hotel_description = String(node.description);
            if (node['@type'] === 'Hotel') out.accommodation_type = 'Hotel';
        } catch {
            // ignore malformed JSON-LD blocks
        }
    }

    const amenityEls = document.querySelectorAll('[data-test-target="amenity"], [class*="amenity"], [class*="Amenity"]');
    const amenities = Array.from(amenityEls)
        .map((el) => (el.textContent || '').trim())
        .filter(Boolean);
    if (amenities.length) out.amenities = [...new Set(amenities)];

    const rankingEl = document.querySelector('[data-test-target="ranking"], .biGQsF');
    if (rankingEl?.textContent) out.ranking_type_text = rankingEl.textContent.trim();

    const priceEl = document.querySelector('[data-test-target="price-text"], [class*="price"], [class*="Price"]');
    if (priceEl?.textContent) out.lowest_price = priceEl.textContent.trim();

    return out;
}

async function enrichHotelsViaBrowser(hotels, proxyUrl) {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch (error) {
        log.warning(`Playwright is not installed; skipping browser-based rich detail. ${error.message}`);
        return;
    }

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            proxy: proxyUrl ? { server: proxyUrl } : undefined,
        });
    } catch (error) {
        log.warning(`Could not launch browser for rich detail; skipping. ${error.message}`);
        return;
    }

    try {
        for (const hotel of hotels) {
            const url = hotel.hotel_url;
            if (!url) continue;

            const context = await browser.newContext({ userAgent: CHROME_USER_AGENT, locale: 'en-US' });
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector('script[type="application/ld+json"]', { timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(2000);
                const detail = await page.evaluate(extractHotelDetailFromPage);
                Object.assign(hotel, compactRecord(detail));
            } catch (error) {
                log.warning(`Browser detail extraction failed for ${url}: ${error.message}`);
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close().catch(() => {});
    }
}

async function runActor() {
    const runtimeInput = (await Actor.getInput()) || {};
    const fallbackInput = await readJsonFileIfExists('INPUT.json');
    const useFallback = Object.keys(runtimeInput).length === 0 && Object.keys(fallbackInput).length > 0;
    const input = useFallback ? fallbackInput : runtimeInput;

    if (useFallback) log.info('Runtime input is empty. Using INPUT.json fallback values.');

    const startUrls = normalizeStartUrls(input);
    const resultsWanted = toPositiveInteger(input.results_wanted, 20);
    const maxPagesInput = toPositiveInteger(input.max_pages, DEFAULT_MAX_PAGES, MAX_PAGES_LIMIT);

    const proxyConfigInput = input.proxyConfiguration;
    log.info(`Starting TripAdvisor hotels extraction via shelves API. URLs=${startUrls.length}, results_wanted=${resultsWanted}, max_pages=${maxPagesInput}`);

    let proxyUrl;
    if (proxyConfigInput) {
        try {
            const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigInput);
            if (proxyConfiguration) proxyUrl = await proxyConfiguration.newUrl();
        } catch (error) {
            log.warning(`Proxy configuration could not be initialized. Continuing without proxy. ${error.message}`);
        }
    }

    const client = new Impit({
        browser: 'chrome',
        ignoreTlsErrors: true,
        ...(proxyUrl && { proxyUrl }),
    });

    const urlQueue = [...startUrls];
    const queuedUrls = new Set(urlQueue.map((url) => url.toLowerCase()));
    const geoHintByUrl = new Map();
    for (const url of startUrls) {
        const geoHint = extractGeoIdFromUrl(url);
        if (geoHint) geoHintByUrl.set(url.toLowerCase(), geoHint);
    }
    const seenHotels = new Set();
    let pendingData = [];
    let savedHotels = 0;
    let processedUrls = 0;
    const endpointVariantByGeo = {};
    const queryIdByGeo = {};

    for (let urlIndex = 0; urlIndex < urlQueue.length; urlIndex++) {
        const startUrl = urlQueue[urlIndex];
        if ((savedHotels + pendingData.length) >= resultsWanted) break;

        processedUrls += 1;
        let session;
        try {
            session = await initializeSessionCookies({ startUrl, client });
        } catch (error) {
            log.warning(`Session bootstrap failed for URL=${startUrl}. Continuing without cookies. ${error.message}`);
            session = { statusCode: 0, cookieHeader: undefined, resolvedUrl: startUrl };
        }

        const geoId = extractGeoIdFromUrl(startUrl)
            || extractGeoIdFromUrl(session.resolvedUrl)
            || geoHintByUrl.get(startUrl.toLowerCase());
        if (!geoId) {
            log.warning(`Skipping URL because geoId could not be resolved even after bootstrap: ${startUrl}`);
            continue;
        }
        log.info(`Session bootstrap for geoId=${geoId} returned HTTP ${session.statusCode}.`);

        const { cookieHeader } = session;
        if (!cookieHeader) {
            log.warning(`No bootstrap cookies for geoId=${geoId}. Continuing anyway.`);
        }

        const urlHotels = [];
        let stalledPages = 0;
        for (let pageNumber = 0; pageNumber < maxPagesInput; pageNumber++) {
            if ((savedHotels + pendingData.length + urlHotels.length) >= resultsWanted) break;

            let strategyResult;
            try {
                strategyResult = await fetchShelvesAcrossStrategies({
                    startUrl,
                    client,
                    cookieHeader,
                    geoId,
                    requestNumber: pageNumber,
                });
            } catch (error) {
                log.warning(`All query attempts failed for geoId=${geoId} on page=${pageNumber + 1}. ${error.message}`);
                break;
            }

            const strategyResponses = Array.isArray(strategyResult.responses) ? strategyResult.responses : [];
            if (!strategyResponses.length) {
                stalledPages += 1;
                log.warning(`No strategy responses returned for geoId=${geoId} on page=${pageNumber + 1}.`);
                if (stalledPages >= PAGE_STALL_THRESHOLD) break;
                continue;
            }

            let newItemsThisPage = 0;
            for (const shelvesResponse of strategyResponses) {
                if (!endpointVariantByGeo[geoId]) endpointVariantByGeo[geoId] = [];
                if (!endpointVariantByGeo[geoId].includes(shelvesResponse.apiVariant)) {
                    endpointVariantByGeo[geoId].push(shelvesResponse.apiVariant);
                }
                if (!queryIdByGeo[geoId]) queryIdByGeo[geoId] = [];
                if (!queryIdByGeo[geoId].includes(shelvesResponse.queryId)) {
                    queryIdByGeo[geoId].push(shelvesResponse.queryId);
                }

                const shelves = Array.isArray(shelvesResponse.shelves) ? shelvesResponse.shelves : [];
                for (let shelfIndex = 0; shelfIndex < shelves.length; shelfIndex++) {
                    const shelf = shelves[shelfIndex];
                    const shelfItems = Array.isArray(shelf?.shelfItems) ? shelf.shelfItems : [];
                    const shelfSeeAllUrl = normalizeTripadvisorUrl(absoluteTripadvisorUrl(shelf?.seeAllRouteLink?.webLinkUrl));
                    if (shelfSeeAllUrl && urlQueue.length < MAX_START_URLS) {
                        const geoAwareShelfUrl = addGeoHintToUrl(shelfSeeAllUrl, geoId);
                        const queueKey = geoAwareShelfUrl.toLowerCase();
                        if (!queuedUrls.has(queueKey)) {
                            queuedUrls.add(queueKey);
                            urlQueue.push(geoAwareShelfUrl);
                            geoHintByUrl.set(queueKey, geoId);
                        }
                    }

                    for (let itemIndex = 0; itemIndex < shelfItems.length; itemIndex++) {
                        const item = shelfItems[itemIndex];

                        const mappedHotel = mapShelfItem({
                            startUrl,
                            geoId,
                            apiVariant: shelvesResponse.apiVariant,
                            shelf,
                            shelfIndex,
                            item,
                            itemIndex,
                        });
                        if (!Object.keys(mappedHotel).length) continue;

                        const dedupKey = mappedHotel.location_id
                            || mappedHotel.hotel_url
                            || `${mappedHotel.hotel_name || ''}|${mappedHotel.shelf_type || ''}`;
                        if (!dedupKey || seenHotels.has(String(dedupKey))) continue;
                        seenHotels.add(String(dedupKey));
                        newItemsThisPage += 1;

                        urlHotels.push(mappedHotel);

                        if ((savedHotels + pendingData.length + urlHotels.length) >= resultsWanted) break;
                    }

                    if ((savedHotels + pendingData.length + urlHotels.length) >= resultsWanted) break;
                }
                if ((savedHotels + pendingData.length + urlHotels.length) >= resultsWanted) break;
            }

            if (newItemsThisPage === 0) {
                stalledPages += 1;
                log.info(`Pagination page=${pageNumber + 1} for geoId=${geoId} produced no new hotels.`);
                if (stalledPages >= PAGE_STALL_THRESHOLD) break;
            } else {
                stalledPages = 0;
            }
        }

        if (!urlHotels.length) {
            log.info(`No hotels collected for ${startUrl}.`);
        } else {
            const enrichmentIds = [...new Set(
                urlHotels
                    .map((hotel) => hotel.location_id)
                    .filter((id) => Number.isFinite(Number(id)))
                    .map(Number),
            )];

            if (enrichmentIds.length) {
                try {
                    const enrichment = await fetchHotelEnrichment({
                        client,
                        cookieHeader,
                        startUrl,
                        locationIds: enrichmentIds,
                    });
                    for (const hotel of urlHotels) {
                        const data = enrichment.get(Number(hotel.location_id));
                        if (!data) continue;
                        if (data.ratingHistogram) hotel.rating_histogram = data.ratingHistogram;
                        if (data.reviewSummary) {
                            if (data.reviewSummary.rating != null) hotel.rating = hotel.rating ?? data.reviewSummary.rating;
                            if (data.reviewSummary.count != null) hotel.reviews_count = hotel.reviews_count ?? data.reviewSummary.count;
                        }
                        if (data.subRatings) hotel.sub_ratings = data.subRatings;
                    }
                } catch (error) {
                    log.warning(`Hotel GraphQL enrichment failed for ${startUrl}: ${error.message}`);
                }
            }

            if (proxyUrl) {
                try {
                    await enrichHotelsViaBrowser(urlHotels, proxyUrl);
                } catch (error) {
                    log.warning(`Browser detail enrichment failed for ${startUrl}: ${error.message}`);
                }
            } else {
                log.info('No proxy configured; skipping browser-based rich detail (address/lat-long/amenities). Set proxyConfiguration to enable.');
            }

            for (const hotel of urlHotels) {
                pendingData.push(compactRecord(hotel));
                if (pendingData.length >= DATASET_PUSH_BATCH_SIZE) {
                    await Actor.pushData(pendingData);
                    savedHotels += pendingData.length;
                    pendingData = [];
                }
                if ((savedHotels + pendingData.length) >= resultsWanted) break;
            }
        }

        log.info(`Progress: url=${processedUrls}/${urlQueue.length}, geoId=${geoId}, collected=${savedHotels + pendingData.length}/${resultsWanted}`);
    }

    if (pendingData.length) {
        await Actor.pushData(pendingData);
        savedHotels += pendingData.length;
    }

    if (!savedHotels) {
        throw new Error('No hotel listings were extracted. TripAdvisor may be blocking this route for the provided proxy/session.');
    }

    await Actor.setValue('RUN_INFO', {
        start_urls: startUrls,
        discovered_start_urls: urlQueue,
        requested_results: resultsWanted,
        saved_results: savedHotels,
        processed_urls: processedUrls,
        graphql_endpoint: TRIPADVISOR_GRAPHQL_ENDPOINT,
        query_id_by_geo: queryIdByGeo,
        endpoint_variant_by_geo: endpointVariantByGeo,
        enrichment: {
            graphql: ['rating_histogram', 'review_summary', 'sub_ratings'],
            browser: proxyUrl ? 'enabled (address/lat-long/amenities/star-rating/phone)' : 'disabled (no proxy configured)',
        },
        notes: [
            'Using TripAdvisor HPS shelves queries instead of the old list query id path.',
            'Pagination uses requestNumber and aggregates all working shelves strategies before stall detection.',
            'Per-hotel GraphQL enrichment adds rating histogram, review summary, and sub-ratings.',
            'Browser-based rich detail (address, lat/long, amenities, star rating, phone) runs only when a proxy is configured.',
            'startUrls are normalized from messy input shapes (arrays, objects, wrapped links, and mixed formatting).',
        ],
    });

    log.info(`Saved ${savedHotels} unique hotel listings.`);
}

try {
    await runActor();
} catch (error) {
    log.error(`Actor failed: ${error.message}`);
    throw error;
} finally {
    await Actor.exit();
}
