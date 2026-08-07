import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

MODEL_NAME = os.getenv("MODEL_NAME", "gemma-4-26b-a4b-it")
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
SPIDERFOOT_URL = os.getenv("SPIDERFOOT_URL", "http://localhost:5001")

# Optional: web scraping service for enrichment (Firecrawl-compatible API)
# Sign up at https://firecrawl.dev (or any service implementing the same
# /v1/scrape POST endpoint with Bearer auth). When unset, /enrich returns
# 503 with a hint to configure SCRAPING_API_KEY.
SCRAPING_API_URL = os.getenv("SCRAPING_API_URL", "https://api.firecrawl.dev")
SCRAPING_API_KEY = os.getenv("SCRAPING_API_KEY", "")

OUT_DIR = Path(__file__).resolve().parent.parent / "out"

USER_SCANNER_RATE = {"requests_per_min": 10, "jitter_s": (0.5, 2.0)}
SF_SCAN_TIMEOUT_S = int(os.getenv("SF_SCAN_TIMEOUT", "900"))
