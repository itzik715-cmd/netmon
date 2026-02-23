#!/bin/sh
# Entrypoint for the NetMon backend.
# Uses a single worker because the application runs background tasks
# (APScheduler, FlowCollector) in the lifespan context — multiple
# workers would duplicate those tasks and exhaust file descriptors.
set -e

echo "Starting uvicorn with 1 worker (background tasks require single-process mode)"
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1
