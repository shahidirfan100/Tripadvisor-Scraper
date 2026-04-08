# API Discovery Notes

## Target

- Domain: `www.tripadvisor.com`
- Listing page example: `https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html`
- Discovery scan reference: `https://urlscan.io/result/019d4b7e-dd66-70c2-bafe-35ba9a9da03c/`

## Selected API

- Endpoint: `https://www.tripadvisor.com/data/graphql/ids`
- Method: `POST`
- Auth: No API key required
- Listing query id (current): `0ab60f652e82bad6`
- Pagination: `offset` + `limit` (effective limit up to 30)

## Why This API Was Selected

- Returns direct JSON: yes
- Supports pagination: yes (`offset`, `limit`)
- No key-based authentication: yes
- Field depth: high (hotel identity, ranking, pricing/offer, contact, geocode, media)
- Production viability: works with cookie bootstrap from listing page request

## Variables Used

Key variables in request payload:

- `geoId`
- `offset`
- `limit`
- `sort`
- `currency`
- `productId: "Hotels"`
- `viewType: "LIST"`
- `route.page: "HotelsFusion"`

## Field Coverage Added

Compared to the previous review-focused implementation, this listing implementation now collects:

- Hotel listing keys and IDs
- Hotel name and detail URL
- Rating and review count
- Ranking text and ranking position metadata
- Accommodation type and provider star rating
- Offer counts and lowest visible price
- Primary provider and primary offer price
- Address components (street/city/state/country/postal)
- Latitude/longitude coordinates
- Thumbnail image URL

## Runtime Notes

- Direct page request may return DataDome challenge (`HTTP 403`) but still sets cookies.
- Those cookies are sufficient for listing GraphQL requests in tested runs.
- Output pipeline compacts records recursively, removing null/empty values before dataset write.
- Query ID is now auto-resolved on every run (dynamic discovery first, then validated fallback), cached in KV as `LATEST_HOTELS_QUERY_ID`, and auto-refreshed if a mid-run query failure is detected.
