FROM ghcr.io/berriai/litellm:main-latest

COPY litellm/config.yaml /app/config.yaml

EXPOSE 4000

ENTRYPOINT []

CMD ["sh", "-c", "litellm --config /app/config.yaml --host 0.0.0.0 --port ${PORT:-4000}"]
