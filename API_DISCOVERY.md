# API Discovery Notes

## Target

- Domain: `www.tripadvisor.com`
- Listing page tested: `https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html`
- Discovery date: 2026-08-16

## Existing Actor Audit

The actor used two non-paginated hotel shelf operations:

- `32f2e254f7f08a0d` - `HPS_getUndatedHotelShelves`
- `6504d9cf4c74d5ae` - `HPS_getHotelsHomeShelves`

Changing `requestNumber` did not change either result set. Their union produced only about 46-48 unique hotels for Istanbul, so the actor could not honor larger `results_wanted` values.

Existing output fields included hotel identifiers and URLs, name, rating, review count, visible offer text, award data, thumbnail data, shelf metadata, rating histogram, and sub-ratings. Optional browser detail extraction attempted to add address, coordinates, amenities, description, phone, star rating, ranking, and detail-page price.

## Discovery Workflow

### URLScan.io

- Public scan search was available and checked first.
- Recent useful hotel-list network captures were not available in public search results.
- Submitting a new public scan returned `HTTP 401` because URLScan now requires an API key for scan submission in this environment.

### Desktop, mobile, and app-style HTTP probes

| Candidate | Header profile | Status/body | Expected JSON marker | Pagination | Decision |
|---|---|---:|---|---|---|
| Hotels page | Desktop Chrome | `403`, 775 bytes | Missing | N/A | Rejected as a bootstrap/data source |
| Hotels page | iOS Safari | `200`, 1,297,183 bytes | No stable hydration marker | N/A | Rejected in favor of the richer JSON operation |
| Hotels page | Android/okhttp | `200`, 1,603,786 bytes | No stable hydration marker | N/A | Rejected in favor of the richer JSON operation |
| `/data/graphql/ids` | Header-only desktop/iOS/Android replay | `400`, empty body | Missing | Unknown | Rejected; browser-derived session/request recipe is required |
| Old hotel list IDs | Impit Chrome impersonation | JSON schema error | Old list document references removed `marketingText` field | Offset/limit, but broken | Rejected |
| Shelf query `32f2e254f7f08a0d` | Impit Chrome impersonation | JSON OK | `HPS_getUndatedHotelShelves` | `requestNumber` repeats same results | Fallback only |
| Shelf query `6504d9cf4c74d5ae` | Impit Chrome impersonation | JSON OK | `HPS_getHotelsHomeShelves` | `requestNumber` repeats same results | Fallback only |
| Hotel list query `f101de74ce917363` | Patchright capture, then Impit replay | JSON OK, 177-262 KB per tested page | `data.list.results` | Working `offset`/`limit` | **Selected** |

### Patchright live-network capture

Headless Chrome received a DataDome stub. Patchright with a persistent real-Chrome context (`channel: 'chrome'`, `headless: false`, `noViewport: true`) loaded the hotel listing application and exposed the current persisted list operation.

The captured request used:

- Endpoint: `POST https://www.tripadvisor.com/data/graphql/ids`
- Persisted query ID: `f101de74ce917363`
- Data path: `data.list.results`
- Pagination variables: `offset`, `limit`
- Page size observed: `30` organic results, with some sponsored insertions
- The response includes `data.list.isComplete`, but live testing proved it is not a pagination terminal.

## Selected API

- Endpoint: `https://www.tripadvisor.com/data/graphql/ids`
- Method: `POST`
- Query ID: `f101de74ce917363`
- Auth: no account authentication; TripAdvisor session cookies and request headers are required
- Pagination: `offset` increments by `limit` (verified at offsets `0`, `30`, `60`, and `90`)
- Primary data path: `[0].data.list.results`
- Transport: Impit with Chrome impersonation (`browser: 'chrome'`, `ignoreTlsErrors: true`)
- Browser role: Patchright is an auto-healing fallback for discovering the current list query if the persisted ID rotates

### API score

| Factor | Points |
|---|---:|
| Returns JSON directly | 30 |
| More than 15 useful fields | 25 |
| No account authentication | 20 |
| Supports real pagination | 15 |
| Matches and extends existing fields | 10 |
| **Total** | **100** |

The score exceeds the required minimum of 50.

## Request Recipe

1. Bootstrap the submitted TripAdvisor page with Impit.
2. Reuse all response cookies on the GraphQL request when available.
3. Send a random 180-character `x-requested-by` value for each request.
4. Use the submitted listing URL as `referer` and `https://www.tripadvisor.com` as `origin`.
5. Keep a stable `pageviewId` and `sessionId` across pages in one source-URL run.
6. Increment `offset` by 30 and `requestNumber` by one.
7. Stop at an empty page, repeated no-new-result pages, `max_pages`, or `results_wanted`.

Required headers:

- `content-type: application/json`
- `origin: https://www.tripadvisor.com`
- `referer: <normalized start URL>`
- `x-requested-by: <random 180-character value>`
- `cookie: <bootstrap cookies>` when bootstrap supplied cookies

## Verified Listing Filters

The selected list operation accepts these runtime inputs without changing the output schema:

- `destination`: TripAdvisor destination geo ID. When provided, it overrides the geo ID read from each source URL; when no URL is supplied, the actor builds a canonical Hotels URL from this ID.
- `travelInfo`: `{ checkInDate, checkOutDate, rooms, adults, childrenAges, usedDefaultDates }`. Dates use `YYYY-MM-DD`; the actor sends default next-day dates only when a travel filter is requested without a complete valid date range.
- `sort`: verified values are `BEST_VALUE`, `PRICE_LOW_TO_HIGH`, `DISTANCE`, and `POPULARITY`.

Direct request checks returned hotel results for all four sort values. Unsupported values are normalized to `BEST_VALUE` with a warning rather than sent to GraphQL.

## Available Fields

The selected operation returns more data than both the old shelf feed and the former detail-page fallback:

- Identity: `hotelResultKey`, `locationId`, name, canonical hotel URL
- Reviews: rating and review count
- Ranking: localized category rank, rank number, and total properties
- Location: latitude, longitude, parent geography, neighborhoods, country ID/code
- Contact: full structured address and telephone
- Property: accommodation category/type, star-rating tags, SMB/KASM flag
- Content: generated property summary and review snippet
- Awards: active-year award type and year
- Media: thumbnail ID, caption, language, dynamic URL, dimensions
- Amenities: highlighted amenity names, IDs, and icons
- Pricing: price range, lowest price, offer counts, primary/secondary offers, provider, currency, base/display price, payment timing, mobile/member-rate flags
- Merchandising: labels and special-offer metadata

## Verified Pagination Outcome

Direct Impit replay returned:

| Offset | HTTP | Raw results |
|---:|---:|---:|
| 0 | 200 | 37 |
| 30 | 200 | 37 |
| 60 | 200 | 30 |
| 90 | 200 | 37 |

Sponsored properties can repeat between pages, so records must be deduplicated by `location_id` (with URL/result-key fallbacks). The tested offsets produced enough distinct hotels to prove the previous 48-listing ceiling is removed.

`data.list.isComplete` was `true` on the first response even though offsets 30, 60, and 90 returned additional hotels. The actor therefore records no completion decision from this flag and uses empty/repeated pages as the reliable terminal condition.

## Rejected Alternatives

- The shelf operations remain useful only as a degraded fallback because their `requestNumber` value does not paginate.
- The legacy list query IDs are unusable because their stored documents no longer match TripAdvisor's GraphQL schema.
- HTML/DOM parsing is slower, more fragile, and unnecessary because the selected JSON response includes address, coordinates, amenities, descriptions, pricing, and contact data.
- Per-hotel browser visits are unnecessary for normal extraction and would make larger runs too slow.

## Auto-Healing Strategy

If the selected persisted query returns `PersistedQueryNotFound`, a schema error, or no `data.list.results` value:

1. Launch Patchright using the high-security persistent Chrome pattern.
2. Observe `/data/graphql/ids` requests while loading the submitted Hotels page.
3. Select the request whose variables contain `offset`, `limit`, `geoId`, and `productId: "Hotels"`.
4. Validate that its response contains `data.list.results`.
5. Reuse the captured query ID and variable template for the remaining Impit requests.

If a DataDome challenge prevents Patchright from observing the request, inspect the public Hotels page JavaScript assets using the exact iOS Safari HTTP profile. The hotel-list bundle exposes a validator for `data.list.isComplete` and `data.list.results` beside the current 16-character persisted query ID. The discovered ID is still validated by an Impit request before any records are saved.

No cookies, authorization values, or captured query IDs are written to logs or datasets.
