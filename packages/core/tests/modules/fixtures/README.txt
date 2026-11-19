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
