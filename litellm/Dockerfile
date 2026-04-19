FROM python:3.11-slim

WORKDIR /app

# Install litellm with proxy support and Pillow for image processing
RUN pip install --no-cache-dir 'litellm[proxy]' Pillow

# Copy config and script
COPY litellm/config.yaml /app/config.yaml
COPY litellm/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 4000

# Optimization: reduce python memory footprint
ENV PYTHONUNBUFFERED=1
ENV MALLOC_ARENA_MAX=2

ENTRYPOINT ["/bin/sh", "/app/start.sh"]
