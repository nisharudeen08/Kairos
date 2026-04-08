FROM ghcr.io/berriai/litellm:main-latest

COPY config.yaml /app/config.yaml

EXPOSE 4000

ENTRYPOINT []

CMD ["sh", "-c", "litellm --config /app/config.yaml --port ${PORT:-4000}"]
