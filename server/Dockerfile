# Capture-only runner image. NO LLM calls happen during capture — it is pure Playwright, so this
# box needs CPU and a clean network, not an API key. (The judging step, which does call the API,
# reads ANTHROPIC_API_KEY separately.)
#
# BASE IMAGE + BROWSER ALIGNMENT — the bug this guards against:
# the Playwright base images ship browser builds pinned to their own version. runner/package.json
# asks for "^1.48.0", which npm resolves to whatever the latest 1.x is (1.61.1 today), so the
# library expected a browser revision the image did not contain. Every launch failed instantly
# with "Executable doesn't exist", producing zero valid conversations while the balancer logged
# nothing but strikes — a silent total failure. Installing the browser AFTER npm resolves the
# dependency guarantees the two always match, whatever npm picks.
FROM mcr.microsoft.com/playwright:v1.49.0-jammy

# xvfb: headed-only vendors (Rep AI, Kodif, Humind) need a real display.
# openssh-client: the repo deploy key pushes over SSH.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb git tini openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY runner/package*.json ./runner/
RUN cd runner && (npm ci --omit=dev || npm install --omit=dev) \
    && npx playwright install --with-deps chromium \
    && node -e "const v=require('playwright/package.json').version; console.log('playwright '+v+' + matching chromium installed')"

COPY . .

ENV BENCHMARK_CAPTURE_ORIGIN=server
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["bash","server/pipeline.sh"]
