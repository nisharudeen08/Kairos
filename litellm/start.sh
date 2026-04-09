#!/bin/sh
set -eu

# Memory optimization
export UVICORN_WORKER_COUNT=1
export PYTHONMALLOC=malloc

echo "Starting Lightweight LiteLLM on port ${PORT:-4000}..."
# Use python -m to ensure we use the installed package
exec python3 -m litellm --config /app/config.yaml --host 0.0.0.0 --port "${PORT:-4000}"
