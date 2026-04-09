FROM ghcr.io/berriai/litellm:main-latest-slim

COPY litellm/config.yaml /app/config.yaml
COPY litellm/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 4000

ENTRYPOINT ["/bin/sh", "/app/start.sh"]
