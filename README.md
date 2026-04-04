# TripAdvisor Hotels Scraper

Extract TripAdvisor hotel listing data from city and listing pages into a clean, analytics-ready dataset. Collect ratings, ranking details, pricing signals, address fields, coordinates, and offer highlights at scale. Ideal for travel research, market analysis, and hotel intelligence workflows.

## Features

- **Hotels listing extraction** — Collect hotel cards from TripAdvisor Hotels pages.
- **City and listing URL support** — Use one or multiple source URLs in a single run.
- **Rich hotel fields** — Capture ranking, rating, address, geo coordinates, and pricing/offer details.
- **Pagination controls** — Set page limit and record limit to control run size.
- **Null-free output** — Empty values are automatically removed from each dataset item.
- **Duplicate-safe dataset** — Repeated listings are filtered before save.

## Use Cases

### Competitor Benchmarking
Track how hotels rank in a city and compare review volume, rating, and pricing signals across competing properties.

### Destination Intelligence
Build destination-level hotel datasets to understand supply, quality tiers, and neighborhood-level concentration.

### Travel Product Research
Feed listing data into pricing models, recommendation systems, or internal market dashboards.

### Sales and Lead Enrichment
Create hotel lead lists with location, contact, and ranking context for outreach and partnership workflows.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|---|---|---|---|---|
| `startUrls` | String Array | No | Istanbul Hotels sample | One or more TripAdvisor Hotels URLs as plain strings. |
| `results_wanted` | Integer | No | `20` | Maximum listings to collect across all URLs. |
| `max_pages` | Integer | No | `5` | Maximum pages to fetch per URL. |
| `proxyConfiguration` | Object | No | Apify Proxy preset | Proxy settings for better run stability. |

---

## Output Data

Each dataset item contains only non-empty fields.

| Field | Type | Description |
|---|---|---|
| `item_type` | String | Record type (`hotel_listing`). |
| `source_url` | String | Source Hotels page URL. |
| `geo_id` | Integer | TripAdvisor geo identifier used for extraction. |
| `hotel_result_key` | String | Unique listing key in result set. |
| `location_id` | Integer | TripAdvisor hotel location ID. |
| `hotel_name` | String | Hotel name. |
| `hotel_url` | String | Absolute hotel detail URL. |
| `rating` | Number | Average rating score. |
| `reviews_count` | Integer | Total number of reviews. |
| `ranking_type_text` | String | Localized ranking text. |
| `provider_star_rating` | Number | Star rating from listing metadata. |
| `accommodation_type` | String | Accommodation type label. |
| `lowest_price` | String | Lowest visible price text. |
| `offer_count` | Integer | Number of offers available. |
| `available_offer_count` | Integer | Number of currently available offers. |
| `primary_offer_price` | String | Primary offer display price. |
| `provider_name` | String | Offer provider name. |
| `thumbnail_url` | String | Listing image URL. |
| `full_address` | String | Full address text. |
| `city` | String | City from address. |
| `country` | String | Country from address. |
| `latitude` | Number | Latitude coordinate. |
| `longitude` | Number | Longitude coordinate. |

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
  "item_type": "hotel_listing",
  "source_url": "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
  "geo_id": 293974,
  "hotel_result_key": "12395785:s:MzM0ODMyMTU:1b0deade-0273-42a8-bdba-521b02fba032",
  "location_id": 12395785,
  "hotel_name": "ibis Istanbul Tuzla Hotel",
  "hotel_url": "https://www.tripadvisor.com/Hotel_Review-g293974-d12395785-Reviews-Ibis_Istanbul_Tuzla_Hotel-Istanbul.html",
  "rating": 4.2,
  "reviews_count": 151,
  "ranking_type_text": "#594 of 2,504 hotels in Istanbul",
  "provider_star_rating": 3,
  "accommodation_type": "Hotel",
  "lowest_price": "$65",
  "offer_count": 1,
  "available_offer_count": 1,
  "primary_offer_price": "$65",
  "provider_name": "all.accor.com",
  "thumbnail_url": "https://dynamic-media-cdn.tripadvisor.com/media/photo-o/27/be/43/7b/ibis-istanbul-tuzla-hotel.jpg?w=1200&h=800&s=1",
  "full_address": "Aydintepe Mah.selin Sok.no.7 Tuzla, Istanbul 34947 Türkiye",
  "city": "Istanbul",
  "country": "Türkiye",
  "latitude": 40.848927,
  "longitude": 29.296696
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

## Integrations

Connect your dataset with:

- **Google Sheets** — Share listing snapshots with business teams.
- **Airtable** — Build searchable hotel intelligence bases.
- **Make** — Automate recurring enrichment workflows.
- **Zapier** — Trigger actions from fresh listing runs.
- **Webhooks** — Push records into custom pipelines.

### Export Formats

- **JSON** — Best for automation and downstream processing.
- **CSV** — Best for spreadsheet analysis.
- **Excel** — Best for business reporting.
- **XML** — Best for legacy systems.

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
