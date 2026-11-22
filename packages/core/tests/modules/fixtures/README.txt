Recorded upstream responses used by the offline module tests.

Recorded on 2026-11-19 against neutral public targets (example.com, 1.1.1.1, torvalds,
pg, the Bitcoin genesis address, a well-known public Ethereum address, test@example.com)
and trimmed to the fields the modules read:

  blockscout_*, blockstream_*, crtsh, doh, github_*, hn_search, internetdb,
  leakcheck_*, rdap_*, ripestat_*, stackexchange_*, wayback_first/last/years

Synthetic values in the real / documented response shape (the real answers describe
private people, or the endpoint needs a key or blocked the recording host):

  hudson_rock          shape recorded live; machines, IPs and logins replaced
  gravatar             shape recorded live; person replaced
  xposedornot_found    example from the official XposedOrNot-API README
  serpapi_google_lens  item shape from https://serpapi.com/google-lens-api
  firecrawl_scrape     Firecrawl v1 /scrape success shape
  wayback_urls         CDX JSON row format (header row + rows), same as the recorded ones

previews/*.html     real anonymous GETs of public organisational / brand profile pages
                    (and a few founders of the platforms themselves), recorded 2026-11-20
                    and trimmed to the tags a preview reads: <title>, og:/twitter:/profile:
                    meta, canonical, Person/ProfilePage JSON-LD and rel="me" links, verbatim.
                    Walls / blocks: replit, strava, lastfm, reddit, tiktok, pinterest.

Photo location check (geo_context), recorded 2026-11-22 around a public landmark (the Eiffel
Tower area of Paris, 48.86, 2.29):

  geo_openmeteo_archive    archive-api.open-meteo.com/v1/archive, 2025-06-13..15, hourly (live)
  geo_openmeteo_forecast   api.open-meteo.com/v1/forecast, 2026-11-20..22, hourly (live)
  geo_nominatim_reverse    nominatim.openstreetmap.org/reverse zoom=14 (live)
  geo_nominatim_search     nominatim.openstreetmap.org/search "Eiffel Tower, Paris" (live; it
                           includes a road, house number and postcode, which must never be stored)

Synthetic values in the documented response shape (the endpoint needs a key; a keyless request
answered 403 "Missing Header 'x-windy-api-key'" / 500 "Invalid OAuth 2.0 Access Token"):

  geo_windy_webcams        Windy Webcams API v3 /webcams (https://api.windy.com/webcams/docs)
  geo_mapillary_images     Mapillary Graph API /images (https://www.mapillary.com/developer/api-documentation)
