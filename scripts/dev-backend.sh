#!/bin/sh
# Start the gateway and the three workers locally (no Docker). Ctrl-C stops all of them.
cd "$(dirname "$0")"
trap 'kill 0' INT TERM EXIT
WORKER_QUEUE=identity uv run uvicorn worker.main:app --port 8101 --log-level warning &
WORKER_QUEUE=infra    uv run uvicorn worker.main:app --port 8102 --log-level warning &
WORKER_QUEUE=media    uv run uvicorn worker.main:app --port 8103 --log-level warning &
uv run uvicorn gateway.main:app --port 8000
