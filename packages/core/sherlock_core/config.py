"""Environment configuration shared by every service. Read once at import."""
import os

from dotenv import load_dotenv

load_dotenv()


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


# --- storage
SUPABASE_URL = env("SUPABASE_URL")
SUPABASE_SERVICE_KEY = env("SUPABASE_SERVICE_KEY")

# --- services
# Shared secret used by the gateway to sign wake calls to workers (HMAC-SHA256).
INTERNAL_SECRET = env("INTERNAL_SECRET")
# Public base URL of each worker, e.g. WORKER_URL_IDENTITY=https://sherlock-worker-identity.onrender.com
WORKER_URLS = {q: env(f"WORKER_URL_{q.upper()}") for q in ("identity", "infra", "media")}
# Which queue this worker process serves.
WORKER_QUEUE = env("WORKER_QUEUE", "identity")
FRONTEND_ORIGINS = [o.strip() for o in env("FRONTEND_ORIGINS").split(",") if o.strip()]

# --- LLM
MODEL_NAME = env("MODEL_NAME", "gemma-4-26b-a4b-it")
GOOGLE_API_KEY = env("GOOGLE_API_KEY")

# --- optional module keys (a module that needs a missing key reports itself unavailable)
SCRAPING_API_URL = env("SCRAPING_API_URL", "https://api.firecrawl.dev")
SCRAPING_API_KEY = env("SCRAPING_API_KEY")
SERPAPI_KEY = env("SERPAPI_KEY")
GITHUB_TOKEN = env("GITHUB_TOKEN")

# --- limits
SCANS_PER_SESSION_PER_DAY = int(env("SCANS_PER_SESSION_PER_DAY", "20"))
SCANS_GLOBAL_PER_DAY = int(env("SCANS_GLOBAL_PER_DAY", "300"))
NAME_SEARCHES_PER_USER_PER_DAY = int(env("NAME_SEARCHES_PER_USER_PER_DAY", "5"))
JOB_STALE_SECONDS = int(env("JOB_STALE_SECONDS", "120"))
# Concurrency cap for fan-out modules; sized for a 512 MB / 0.1 CPU Render free instance.
MAX_CONCURRENCY = int(env("MAX_CONCURRENCY", "20"))
