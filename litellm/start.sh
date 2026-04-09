#!/bin/sh
set -eu

# Memory optimization
export UVICORN_WORKER_COUNT=1
export PYTHONMALLOC=malloc

echo "Starting Lightweight LiteLLM on port ${PORT:-4000}..."
# Use the direct litellm command installed by pip
exec litellm --config /app/config.yaml --host 0.0.0.0 --port "${PORT:-4000}"
