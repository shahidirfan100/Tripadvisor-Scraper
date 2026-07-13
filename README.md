# TripAdvisor Hotels Scraper

Extract hotel listings from TripAdvisor city and listing pages into a clean, analytics-ready dataset. Collect hotel names, ratings, review counts, pricing signals, awards, and image metadata at scale. Ideal for travel research, market analysis, and hotel intelligence workflows.

## Features

- **Hotel listing extraction** - Collect hotel cards from TripAdvisor Hotels pages.
- **City and listing URL support** - Use one or multiple source URLs in a single run.
- **Rich hotel fields** - Capture hotel name, rating, review volume, pricing signals, awards, and thumbnail imagery.
- **GraphQL enrichment** - Every hotel is enriched with a rating histogram (5/4/3/2/1 star counts), review summary, and category sub-ratings (cleanliness, location, rooms, service, sleep quality, value) via TripAdvisor's persisted GraphQL queries.
- **Browser detail enrichment** - When a proxy is configured, each hotel detail page is loaded with a headless browser to capture address, latitude/longitude, amenities, star rating, phone, and description.
- **Shelf and ranking context** - See which curated shelf each hotel appeared in and its position.
- **Pagination controls** - Set page limit and record limit to control run size.
- **Null-free output** - Empty values are automatically removed from each dataset item.
- **Duplicate-safe dataset** - Repeated listings are filtered before save.

## Use Cases

### Competitor Benchmarking
Track how hotels rank in a city and compare review volume, rating, and pricing signals across competing properties.

### Destination Intelligence
Build destination-level hotel datasets to understand supply, quality tiers, and neighborhood-level concentration.

### Travel Product Research
Feed listing data into pricing models, recommendation systems, or internal market dashboards.

### Sales and Lead Enrichment
Create hotel lead lists with location, ranking, and review context for outreach and partnership workflows.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | String Array | No | Istanbul Hotels sample | One or more TripAdvisor Hotels URLs as plain strings. |
| `results_wanted` | Integer | No | `20` | Maximum listings to collect across all URLs. |
| `max_pages` | Integer | No | `5` | Maximum pages to fetch per URL. |
| `proxyConfiguration` | Object | No | Apify Proxy preset | Proxy settings for better run stability. |

---

## Output Data

Each dataset item contains only non-empty fields. A typical record includes the fields below; some fields such as `best_award_type` or `thumbnail_caption` appear only when the source provides them.

| Field | Type | Description |
|-------|------|-------------|
| `item_type` | String | Record type (`hotel_shelf_listing`). |
| `source_url` | String | Source Hotels page URL. |
| `geo_id` | Integer | TripAdvisor geo identifier used for extraction. |
| `api_variant` | String | Internal listing strategy that produced the record. |
| `shelf_type` | String | Curated shelf category such as BEST_SELLER. |
| `shelf_title` | String | Display title of the shelf, when available. |
| `shelf_is_complete` | Boolean | Whether the shelf returned its full set of items. |
| `shelf_position` | Integer | Position of the shelf within the page. |
| `shelf_see_all_url` | String | Link to view all hotels in the shelf. |
| `listing_position_on_shelf` | Integer | Position of the hotel within its shelf. |
| `location_id` | Integer | TripAdvisor hotel location ID. |
| `hotel_name` | String | Hotel name. |
| `hotel_url` | String | Absolute hotel detail URL. |
| `lowest_offer` | String | Lowest visible price text. |
| `rating` | Number | Average rating score. |
| `reviews_count` | Integer | Total number of reviews. |
| `best_award_type` | String | Best-of award type, when the hotel earned one. |
| `best_award_year` | Integer | Year of the best-of award. |
| `thumbnail_url` | String | Listing image URL. |
| `thumbnail_width` | Integer | Native width of the thumbnail image. |
| `thumbnail_height` | Integer | Native height of the thumbnail image. |
| `thumbnail_caption` | String | Image caption, when available. |
| `thumbnail_lang` | String | Language code of the thumbnail metadata. |
| `parent_geo_name` | String | Parent geographic area, when available. |
| `rating_histogram` | Object | Review count by star rating (five/four/three/two/one). Added by GraphQL enrichment. |
| `sub_ratings` | Object | Category sub-ratings (cleanliness, location, rooms, service, sleepQuality, value). Added by GraphQL enrichment. |
| `full_address` | String | Street address from the hotel detail page. Added when browser enrichment runs (requires proxy). |
| `latitude` | Number | Hotel latitude. Added when browser enrichment runs (requires proxy). |
| `longitude` | Number | Hotel longitude. Added when browser enrichment runs (requires proxy). |
| `provider_star_rating` | Number | Provider star rating from the detail page. Added when browser enrichment runs (requires proxy). |
| `amenities` | Array | Hotel amenities from the detail page. Added when browser enrichment runs (requires proxy). |
| `hotel_description` | String | Hotel description. Added when browser enrichment runs (requires proxy). |
| `phone` | String | Hotel contact phone. Added when browser enrichment runs (requires proxy). |

---

## Enrichment Layers

- **GraphQL (always on)** - After collecting hotel cards, the actor calls TripAdvisor's persisted GraphQL queries per hotel to attach the rating histogram, review summary, and sub-ratings. No browser or proxy required.
- **Browser detail (proxy required)** - When `proxyConfiguration` is set, the actor launches a headless Chromium browser (via Playwright) and loads each hotel detail page to parse hidden `application/ld+json` data plus amenity/ranking/price elements. Without a proxy the browser layer is skipped and the run still succeeds with the GraphQL-enriched fields only.

---

## Usage Examples

### Single City URL

```json
{
    "startUrls": [
        "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
    ],
    "results_wanted": 20
}
```

### Multiple Cities

```json
{
    "startUrls": [
        "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
        "https://www.tripadvisor.com/Hotels-g294226-Dubai_Emirate_of_Dubai-Hotels.html"
    ],
    "results_wanted": 120,
    "max_pages": 10
}
```

### Basic Extended Collection

```json
{
    "startUrls": [
        "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
    ],
    "results_wanted": 50,
    "max_pages": 8
}
```

---

## Sample Output

```json
{
    "item_type": "hotel_shelf_listing",
    "source_url": "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
    "geo_id": 293974,
    "api_variant": "HPS_getUndatedHotelShelves",
    "shelf_type": "BEST_SELLER",
    "shelf_is_complete": false,
    "shelf_position": 1,
    "shelf_see_all_url": "https://www.tripadvisor.com/ClientLink?value=dWhyXy9Ib3RlbHMtZzI5Mzk3NC1hX3NvcnQuUE9QVUxBUklUWS1Jc3RhbmJ1bC1Ib3RlbHMuaHRtbF8wemk%3D",
    "listing_position_on_shelf": 2,
    "location_id": 4990603,
    "hotel_name": "Golden Horn Bosphorus Hotel",
    "hotel_url": "https://www.tripadvisor.com/Hotel_Review-g293974-d4990603-Reviews-Golden_Horn_Bosphorus_Hotel-Istanbul.html",
    "lowest_offer": "$113",
    "rating": 5,
    "reviews_count": 700,
    "best_award_type": "BOTB",
    "best_award_year": 2026,
    "thumbnail_url": "https://dynamic-media-cdn.tripadvisor.com/media/photo-o/2d/3c/fa/12/caption.jpg?w=1200&h=800&s=1",
    "thumbnail_width": 6757,
    "thumbnail_height": 5464,
    "thumbnail_lang": "en"
}
```

---

## Tips for Best Results

### Use Stable Hotels URLs
- Prefer URLs that include `-g<geoId>-` for direct city resolution.
- Keep URLs canonical to reduce routing issues.

### Keep QA-Friendly Limits
- Use `results_wanted: 20` for quick validation.
- Increase gradually for production collections.

### Improve Reliability
- Enable residential proxies for protected traffic.
- Retry with smaller run sizes when testing new URLs.

---

## Proxy Configuration

For reliable results on protected pages, residential proxies are recommended:

```json
{
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"]
    }
}
```

---

## Integrations

Connect your data with:

- **Google Sheets** - Export for analysis.
- **Airtable** - Build searchable databases.
- **Slack** - Get notifications.
- **Webhooks** - Send to custom endpoints.
- **Make** - Create automated workflows.
- **Zapier** - Trigger actions.

### Export Formats

Download data in multiple formats:

- **JSON** - For developers and APIs.
- **CSV** - For spreadsheet analysis.
- **Excel** - For business reporting.
- **XML** - For system integrations.

---

## Frequently Asked Questions

### Does the actor support multiple source URLs?
Yes. Add multiple values in `startUrls` and collect listings across them in one run.

### Are null values saved in the dataset?
No. Empty and null fields are removed before records are stored.

### How is duplicate data handled?
Listings are deduplicated by listing identifiers before saving.

### What URL format should I use?
Use a TripAdvisor Hotels URL that includes `-g<geoId>-`, such as city listing pages.

### What fields can be missing from a record?
Some fields are optional in the source, such as `best_award_type`, `thumbnail_caption`, or `parent_geo_name`. They appear only when the hotel provides them.

### How can I reduce blocked runs?
Use Apify residential proxies and start with smaller collection sizes.

---

## Support

For issues or feature requests, contact support through the Apify Console.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/platform/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection. You are responsible for complying with website terms and applicable laws in your jurisdiction.
