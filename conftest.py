"""Settings that must not leak from a developer's local .env into the offline tests.

python-dotenv never overrides variables that are already set, so pinning them here (before
sherlock_core.config is imported) keeps the suite independent of local-only settings."""
import os

os.environ["QUEUE_PREFIX"] = ""
