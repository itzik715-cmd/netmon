#!/bin/sh
# Entrypoint for the NetMon backend.
# Automatically selects worker count based on available CPUs (capped at 4).
# Override by setting WEB_CONCURRENCY in the environment.
set -e

if [ -z "$WEB_CONCURRENCY" ]; then
    WEB_CONCURRENCY=$(python3 -c "import os; print(min(os.cpu_count() or 1, 4))")
fi

echo "Starting uvicorn with $WEB_CONCURRENCY workers"
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "$WEB_CONCURRENCY"
