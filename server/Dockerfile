# Capture-only runner image. NO LLM calls happen here — capture is pure Playwright, so this
# box needs CPU + a clean network, not an API key. Judging/baking/deploying stays off-server.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# xvfb: the headed-only vendors (Rep AI, Kodif, Humind) need a real display to capture cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb git tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY runner/package*.json ./runner/
RUN cd runner && npm ci --omit=dev || npm install --omit=dev
COPY . .

ENV BENCHMARK_CAPTURE_ORIGIN=server
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["bash","server/pipeline.sh"]
