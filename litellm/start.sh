#!/bin/sh
set -eu

# Extreme Memory optimization for 512MB RAM
export MALLOC_ARENA_MAX=2
export PYTHONMALLOC=malloc
export UVICORN_WORKER_COUNT=1

echo "Starting LiteLLM with strict memory limits on port ${PORT:-4000}..."
exec litellm --config /app/config.yaml --host 0.0.0.0 --port "${PORT:-4000}" --num_workers 1
