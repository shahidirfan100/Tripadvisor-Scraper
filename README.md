## What does Tripadvisor Hotels Scraper do?

Tripadvisor Hotels Scraper is a TripAdvisor hotel data extractor for collecting structured hotel listings from public city and hotel listing pages. Add one or more TripAdvisor Hotels URLs, choose the maximum number of results and pages, and receive a dataset with hotel names, ratings, review counts, prices, ranking context, awards, images, and location details when available.

The Actor is useful for travel market research, hotel competitor benchmarking, destination analysis, hospitality lead generation, and data enrichment. It accepts TripAdvisor URLs that contain a city or geographic identifier, including pages for destinations such as Istanbul, Dubai, London, Paris, or New York.

## Why use Tripadvisor Hotels Scraper?

- **Build hotel datasets quickly** - Collect listings from multiple destinations without manually copying hotel information.
- **Compare hotel performance** - Analyze ratings, review volume, visible price signals, awards, and ranking positions across properties.
- **Support destination research** - Organize hotels by source page, geographic identifier, shelf category, and position.
- **Enrich hotel records** - Optional proxy configuration can provide additional address, coordinates, amenities, phone, description, star rating, and detail-page price fields when those values are published.
- **Automate recurring collection** - Use Apify scheduling, API access, webhooks, dataset exports, and integrations for repeat research or monitoring workflows.
- **Keep results usable** - Empty values are removed and duplicate hotel listings are filtered before records are saved.

## What data can you extract from TripAdvisor?

Each dataset item represents one hotel listing. Only non-empty values are saved, so optional fields may not appear in every record.

### Hotel listing fields

| Field | Type | Description |
|-------|------|-------------|
| `item_type` | String | Record type, normally `hotel_shelf_listing`. |
| `source_url` | String | TripAdvisor Hotels page used for the collection. |
| `geo_id` | Integer | TripAdvisor geographic identifier for the destination. |
| `location_id` | Integer | TripAdvisor identifier for the hotel listing. |
| `hotel_name` | String | Hotel name. |
| `hotel_url` | String | Direct TripAdvisor hotel page URL. |
| `rating` | Number | Average hotel rating when available. |
| `reviews_count` | Integer | Total review count when available. |
| `lowest_offer` | String | Lowest visible offer text from the listing. |
| `best_award_type` | String | Best-of award type when provided. |
| `best_award_year` | Integer | Year associated with the award. |
| `thumbnail_url` | String | Hotel listing image URL. |
| `thumbnail_width` | Integer | Available thumbnail width. |
| `thumbnail_height` | Integer | Available thumbnail height. |
| `thumbnail_caption` | String | Image caption when available. |
| `thumbnail_lang` | String | Language code for thumbnail metadata when available. |
| `parent_geo_name` | String | Parent geographic area when available. |

### Ranking and location fields

| Field | Type | Description |
|-------|------|-------------|
| `shelf_type` | String | TripAdvisor shelf or collection category. |
| `shelf_title` | String | Display title of the shelf when available. |
| `shelf_is_complete` | Boolean | Whether the shelf indicates a complete result set. |
| `shelf_position` | Integer | Position of the shelf on the source page. |
| `shelf_see_all_url` | String | URL for viewing the full shelf when available. |
| `listing_position_on_shelf` | Integer | Hotel position within its shelf. |
| `ranking_type_text` | String | Ranking text shown on the hotel detail page when available. |
| `full_address` | String | Full hotel address when published. |
| `latitude` | Number | Hotel latitude when available. |
| `longitude` | Number | Hotel longitude when available. |
| `accommodation_type` | String | Accommodation type, such as `Hotel`, when available. |

### Review and detail enrichment fields

| Field | Type | Description |
|-------|------|-------------|
| `rating_histogram` | Object | Review totals grouped into five-, four-, three-, two-, and one-star ratings. |
| `sub_ratings` | Object | Category ratings such as cleanliness, location, rooms, service, sleep quality, and value. |
| `provider_star_rating` | Number | Hotel star rating when available on the detail page. |
| `amenities` | Array | Hotel amenities when published. |
| `hotel_description` | String | Hotel description when published. |
| `phone` | String | Hotel contact phone number when published. |
| `lowest_price` | String | Detail-page price text when available. |

## How to use Tripadvisor Hotels Scraper

1. Open the Actor in Apify Console.
2. Add one or more public TripAdvisor Hotels URLs to `startUrls`.
3. Set `results_wanted` to the maximum number of hotel records you want.
4. Set `max_pages` to control how many pages may be checked for each source URL.
5. Enable Apify Proxy when you want the optional detail-page enrichment fields.
6. Start the run and review the dataset preview.
7. Download the results or connect the dataset to your workflow.

The easiest starting point is a canonical TripAdvisor Hotels city URL containing a geographic identifier, for example `https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html`.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | Array of strings | No | Istanbul sample URL | One or more TripAdvisor Hotels city or listing URLs. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique hotel listings to save across all input URLs. |
| `max_pages` | Integer | No | `5` | Maximum number of pages to check for each source URL. |
| `proxyConfiguration` | Object | No | Proxy disabled | Optional Apify Proxy settings. Enable a suitable proxy when additional detail-page fields are needed or the target page is difficult to access. |

## Usage Examples

### Basic city hotel extraction

Collect up to 20 hotel listings from one destination page.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
  ],
  "results_wanted": 20,
  "max_pages": 5
}
```

### Collect hotels from multiple destinations

Use multiple city URLs in one run and save up to 120 unique listings.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
    "https://www.tripadvisor.com/Hotels-g295424-Dubai_Emirate_of_Dubai-Hotels.html"
  ],
  "results_wanted": 120,
  "max_pages": 10
}
```

### Collect additional hotel detail fields

Enable Apify Proxy when you want the Actor to attempt additional address, map, amenities, phone, description, star rating, ranking, and detail-page price fields.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
  ],
  "results_wanted": 50,
  "max_pages": 8,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": [
      "RESIDENTIAL"
    ]
  }
}
```

## Sample Output

This example shows one realistic hotel record. Optional values appear only when TripAdvisor publishes them and the relevant enrichment is available.

```json
{
  "item_type": "hotel_shelf_listing",
  "source_url": "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
  "geo_id": 293974,
  "shelf_type": "BEST_SELLER",
  "shelf_title": "Best sellers",
  "shelf_is_complete": false,
  "shelf_position": 1,
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
  "thumbnail_lang": "en",
  "parent_geo_name": "Istanbul Province",
  "rating_histogram": {
    "five": 650,
    "four": 35,
    "three": 10,
    "two": 3,
    "one": 2
  },
  "sub_ratings": {
    "cleanliness": 4.8,
    "location": 4.7,
    "rooms": 4.6,
    "service": 4.8,
    "sleepQuality": 4.7,
    "value": 4.5
  }
}
```

## Tips for best results

- Use complete, public TripAdvisor Hotels URLs. URLs containing `-g<geoId>-` are preferred for destination resolution.
- Start with `results_wanted: 20` and a small `max_pages` value before running a larger collection.
- Use separate source URLs for separate destinations so the dataset remains easy to filter and compare.
- Enable Apify Proxy for larger runs or when you need optional hotel detail fields.
- Expect some fields to be missing when the source page does not publish them. Missing fields do not necessarily indicate a failed run.
- Review the dataset preview after the first run and report changed page behavior through the Actor’s Issues tab.

## Integrations and export formats

- **Apify API** - Start runs and read dataset items from your own application.
- **Google Sheets** - Export hotel records for sorting, filtering, and comparison.
- **Airtable** - Create a searchable hotel research database.
- **Webhooks** - Notify downstream systems when a run finishes.
- **Make or Zapier** - Send new hotel data into no-code workflows.
- **JSON, CSV, Excel, and XML** - Download results in formats suited to APIs, analysis, reporting, and system imports.

## Frequently Asked Questions

### Can I scrape TripAdvisor hotels from multiple cities?

Yes. Add multiple city or listing URLs to `startUrls`; the Actor processes them in one run until `results_wanted` is reached.

### What is the maximum number of hotel results?

The Actor accepts a positive `results_wanted` value and saves up to that number of unique hotel listings. The practical total also depends on the number of listings available from the submitted pages.

### Does the Actor collect hotel reviews?

No. This Actor collects hotel listing and property information, including review totals and rating summaries. Use a dedicated review collection Actor when you need individual guest review text.

### Which fields require proxy configuration?

Core listing fields and rating summaries can be returned without a proxy. Address, coordinates, amenities, phone, description, provider star rating, ranking text, and detail-page price fields are optional and are more likely to be available when Apify Proxy is enabled.

### Can I export TripAdvisor hotel data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

### Can I schedule recurring hotel data collection?

Yes. Create an Apify schedule to run the Actor hourly, daily, weekly, or at a custom interval, then send completed results to a dataset, webhook, or connected integration.

### Why is a field missing from one hotel record?

Optional fields depend on the information published for that hotel and the enrichment available during the run. The Actor removes empty values, so a field is omitted instead of saved as `null`.

### Is it legal to scrape TripAdvisor data?

You are responsible for complying with TripAdvisor’s terms, applicable laws, privacy requirements, and any restrictions on how collected data may be used. Collect and use public data only for legitimate purposes.

## Related Actors

- [Tripadvisor Reviews Scraper](https://apify.com/shahidirfan/tripadvisor-reviews-scraper) - Collect individual hotel reviews, ratings, guest feedback, and review metadata from TripAdvisor hotel pages.
- [Agoda Hotels Scraper](https://apify.com/shahidirfan/agoda-hotels-scraper) - Collect hotel listings, prices, availability, ratings, review signals, and property details from Agoda for comparison with TripAdvisor data.

## Support

For issues, feature requests, or changed TripAdvisor page behavior, use the Issues tab on the Actor page in Apify Console. Include the input URL, run details, and the missing or unexpected field so the problem can be investigated.

## Legal Notice

This Actor is intended for legitimate collection of publicly available hotel listing information. Users are responsible for complying with applicable laws, website terms, privacy obligations, and responsible data-use practices.
