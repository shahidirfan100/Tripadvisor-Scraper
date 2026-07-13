# API Discovery Notes

## Target

- Domain: `www.tripadvisor.com`
- Listing page example: `https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html`

## Problem Observed

- Previous list query IDs (`0ab60f652e82bad6`, `fba19361f0ea0116`) now fail with:
  - `Cannot query field "marketingText" on type "HPS_WebHLMetaOffer". Did you mean "savingsText"?`
- This indicates persisted query drift (backend schema evolved, old query documents became incompatible).

## Selected API (Working Replacement)

- Endpoint: `https://www.tripadvisor.com/data/graphql/ids`
- Method: `POST`
- Primary query id: `32f2e254f7f08a0d`
- Primary data path: `HPS_getUndatedHotelShelves.shelves`
- Fallback query id: `6504d9cf4c74d5ae`
- Fallback data path: `HPS_getHotelsHomeShelves.shelves`

## Variables Used (Primary Query)

- `geoId`
- `currency`
- `pageviewId`
- `sessionId`
- `deviceType` (`DESKTOP`)
- `locale` (`en-US`)
- `requestCaller` (`Hotels`)
- `requestNumber` (`0`)

## Field Coverage

Current mapping from shelf items includes:

- `location_id`, `hotel_name`, `hotel_url`
- `lowest_offer`
- `rating`, `reviews_count`
- `best_award_type`, `best_award_year`
- `thumbnail_url`, `thumbnail_caption`, `thumbnail_lang`
- `shelf_type`, `shelf_title`, `shelf_see_all_url`, shelf/item positions

## Request Recipe (verified working via impit)

Endpoint: `POST https://www.tripadvisor.com/data/graphql/ids`
Body: JSON array of `{ variables, extensions: { preRegisteredQueryId } }`.
Headers (all required; missing/bad ones => 403/empty):

- `content-type: application/json`
- `origin: https://www.tripadvisor.com`
- `referer: <startUrl>`  (e.g. `https://www.tripadvisor.com/Hotel_Review-g293974-d<id>-Istanbul.html`)
- `x-requested-by: <random 180-char alnum string>`  (real browser sends a random tracking id, NOT the literal `tripadvisor.com`)
- `cookie: <from bootstrap>`

Bootstrap: `GET https://www.tripadvisor.com/<any-page>` returns `HTTP 403` (DataDome challenge)
**but still sets working session cookies** (`TAID`, `TASession`, ...). Reuse those cookies on the GraphQL call.

### How impit bypasses the blocking

- `new Impit({ browser: 'chrome', ignoreTlsErrors: true })`
  - `browser: 'chrome'` makes impit mimic Chrome's **TLS/JA3 fingerprint** (this is exactly what `curl_cffi` `impersonate="chrome"` does in the jios325 scraper — same technique). This is what gets GraphQL requests past DataDome.
  - The `/data/graphql/ids` (persisted queries) layer is **asymmetric**: it is reachable without a proxy from a clean IP, whereas the **HTML pages** (`Hotel_Review`, `Hotels-gXXX`) are fully DataDome-challenged (403 stub) and need a residential proxy + headless browser to solve the JS challenge.

## Rich-Data Query Map (verified live)

> ⚠️ Persisted query IDs **rotate**. IDs confirmed live on 2026-07-13 from this IP. Some that work in 2025/2026 blog repos now return `PersistedQueryNotFound` (e.g. typeahead `84b17ed122fbdbd4`, offers `1ad9fb68f3f0cdaf`, keywords `0ec4a283a4c8326d`). Treat IDs as potentially volatile; the working set below was the stable subset.

| Query ID | Input | Returns | Enrichment value |
|---|---|---|---|
| `32f2e254f7f08a0d` | geoId, currency, locale, deviceType | `HPS_getUndatedHotelShelves.shelves` | **Primary hotel LIST** |
| `6504d9cf4c74d5ae` | geoId, currency, locale, deviceType | `HPS_getHotelsHomeShelves.shelves` | List fallback (different hotels) |
| `b6d4e00c5b27f98e` | locationId | `locations[0].reviewAggregations.ratingCounts` + `reviewSummaryInfo[0].responseData` | **Rating histogram** (5/4/3/2/1 counts) + (rating, count) |
| `6d1d0d458eddcc5f` | locationId | `hotelSubratingsData[0].subRatings` | **Sub-ratings**: cleanliness, location, rooms, service, sleepQuality, value (0-5) |
| `9365c2244f5b46a6` | locationId, limit, offset, filters, sort | `ReviewsProxy_getReviewListPageForLocation` | Reviews (title/text/rating/date) |
| `ef1a9f94012220d3` | locationId, currency, locale, limit, offset | review list | Reviews (alternate) |
| `5a248f7d0220cca5` | locationId, albumId, photosLimit | `mediaAlbum`, `mediaAlbumPage.mediaList` | Photos |
| `a74001171c4cc850` | locationId, offset, limit | `QuestionsAndAnswers_getQuestionsByLocations` | Tips / Q&A |
| `6ba0d709c01afcf1` | locationId | `activeNotices` | Management notices |
| `37f9b1acc4b3620f` | geoId | `locations[0].locationTimezoneId` | Geo timezone only (thin) |

### NOT available via GraphQL (live)

The full rich hotel object — **address, `latitude`, `longitude`, `hotelClass`/`starRating`, `amenities`, `description`, `phone`** — is **not** returned by any reachable persisted query. Per ScrapFly (2026) and webscraper.io prebuilt, this data is server-rendered into the **Hotel_Review HTML** as hidden web data (`aggregateRating` JSON-LD + amenity elements) and is **DataDome-protected**. To capture it you need a residential proxy + headless browser (Playwright/patchright) to pass the challenge, then parse the hidden data.

## Runtime Notes

- Bootstrap page may return `HTTP 403` with challenge, but cookie bootstrap still allows GraphQL calls.
- Shelf payload is geo-aware and stable for current schema.
- This endpoint does not expose old list-page pagination (`offset/limit`) in the same shape; actor now collects from returned shelf buckets and deduplicates records.

## Deep Pagination Review (2026-06-01)

### A. Legacy list pagination query IDs

- Tested IDs: `0ab60f652e82bad6`, `fba19361f0ea0116`
- Result: both execute but fail with schema error:
  - `Cannot query field "marketingText" on type "HPS_WebHLMetaOffer". Did you mean "savingsText"?`
- Conclusion: old `offset/limit` list operation is currently unusable.

### B. Candidate query-id sweep

- Extracted 31 candidate IDs from public scraper references and validated directly against `data/graphql/ids`.
- Outcomes:
  - Most candidates: `PersistedQueryNotFound`
  - One live non-list query: `ef1a9f94012220d3` (`locationId`-required, not city-list pagination)
  - Two live city-list-adjacent queries: `32f2e254f7f08a0d`, `6504d9cf4c74d5ae`

### C. Request-number / caller matrix on live shelves queries

- For `32f2e254f7f08a0d` with `requestCaller=Hotels`, `requestNumber` from `0..20`:
  - always `3 shelves`, `22` unique hotels
- For other callers (`HotelsList`, `HotelsFusion`, `Search`, `Hotel_Review`):
  - `0` shelves
- For `6504d9cf4c74d5ae`, `requestNumber` from `0..20`:
  - always `1 shelf`, `25` unique hotels
- Cross-query union (same geo):
  - `22` (undated) + `25` (home) with `1` overlap = `46` unique hotels

### D. URLScan status

- Search API still works for listing scan metadata.
- Detailed result retrieval and scan submission now require API key in this environment, so discovery relied on live GraphQL validation instead.

## Final Endpoint Strategy

- Keep using `https://www.tripadvisor.com/data/graphql/ids`.
- Aggregate all successful shelves strategies per page pass:
  - `HPS_getUndatedHotelShelves` (`32f2e254f7f08a0d`)
  - `HPS_getHotelsHomeShelves` (`6504d9cf4c74d5ae`)
- Deduplicate by `location_id` / URL.
- Stop on repeated stall pages (no new records).

### Verified outcome

- With input `results_wanted=200`, `max_pages=8`, `geoId=293974`:
  - before strategy aggregation: `22` unique hotels
  - after strategy aggregation: `46` unique hotels
