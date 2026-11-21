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
# Operator panel (/admin): comma-separated emails of signed-in, verified accounts that may use it.
# Case-insensitive. Empty means nobody is an operator.
ADMIN_EMAILS = frozenset(e.strip().lower() for e in env("ADMIN_EMAILS").split(",") if e.strip())

# --- LLM
MODEL_NAME = env("MODEL_NAME", "gemma-4-26b-a4b-it")
GOOGLE_API_KEY = env("GOOGLE_API_KEY")

# --- optional module keys (a module that needs a missing key reports itself unavailable)
SCRAPING_API_URL = env("SCRAPING_API_URL", "https://api.firecrawl.dev")
SCRAPING_API_KEY = env("SCRAPING_API_KEY")
SERPAPI_KEY = env("SERPAPI_KEY")
GITHUB_TOKEN = env("GITHUB_TOKEN")

# --- limits
# Every search needs a signed-in (non-anonymous) account. Set to false to let anonymous
# sessions search again (name searches always need an account).
REQUIRE_SIGN_IN = env("REQUIRE_SIGN_IN", "true").lower() not in ("0", "false", "no", "off")
SCANS_PER_SESSION_PER_DAY = int(env("SCANS_PER_SESSION_PER_DAY", "20"))
SCANS_GLOBAL_PER_DAY = int(env("SCANS_GLOBAL_PER_DAY", "300"))
NAME_SEARCHES_PER_USER_PER_DAY = int(env("NAME_SEARCHES_PER_USER_PER_DAY", "5"))
# Short-window limits (fixed 10-minute windows). Per ORIGIN uses the hashed client IP, so a
# private window (a fresh anonymous session) does not reset them. The operator (ADMIN_EMAILS)
# is exempt from per-session and per-origin limits.
SEARCHES_PER_SESSION_PER_10M = int(env("SEARCHES_PER_SESSION_PER_10M", "3"))
SEARCHES_PER_ORIGIN_PER_10M = int(env("SEARCHES_PER_ORIGIN_PER_10M", "5"))
SEARCHES_PER_ORIGIN_PER_DAY = int(env("SEARCHES_PER_ORIGIN_PER_DAY", "30"))
# Unfinished searches a session may have at once (0 turns the check off).
ACTIVE_SEARCHES_PER_SESSION = int(env("ACTIVE_SEARCHES_PER_SESSION", "1"))
# Backlog guard: refuse new searches for a queue that already holds more queued jobs than this
# (0 turns it off). Applies to everyone, the operator included.
QUEUE_BACKLOG_MAX = int(env("QUEUE_BACKLOG_MAX", "80"))
# Rough seconds per job, used only for the "estimated wait" shown to a waiting visitor.
QUEUE_AVG_JOB_SECONDS = int(env("QUEUE_AVG_JOB_SECONDS", "15"))
JOB_STALE_SECONDS = int(env("JOB_STALE_SECONDS", "120"))
# Jobs one worker runs at once (most jobs wait on the network). At most one HEAVY module
# (Module.heavy, e.g. whatsmyname at ~400 MB) runs at a time; light jobs fill the other slots.
WORKER_CONCURRENCY = max(1, int(env("WORKER_CONCURRENCY", "3")))
# Profile-preview and avatar downloads in flight at once, shared by every job of a worker.
ENRICH_CONCURRENCY = max(1, int(env("ENRICH_CONCURRENCY", "4")))
# Concurrency cap for fan-out modules; sized for a 512 MB / 0.1 CPU Render free instance.
MAX_CONCURRENCY = int(env("MAX_CONCURRENCY", "20"))
