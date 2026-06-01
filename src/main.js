import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

const DEFAULT_START_URL = 'https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';
const TRIPADVISOR_GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';
const UNDATED_SHELVES_QUERY_ID = '32f2e254f7f08a0d';
const HOME_SHELVES_QUERY_ID = '6504d9cf4c74d5ae';
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

await Actor.init();

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

async function initializeSessionCookies({ startUrl, proxyUrl }) {
    const response = await gotScraping({
        url: startUrl,
        proxyUrl,
        timeout: { request: 30000 },
        throwHttpErrors: false,
        retry: REQUEST_RETRY_OPTIONS,
        headers: {
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': `${DEFAULT_LOCALE},en;q=0.9`,
        },
    });

    return {
        statusCode: response.statusCode,
        cookieHeader: toCookieHeader(response.headers['set-cookie']),
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

async function fetchShelves({ startUrl, proxyUrl, cookieHeader, payload }) {
    const response = await gotScraping({
        url: TRIPADVISOR_GRAPHQL_ENDPOINT,
        method: 'POST',
        proxyUrl,
        timeout: { request: 30000 },
        throwHttpErrors: false,
        retry: REQUEST_RETRY_OPTIONS,
        headers: {
            'user-agent': DEFAULT_USER_AGENT,
            accept: '*/*',
            'content-type': 'application/json',
            origin: 'https://www.tripadvisor.com',
            referer: startUrl,
            'x-requested-by': 'tripadvisor.com',
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(payload),
    });

    if (response.statusCode >= 400) {
        throw new Error(`TripAdvisor shelves request failed with HTTP ${response.statusCode}`);
    }

    let parsedResponse;
    try {
        parsedResponse = JSON.parse(response.body);
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

async function fetchShelvesAcrossStrategies({ startUrl, proxyUrl, cookieHeader, geoId, requestNumber }) {
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
                proxyUrl,
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
    const award = location?.bestAwardForActiveYear || {};

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
        thumbnail_caption: photo?.caption,
        thumbnail_lang: photo?.lang,
    });
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
            session = await initializeSessionCookies({ startUrl, proxyUrl });
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

        let stalledPages = 0;
        for (let pageNumber = 0; pageNumber < maxPagesInput; pageNumber++) {
            if ((savedHotels + pendingData.length) >= resultsWanted) break;

            let strategyResult;
            try {
                strategyResult = await fetchShelvesAcrossStrategies({
                    startUrl,
                    proxyUrl,
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

                        pendingData.push(mappedHotel);
                        if (pendingData.length >= DATASET_PUSH_BATCH_SIZE) {
                            await Actor.pushData(pendingData);
                            savedHotels += pendingData.length;
                            pendingData = [];
                        }

                        if ((savedHotels + pendingData.length) >= resultsWanted) break;
                    }

                    if ((savedHotels + pendingData.length) >= resultsWanted) break;
                }
                if ((savedHotels + pendingData.length) >= resultsWanted) break;
            }

            if (newItemsThisPage === 0) {
                stalledPages += 1;
                log.info(`Pagination page=${pageNumber + 1} for geoId=${geoId} produced no new hotels.`);
                if (stalledPages >= PAGE_STALL_THRESHOLD) break;
            } else {
                stalledPages = 0;
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
        notes: [
            'Using TripAdvisor HPS shelves queries instead of the old list query id path.',
            'Pagination uses requestNumber and aggregates all working shelves strategies before stall detection.',
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
