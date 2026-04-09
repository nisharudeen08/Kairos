#!/bin/sh
set -eu

# Python Memory limits
export MALLOC_ARENA_MAX=2
export PYTHONMALLOC=malloc

echo "Checking config and starting LiteLLM..."
# We use --port with the Render-provided $PORT variable
exec litellm --config /app/config.yaml --host 0.0.0.0 --port "${PORT:-4000}"
