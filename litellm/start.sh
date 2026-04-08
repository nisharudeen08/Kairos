#!/bin/sh
set -eu

exec litellm --config /app/config.yaml --host 0.0.0.0 --port "${PORT:-4000}"
