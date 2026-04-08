import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';
import { gotScraping } from 'got-scraping';

const DEFAULT_START_URL = 'https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';
const TRIPADVISOR_GRAPHQL_ENDPOINT = 'https://www.tripadvisor.com/data/graphql/ids';
const KNOWN_TRIPADVISOR_HOTELS_QUERY_IDS = [
    // Current hotels list query id observed on 2026-04-08.
    '0ab60f652e82bad6',
    // Previous id kept for backward compatibility / fallback.
    'fba19361f0ea0116',
];
const DATASET_PUSH_BATCH_SIZE = 100;
const DEFAULT_LIMIT_PER_PAGE = 30;
const DEFAULT_SORT = 'BEST_VALUE';
const DEFAULT_CURRENCY = 'USD';
const MAX_SCRIPT_URLS_TO_SCAN_FOR_QUERY_IDS = 20;
const LATEST_HOTELS_QUERY_ID_STORE_KEY = 'LATEST_HOTELS_QUERY_ID';
const QUERY_ID_ERROR_PATTERN = /Cannot query field|did not contain list payload|persisted query|Unknown query/i;

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
    const geoMatch = value.match(/-g(\d+)-/i);
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

function normalizeStartUrls(input) {
    const output = [];
    const pushUrl = (candidate) => {
        if (typeof candidate !== 'string') return;
        const trimmed = candidate.trim();
        if (!trimmed) return;
        output.push(trimmed);
    };

    if (Array.isArray(input.startUrls)) {
        for (const startUrlItem of input.startUrls) {
            if (typeof startUrlItem === 'string') pushUrl(startUrlItem);
        }
    }

    if (!output.length) output.push(DEFAULT_START_URL);

    return [...new Set(output)];
}

function normalizeTripadvisorScriptUrl(rawUrl) {
    if (!rawUrl) return undefined;
    const value = String(rawUrl).trim();
    if (!value) return undefined;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `https://www.tripadvisor.com${value}`;
    return value;
}

function extractScriptUrlsFromHtml(pageHtml) {
    if (typeof pageHtml !== 'string' || !pageHtml) return [];

    const urls = [];
    for (const match of pageHtml.matchAll(/<script[^>]+src="([^"]+)"/gi)) {
        const normalizedUrl = normalizeTripadvisorScriptUrl(match?.[1]);
        if (normalizedUrl) urls.push(normalizedUrl);
    }

    return [...new Set(urls)];
}

function extractPreloadedScriptUrlsFromHtml(pageHtml) {
    if (typeof pageHtml !== 'string' || !pageHtml) return [];

    const urls = [];
    for (const match of pageHtml.matchAll(/<link[^>]+as="script"[^>]+href="([^"]+)"/gi)) {
        const normalizedUrl = normalizeTripadvisorScriptUrl(match?.[1]);
        if (normalizedUrl) urls.push(normalizedUrl);
    }
    for (const match of pageHtml.matchAll(/<link[^>]+href="([^"]+)"[^>]+as="script"/gi)) {
        const normalizedUrl = normalizeTripadvisorScriptUrl(match?.[1]);
        if (normalizedUrl) urls.push(normalizedUrl);
    }

    return [...new Set(urls)];
}

function extractQueryIdsFromScript(scriptContent) {
    if (typeof scriptContent !== 'string' || !scriptContent) return [];

    const queryIds = new Set();
    for (const match of scriptContent.matchAll(/id:"([a-f0-9]{16})"/g)) {
        if (match?.[1]) queryIds.add(match[1]);
    }
    for (const match of scriptContent.matchAll(/preRegisteredQueryId":"([a-f0-9]{16})"/g)) {
        if (match?.[1]) queryIds.add(match[1]);
    }

    return [...queryIds];
}

function extractLikelyHotelsListQueryIdsFromScript(scriptContent) {
    if (typeof scriptContent !== 'string' || !scriptContent) return [];

    const result = [];
    const seen = new Set();
    const declarationRegex = /([A-Za-z_$][A-Za-z0-9_$]*)=\{__key:0x[a-f0-9]+,id:"([a-f0-9]{16})",loc:\{\},definitions:\[\]\}/g;

    for (const match of scriptContent.matchAll(declarationRegex)) {
        const variableName = match?.[1];
        const queryId = match?.[2];
        if (!variableName || !queryId) continue;

        const queryReference = `query:${variableName}`;
        const referenceIndex = scriptContent.indexOf(queryReference);
        if (referenceIndex < 0) continue;

        const contextStart = Math.max(0, referenceIndex - 8000);
        const contextEnd = Math.min(scriptContent.length, referenceIndex + 8000);
        const context = scriptContent.slice(contextStart, contextEnd);

        const looksLikeHotelsListQuery = (
            context.includes('data?.list')
            || context.includes('list?.results')
            || context.includes('hotelResultKey')
            || context.includes('loadLocationSEOData')
            || context.includes('productId:"Hotels"')
        );

        if (!looksLikeHotelsListQuery || seen.has(queryId)) continue;
        seen.add(queryId);
        result.push(queryId);
    }

    return result;
}

function uniqueValidQueryIds(queryIds) {
    const unique = [];
    const seen = new Set();

    for (const queryId of queryIds) {
        const normalized = String(queryId || '').trim().toLowerCase();
        if (!/^[a-f0-9]{16}$/.test(normalized)) continue;
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        unique.push(normalized);
    }

    return unique;
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

function createGraphqlPayload({
    queryId,
    geoId,
    offset,
    limit,
    sort,
    currency,
    pageviewId,
    sessionId,
}) {
    return [
        {
            variables: {
                geoId,
                blenderId: null,
                boundingBox: null,
                centerAndRadius: null,
                travelInfo: null,
                currency,
                pricingMode: null,
                filters: {
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
                },
                offset,
                limit,
                sort,
                clientType: 'DESKTOP',
                loadMapSpecificData: false,
                viewType: 'LIST',
                productId: 'Hotels',
                pageviewId,
                sessionId,
                route: {
                    page: 'HotelsFusion',
                    params: {
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
                isDiscoEligible: true,
                isSplitMapView: false,
                resolveGeoIdFromBoundingBox: false,
                showContextualisedThumbnail: false,
                polling: false,
                tertiaryOffers: false,
                includePhotoSizes: false,
                requestNumber: 1,
            },
            extensions: {
                preRegisteredQueryId: queryId,
            },
        },
    ];
}

function convertPhotoTemplateToAbsoluteUrl(template, width = 1200, height = 800) {
    if (!template) return undefined;
    const value = String(template);
    return value
        .replace('{width}', String(width))
        .replace('{height}', String(height));
}

function mapHotelListing(rawItem, context) {
    const location = rawItem?.location || {};
    const locationV2 = location?.locationV2 || {};
    const hotelMetaResult = rawItem?.resultDetail?.hotelMetaResult || {};
    const primaryOffer = hotelMetaResult?.primaryOffers?.[0] || {};
    const rankInfo = locationV2?.hotelHierarchicalPopIndex || {};
    const streetAddress = locationV2?.contact?.streetAddress || {};
    const thumbnailTemplate = location?.thumbnail?.photoSizeDynamic?.urlTemplate;
    const searchGeo = context?.searchParameters?.geo?.location?.locationV2?.names?.name;

    return compactRecord({
        item_type: 'hotel_listing',
        source_url: context.startUrl,
        geo_id: context.geoId,
        search_geo_name: searchGeo,
        search_total_locations: context.searchMetadata?.totalLocationsInSearch,
        search_total_full_match: context.searchMetadata?.totalLocationsFullMatch,
        listing_offset: context.offset,
        listing_page: context.page,
        listing_position_on_page: context.positionOnPage,
        listing_position_overall: context.offset + context.positionOnPage,
        hotel_result_key: rawItem?.hotelResultKey,
        location_id: rawItem?.locationId || locationV2?.locationId,
        hotel_name: locationV2?.names?.name,
        parent_geo_name: locationV2?.names?.parentGeo,
        hotel_url: absoluteTripadvisorUrl(location?.url),
        hotel_highlight_url: absoluteTripadvisorUrl(rawItem?.hotelHighlightLink?.webLinkUrl),
        rating: location?.reviewSummary?.rating,
        reviews_count: location?.reviewSummary?.count,
        accommodation_type: locationV2?.accommodationType?.name,
        accommodation_category: location?.accommodationCategory,
        provider_star_rating: location?.detail?.hotel?.providerStarRating,
        ranking_category_text: rankInfo?.localizedCategoryPopIndexString,
        ranking_type_text: rankInfo?.localizedTypePopIndexString,
        ranking_position: rankInfo?.rank,
        ranking_total: rankInfo?.outof,
        latitude: locationV2?.geocode?.latitude,
        longitude: locationV2?.geocode?.longitude,
        phone: locationV2?.contact?.telephone,
        full_address: streetAddress?.fullAddress,
        street1: streetAddress?.street1,
        street2: streetAddress?.street2,
        city: streetAddress?.city,
        state: streetAddress?.state,
        postal_code: streetAddress?.postalCode,
        country: streetAddress?.country,
        thumbnail_url: convertPhotoTemplateToAbsoluteUrl(thumbnailTemplate),
        description: locationV2?.description,
        lowest_price: hotelMetaResult?.lowestPrice,
        price_min: locationV2?.hotelPriceRanges?.minimum,
        price_max: locationV2?.hotelPriceRanges?.maximum,
        price_min_usd: locationV2?.hotelPriceRangesUSD?.minimum,
        offer_count: hotelMetaResult?.offerCount,
        available_offer_count: hotelMetaResult?.availableOfferCount,
        has_member_rate: hotelMetaResult?.hasMemberRateAvailable,
        provider_name: primaryOffer?.provider?.displayName,
        provider_raw_name: primaryOffer?.provider?.rawName,
        primary_offer_price: primaryOffer?.displayPrice,
        primary_offer_currency: primaryOffer?.currencyCode,
        is_saved: location?.socialStatistics?.isSaved,
    });
}

async function initializeGraphqlSession({ startUrl, proxyUrl }) {
    const response = await gotScraping({
        url: startUrl,
        proxyUrl,
        timeout: { request: 30000 },
        throwHttpErrors: false,
        retry: { limit: 0 },
        headers: {
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.9',
        },
    });

    return {
        statusCode: response.statusCode,
        cookieHeader: toCookieHeader(response.headers['set-cookie']),
        pageHtml: typeof response.body === 'string' ? response.body : '',
    };
}

async function discoverDynamicHotelsQueryIds({ pageHtml, proxyUrl }) {
    const urlsToScan = [
        ...extractPreloadedScriptUrlsFromHtml(pageHtml),
        ...extractScriptUrlsFromHtml(pageHtml),
    ]
        .filter((url) => (
        url.includes('static.tacdn.com/assets/') && /\.js(?:\?|$)/.test(url)
    ))
        .filter((url, index, array) => array.indexOf(url) === index)
        .slice(0, MAX_SCRIPT_URLS_TO_SCAN_FOR_QUERY_IDS);

    if (!urlsToScan.length) return [];

    const likelyIds = [];
    const fallbackIds = [];

    for (const scriptUrl of urlsToScan) {
        try {
            const response = await gotScraping({
                url: scriptUrl,
                proxyUrl,
                timeout: { request: 30000 },
                throwHttpErrors: false,
                retry: { limit: 0 },
                headers: {
                    'user-agent': DEFAULT_USER_AGENT,
                    accept: '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                },
            });

            if (response.statusCode >= 400) continue;

            const scriptBody = String(response.body || '');
            if (!scriptBody.includes('HotelsFusion') || !scriptBody.includes('id:"')) continue;

            for (const queryId of extractLikelyHotelsListQueryIdsFromScript(scriptBody)) {
                likelyIds.push(queryId);
            }
            for (const queryId of extractQueryIdsFromScript(scriptBody)) {
                fallbackIds.push(queryId);
            }

            if (likelyIds.length) break;
        } catch (error) {
            log.debug(`Skipping script ${scriptUrl}. ${error.message}`);
        }
    }

    return uniqueValidQueryIds([...likelyIds, ...fallbackIds]);
}

async function fetchHotelsPage({
    queryId,
    startUrl,
    geoId,
    offset,
    limit,
    sort,
    currency,
    proxyUrl,
    cookieHeader,
    pageviewId,
    sessionId,
}) {
    const payload = createGraphqlPayload({
        queryId,
        geoId,
        offset,
        limit,
        sort,
        currency,
        pageviewId,
        sessionId,
    });

    const response = await gotScraping({
        url: TRIPADVISOR_GRAPHQL_ENDPOINT,
        method: 'POST',
        proxyUrl,
        timeout: { request: 30000 },
        throwHttpErrors: false,
        retry: { limit: 0 },
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
        throw new Error(`TripAdvisor hotels listing request failed with HTTP ${response.statusCode}`);
    }

    let parsedResponse;
    try {
        parsedResponse = JSON.parse(response.body);
    } catch (error) {
        throw new Error(`Could not parse TripAdvisor listing response JSON: ${error.message}`);
    }

    const graphqlError = parsedResponse?.[0]?.errors?.[0]?.message;
    if (graphqlError) {
        throw new Error(`TripAdvisor hotels listing response returned GraphQL error for query ${queryId}: ${graphqlError}`);
    }

    const data = parsedResponse?.[0]?.data;
    if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'list')) {
        throw new Error(`TripAdvisor hotels listing response did not contain list payload for query ${queryId}.`);
    }

    const list = data.list || {};
    return {
        results: Array.isArray(list?.results) ? list.results : [],
        isComplete: Boolean(list?.isComplete),
        searchMetadata: list?.searchMetadata,
        searchParameters: list?.searchParameters,
    };
}

async function resolveHotelsQueryId({
    startUrl,
    geoId,
    sort,
    currency,
    proxyUrl,
    cookieHeader,
    pageviewId,
    sessionId,
    pageHtml,
    preferredQueryIds = [],
}) {
    const tested = [];
    const discoveredIds = await discoverDynamicHotelsQueryIds({ pageHtml, proxyUrl });
    const candidateQueryIds = uniqueValidQueryIds([
        ...preferredQueryIds,
        ...discoveredIds,
        ...KNOWN_TRIPADVISOR_HOTELS_QUERY_IDS,
    ]);

    const tryQueryId = async (queryId) => {
        try {
            await fetchHotelsPage({
                queryId,
                startUrl,
                geoId,
                offset: 0,
                limit: 1,
                sort,
                currency,
                proxyUrl,
                cookieHeader,
                pageviewId,
                sessionId,
            });
            return true;
        } catch (error) {
            tested.push({ queryId, error: error.message });
            return false;
        }
    };

    for (const queryId of candidateQueryIds) {
        if (await tryQueryId(queryId)) return queryId;
    }

    const summary = tested
        .slice(-5)
        .map(({ queryId, error }) => `${queryId}: ${error}`)
        .join(' | ');
    throw new Error(`Unable to resolve a working TripAdvisor hotels query id. Recent errors: ${summary}`);
}

async function runActor() {
    const runtimeInput = (await Actor.getInput()) || {};
    const fallbackInput = await readJsonFileIfExists('INPUT.json');
    const useFallback = Object.keys(runtimeInput).length === 0 && Object.keys(fallbackInput).length > 0;
    const input = useFallback ? fallbackInput : runtimeInput;

    if (useFallback) {
        log.info('Runtime input is empty. Using INPUT.json fallback values.');
    }

    const startUrls = normalizeStartUrls(input);
    const resultsWanted = toPositiveInteger(input.results_wanted, 20);
    const maxPages = toPositiveInteger(input.max_pages, 5);
    const limitPerPage = DEFAULT_LIMIT_PER_PAGE;
    const sort = DEFAULT_SORT;
    const currency = DEFAULT_CURRENCY;
    const proxyConfigInput = input.proxyConfiguration;

    log.info(`Starting TripAdvisor hotels listing extraction. URLs=${startUrls.length}, results_wanted=${resultsWanted}, max_pages=${maxPages}, limit_per_page=${limitPerPage}`);

    let proxyUrl;
    if (proxyConfigInput) {
        try {
            const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfigInput);
            if (proxyConfiguration) proxyUrl = await proxyConfiguration.newUrl();
        } catch (error) {
            log.warning(`Proxy configuration could not be initialized. Continuing without proxy. ${error.message}`);
        }
    }

    const seenHotels = new Set();
    let pendingData = [];
    let savedHotels = 0;
    let totalPagesFetched = 0;
    let processedUrls = 0;
    const hotelsQueryIdsByGeo = {};
    const storedQueryId = await Actor.getValue(LATEST_HOTELS_QUERY_ID_STORE_KEY);
    const persistedQueryId = typeof storedQueryId === 'string' ? storedQueryId : undefined;
    let runResolvedHotelsQueryId;

    for (const startUrl of startUrls) {
        if ((savedHotels + pendingData.length) >= resultsWanted) break;

        const geoId = extractGeoIdFromUrl(startUrl);
        if (!geoId) {
            throw new Error(`Could not resolve geoId for URL: ${startUrl}. Use a Hotels URL containing -g<geoId>- in the path.`);
        }

        processedUrls += 1;
        const session = await initializeGraphqlSession({ startUrl, proxyUrl });
        log.info(`Session bootstrap for geoId=${geoId} returned HTTP ${session.statusCode}.`);
        if (!session.cookieHeader) {
            log.warning('Session bootstrap did not return cookies. Request may still work, but may be less reliable.');
        }

        let page = 0;
        let offset = 0;
        const pageviewId = crypto.randomUUID();
        const sessionId = crypto.randomUUID().replace(/-/g, '').toUpperCase();

        if (!runResolvedHotelsQueryId) {
            runResolvedHotelsQueryId = await resolveHotelsQueryId({
                startUrl,
                geoId,
                sort,
                currency,
                proxyUrl,
                cookieHeader: session.cookieHeader,
                pageviewId,
                sessionId,
                pageHtml: session.pageHtml,
                preferredQueryIds: [persistedQueryId],
            });
            await Actor.setValue(LATEST_HOTELS_QUERY_ID_STORE_KEY, runResolvedHotelsQueryId);
            log.info(`Resolved hotels listing query id for this run: ${runResolvedHotelsQueryId}`);
        }
        let hotelsQueryId = runResolvedHotelsQueryId;
        hotelsQueryIdsByGeo[geoId] = hotelsQueryId;

        let lastSearchMetadata;
        let lastSearchParameters;

        while ((savedHotels + pendingData.length) < resultsWanted && page < maxPages) {
            const remaining = resultsWanted - (savedHotels + pendingData.length);
            const limit = Math.min(limitPerPage, remaining);

            let batch;
            try {
                batch = await fetchHotelsPage({
                    queryId: hotelsQueryId,
                    startUrl,
                    geoId,
                    offset,
                    limit,
                    sort,
                    currency,
                    proxyUrl,
                    cookieHeader: session.cookieHeader,
                    pageviewId,
                    sessionId,
                });
            } catch (error) {
                if (!QUERY_ID_ERROR_PATTERN.test(error.message)) throw error;

                log.warning(`Hotels query id ${hotelsQueryId} failed. Auto-refreshing query id and retrying once.`);
                hotelsQueryId = await resolveHotelsQueryId({
                    startUrl,
                    geoId,
                    sort,
                    currency,
                    proxyUrl,
                    cookieHeader: session.cookieHeader,
                    pageviewId,
                    sessionId,
                    pageHtml: session.pageHtml,
                    preferredQueryIds: [hotelsQueryId, runResolvedHotelsQueryId],
                });
                runResolvedHotelsQueryId = hotelsQueryId;
                hotelsQueryIdsByGeo[geoId] = hotelsQueryId;
                await Actor.setValue(LATEST_HOTELS_QUERY_ID_STORE_KEY, hotelsQueryId);

                batch = await fetchHotelsPage({
                    queryId: hotelsQueryId,
                    startUrl,
                    geoId,
                    offset,
                    limit,
                    sort,
                    currency,
                    proxyUrl,
                    cookieHeader: session.cookieHeader,
                    pageviewId,
                    sessionId,
                });
            }

            const hotels = batch.results;
            lastSearchMetadata = batch.searchMetadata;
            lastSearchParameters = batch.searchParameters;

            if (!hotels.length) break;

            for (let index = 0; index < hotels.length; index++) {
                const rawHotel = hotels[index];
                const mappedHotel = mapHotelListing(rawHotel, {
                    startUrl,
                    geoId,
                    page: page + 1,
                    offset,
                    positionOnPage: index + 1,
                    searchMetadata: batch.searchMetadata,
                    searchParameters: batch.searchParameters,
                });

                if (!Object.keys(mappedHotel).length) continue;

                const dedupKey = mappedHotel.location_id || mappedHotel.hotel_result_key;
                if (!dedupKey || seenHotels.has(String(dedupKey))) continue;
                seenHotels.add(String(dedupKey));

                pendingData.push(mappedHotel);
                if (pendingData.length >= DATASET_PUSH_BATCH_SIZE) {
                    await Actor.pushData(pendingData);
                    savedHotels += pendingData.length;
                    pendingData = [];
                }

                if ((savedHotels + pendingData.length) >= resultsWanted) break;
            }

            page += 1;
            totalPagesFetched += 1;
            offset += hotels.length;

            const shouldStop = hotels.length < limit || batch.isComplete;
            log.info(`Progress: url=${processedUrls}/${startUrls.length}, geoId=${geoId}, page=${page}, offset=${offset}, collected=${savedHotels + pendingData.length}/${resultsWanted}`);
            if (shouldStop) break;
        }

        await Actor.setValue(`RUN_INFO_${geoId}`, {
            source_url: startUrl,
            geo_id: geoId,
            pages_fetched_for_url: page,
            fetched_until_offset: offset,
            search_total_locations: lastSearchMetadata?.totalLocationsInSearch,
            search_total_full_match: lastSearchMetadata?.totalLocationsFullMatch,
            search_geo_name: lastSearchParameters?.geo?.location?.locationV2?.names?.name,
            hotels_query_id: hotelsQueryId,
        });
    }

    if (pendingData.length) {
        await Actor.pushData(pendingData);
        savedHotels += pendingData.length;
    }

    if (!savedHotels) {
        throw new Error('No hotel listings were extracted. Try a different URL, lower protection with proxy, or provide geoId explicitly.');
    }

    await Actor.setValue('RUN_INFO', {
        start_urls: startUrls,
        requested_results: resultsWanted,
        saved_results: savedHotels,
        pages_fetched_total: totalPagesFetched,
        processed_urls: processedUrls,
        sort,
        currency,
        hotels_query_ids_by_geo: hotelsQueryIdsByGeo,
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
