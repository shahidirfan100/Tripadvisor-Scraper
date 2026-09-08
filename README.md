## What does Tripadvisor Hotels Scraper do?

Tripadvisor Hotels Scraper collects structured hotel listings from public TripAdvisor destination pages. Add one or more TripAdvisor Hotels URLs, set the number of results you need, and receive hotel names, ratings, review totals, rankings, prices, offers, addresses, coordinates, amenities, descriptions, contact details, awards, images, and review summaries when published.

The Actor is designed for travel market research, hotel competitor analysis, destination studies, hospitality lead generation, price comparison, and data enrichment. It follows hotel results beyond the first visible group, removes repeated sponsored or organic properties, and omits empty values from saved records.

## Why use Tripadvisor Hotels Scraper?

- **Collect larger destination datasets** - Gather results across multiple result pages instead of stopping after the first few hotel groups.
- **Compare hotel performance** - Analyze ratings, review volume, destination ranking, awards, accommodation type, and visible pricing.
- **Get property details in one record** - Receive addresses, coordinates, phone numbers, amenities, descriptions, neighborhoods, and photos when available.
- **Study hotel offers** - Compare lowest prices, offer counts, providers, currencies, payment timing, and rate attributes.
- **Keep data clean** - Duplicate hotels, null values, blank strings, invalid numeric ranges, and control characters are filtered before output.
- **Automate recurring research** - Schedule runs, export datasets, use webhooks, or connect results to spreadsheets and other systems.

## What data can you extract from TripAdvisor?

Each dataset item represents one unique hotel. Optional fields are omitted when TripAdvisor does not publish a value.

### Hotel identity and review fields

| Field | Type | Description |
|-------|------|-------------|
| `item_type` | String | Record category, currently `hotel_shelf_listing`. |
| `source_url` | String | TripAdvisor Hotels URL used for the result. |
| `geo_id` | Integer | TripAdvisor destination identifier. |
| `api_variant` | String | Source result family used for the record. |
| `hotel_result_key` | String | Result identifier supplied for the listing. |
| `location_id` | Integer | Unique TripAdvisor hotel identifier. |
| `hotel_name` | String | Hotel or property name. |
| `hotel_url` | String | Direct TripAdvisor hotel page URL. |
| `rating` | Number | Average guest rating from 0 to 5. |
| `reviews_count` | Integer | Published review total. |
| `rating_histogram` | Object | Review totals grouped by five, four, three, two, and one stars. |
| `sub_ratings` | Object | Category ratings such as cleanliness, location, rooms, service, sleep quality, and value. |
| `review_snippet` | Object | A published review excerpt with title, rating, date, reviewer, and URL when available. |

### Ranking, property, and location fields

| Field | Type | Description |
|-------|------|-------------|
| `listing_position_on_shelf` | Integer | Position encountered in the destination result sequence. |
| `ranking_type_text` | String | Human-readable destination ranking. |
| `ranking_position` | Integer | Numeric ranking position. |
| `ranking_out_of` | Integer | Number of properties represented by the ranking context. |
| `accommodation_type` | String | Property type, such as `Hotel`. |
| `accommodation_category` | String | TripAdvisor accommodation category. |
| `star_rating_tag_ids` | Array | Published star-rating classification tag identifiers. |
| `full_address` | String | Complete formatted hotel address. |
| `street_1` | String | Primary street address. |
| `street_2` | String | Secondary street address when published. |
| `city` | String | City name. |
| `state` | String | State or region when published. |
| `postal_code` | String | Postal code. |
| `country` | String | Country name. |
| `latitude` | Number | Latitude between -90 and 90. |
| `longitude` | Number | Longitude between -180 and 180. |
| `parent_geo_name` | String | Parent destination name. |
| `neighborhoods` | Array | Neighborhoods or areas containing the hotel. |
| `country_id` | Integer | TripAdvisor country identifier. |
| `iso_country_code` | String | ISO country code. |

### Price, offer, content, and media fields

| Field | Type | Description |
|-------|------|-------------|
| `lowest_price` | String | Lowest displayed price. |
| `lowest_offer` | String | Compatibility field containing the lowest displayed offer. |
| `offer_count` | Integer | Total number of offers found. |
| `available_offer_count` | Integer | Number of currently available offers. |
| `primary_offers` | Array | Offer details such as provider, price, currency, availability, and payment timing. |
| `secondary_offers` | Array | Additional offer details when available. |
| `price_range` | Object | Published minimum and maximum property price range. |
| `price_range_usd` | Object | Published price range expressed in US dollars. |
| `amenities` | Array | Highlighted amenity names. |
| `amenity_details` | Array | Amenity names, tag identifiers, and icons. |
| `hotel_description` | String | Published hotel description or property summary. |
| `phone` | String | Hotel telephone number. |
| `email` | String | Hotel email address when publicly supplied. |
| `best_award_type` | String | Active award type. |
| `best_award_year` | Integer | Active award year. |
| `thumbnail_url` | String | Hotel image URL. |
| `thumbnail_width` | Integer | Maximum source image width. |
| `thumbnail_height` | Integer | Maximum source image height. |
| `thumbnail_caption` | String | Image caption when published. |
| `thumbnail_lang` | String | Image language code. |
| `merchandising_labels` | Array | Labels such as sponsored placement or breakfast inclusion. |
| `special_offer` | Object | Published hotel special-offer details. |
| `is_sponsored` | Boolean | Whether the encountered result was sponsored. |
| `is_smb_or_kasm` | Boolean | Published property account classification flag. |

## How to use Tripadvisor Hotels Scraper

1. Open the Actor in Apify Console.
2. Add one or more public TripAdvisor Hotels destination URLs to `startUrls`, or provide a `destination` geo ID.
3. Optionally set a destination geo ID, stay dates, rooms, guests, and sorting.
4. Set `results_wanted` to the maximum number of unique hotels to save.
5. Set `max_pages` high enough for the requested result count.
6. Start the run and inspect the dataset preview.
7. Download the results or connect the dataset to your workflow.

Use a canonical destination URL containing `-g<geoId>-`, for example `https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html`.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrls` | Array of strings | No | Istanbul sample URL | One or more TripAdvisor Hotels destination or listing URLs. |
| `destination` | String | No | URL destination | Optional TripAdvisor destination geo ID. Paste digits only, such as `293974`; it overrides the destination in the submitted URLs. |
| `checkInDate` | String | No | — | Optional check-in date in `YYYY-MM-DD` format. |
| `checkOutDate` | String | No | — | Optional check-out date in `YYYY-MM-DD` format; must be after check-in. |
| `rooms` | Integer | No | — | Optional number of rooms for availability and pricing context. |
| `guests` | Integer | No | — | Optional number of adult guests for availability and pricing context. |
| `sorting` | String | No | `BEST_VALUE` | Result order: `BEST_VALUE`, `PRICE_LOW_TO_HIGH`, `DISTANCE`, or `POPULARITY`. |
| `results_wanted` | Integer | No | `20` | Maximum number of unique hotel records to save across all URLs. |
| `max_pages` | Integer | No | `5` | Maximum number of result pages to request for each URL. Each page normally contributes up to 30 new organic hotels plus possible sponsored placements. |

## Usage Examples

### Basic destination extraction

Collect up to 20 hotels from Istanbul using the default page limit.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
  ],
  "results_wanted": 20,
  "max_pages": 5,
  "checkInDate": "2026-10-15",
  "checkOutDate": "2026-10-18",
  "rooms": 1,
  "guests": 2,
  "sorting": "BEST_VALUE"
}
```

### Search with destination, occupancy, dates, and sorting

A URL is optional when `destination` is provided. Paste the geo ID as digits in the `destination` field. This example searches destination geo ID `293974` for a two-night stay for two guests and orders results from the lowest price upward.

```json
{
  "destination": "293974",
  "checkInDate": "2026-11-10",
  "checkOutDate": "2026-11-12",
  "rooms": 1,
  "guests": 2,
  "sorting": "PRICE_LOW_TO_HIGH",
  "results_wanted": 20,
  "max_pages": 5
}
```

The same search options were verified with `BEST_VALUE`, `DISTANCE`, and `POPULARITY` sorting. Use a complete check-in/check-out pair; checkout must be later than check-in.

### Collect more than the first hotel group

Collect up to 100 unique hotels. A five-page limit is normally enough for this request, although available totals vary by destination.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html"
  ],
  "results_wanted": 100,
  "max_pages": 5
}
```

### Compare multiple destinations

Collect hotels from Istanbul and Dubai in one run.

```json
{
  "startUrls": [
    "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
    "https://www.tripadvisor.com/Hotels-g295424-Dubai_Emirate_of_Dubai-Hotels.html"
  ],
  "results_wanted": 150,
  "max_pages": 8,
  "sorting": "POPULARITY"
}
```

## Sample Output

The following shortened example reflects the actual dataset structure. More optional fields may appear when published.

```json
{
  "item_type": "hotel_shelf_listing",
  "source_url": "https://www.tripadvisor.com/Hotels-g293974-Istanbul-Hotels.html",
  "geo_id": 293974,
  "location_id": 8364987,
  "hotel_name": "Romance Istanbul Hotel",
  "hotel_url": "https://www.tripadvisor.com/Hotel_Review-g293974-d8364987-Reviews-Romance_Istanbul_Hotel-Istanbul.html",
  "rating": 5,
  "reviews_count": 6752,
  "ranking_type_text": "#4 of 2,619 hotels in Istanbul",
  "ranking_position": 4,
  "accommodation_type": "Hotel",
  "lowest_price": "$121",
  "offer_count": 4,
  "available_offer_count": 3,
  "full_address": "Hudavendigar Cd. No:5, Istanbul 34110 Türkiye",
  "latitude": 41.01264,
  "longitude": 28.977962,
  "amenities": [
    "Pool",
    "Spa",
    "Restaurant",
    "Bar/Lounge"
  ],
  "hotel_description": "Charming hotel in Istanbul's old town with Ottoman-style decor and convenient access to historic sites.",
  "phone": "+90 212 512 86 76",
  "rating_histogram": {
    "five": 6120,
    "four": 410,
    "three": 120,
    "two": 48,
    "one": 54
  },
  "is_sponsored": false
}
```

## Tips for best results

- Use complete TripAdvisor Hotels URLs containing the destination geo ID.
- Start with `results_wanted: 20` to review the available fields before requesting a larger dataset.
- Use both check-in and check-out dates when you want date-aware offer context; checkout must be later than check-in.
- Set rooms and guests together when comparing availability for a specific party size.
- Allow roughly one page for every 25 to 30 unique hotels. Sponsored repeats can reduce the number of new records on a page.
- Increase `max_pages` when requesting hundreds of hotels or when the destination contains repeated promoted listings.
- Use separate source URLs for separate destinations so records are easy to group and compare.
- Optional fields are omitted rather than saved as `null` when TripAdvisor does not publish them.
- Report changed source behavior through the Actor's Issues tab with the input URL and run details.

## Integrations and export formats

- **Apify API** - Start runs and retrieve hotel datasets programmatically.
- **Google Sheets** - Export records for filtering, comparison, and reporting.
- **Airtable** - Build a searchable hotel research database.
- **Webhooks** - Notify downstream systems when a run finishes.
- **Make or Zapier** - Send results into no-code workflows.
- **JSON, CSV, Excel, and XML** - Download data in formats suited to analysis and system imports.

## Frequently Asked Questions

### Can I collect more than 48 hotels from one destination?

Yes. Set `results_wanted` above 48 and provide a sufficient `max_pages` value. The Actor follows successive result pages and removes repeated hotels before saving them.

### Can I scrape hotels from multiple cities?

Yes. Add multiple destination URLs to `startUrls`. The Actor processes them until it reaches the requested total or exhausts the configured page limits.

### Do the date, room, guest, and sorting options work together?

Yes. The Actor passes the selected dates and occupancy to the hotel search and supports `BEST_VALUE`, `PRICE_LOW_TO_HIGH`, `DISTANCE`, and `POPULARITY` sorting modes.

### Why are some optional fields absent?

TripAdvisor does not publish every field for every hotel. Empty and null values are omitted so exported records remain clean.

### Does the Actor collect individual reviews?

No. It collects hotel listings, review totals, rating summaries, sub-ratings, and an available review snippet. Use a dedicated reviews Actor for full individual review datasets.

### Can I export TripAdvisor hotel data to CSV or Excel?

Yes. Apify datasets support CSV, Excel, JSON, XML, and other export formats.

### Can I schedule recurring hotel collection?

Yes. Create an Apify schedule to run hourly, daily, weekly, or at another interval, then send results to a dataset, webhook, or integration.

### Is it legal to scrape TripAdvisor data?

You are responsible for complying with TripAdvisor's terms, applicable laws, privacy requirements, and restrictions on data use. Collect public data only for legitimate purposes.

## Related Actors

- [Tripadvisor Reviews Scraper](https://apify.com/shahidirfan/tripadvisor-reviews-scraper) - Collect individual hotel reviews, ratings, guest feedback, and review metadata.
- [Agoda Hotels Scraper](https://apify.com/shahidirfan/agoda-hotels-scraper) - Collect hotel listings, prices, availability, ratings, and property details from Agoda.

## Support

For issues, feature requests, or changed TripAdvisor behavior, use the Issues tab on the Actor page. Include the input URL, run details, and the unexpected field or result count.

## Legal Notice

This Actor is intended for legitimate collection of publicly available hotel listing information. Users are responsible for complying with applicable laws, website terms, privacy obligations, and responsible data-use practices.
