# The full daily-loop image: capture (Playwright, no LLM calls) followed by judge → bake → gate →
# deploy. Capture needs CPU and a clean network; judging needs ANTHROPIC_API_KEY and deploying needs
# VERCEL_TOKEN, both supplied as Fly secrets and never baked in here.
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
# curl: Slack webhook posts from publish.sh.
RUN apt-get update && apt-get install -y --no-install-recommends xvfb git tini openssh-client curl \
    && rm -rf /var/lib/apt/lists/*

# Vercel CLI, version-pinned and baked in. Pinned because a CLI major bump that changes flag
# behaviour would break the nightly deploy silently; baked in because resolving it from npm at
# deploy time puts a registry download on the critical path of an unattended job.
RUN npm install -g vercel@53 && vercel --version

WORKDIR /app
COPY runner/package*.json ./runner/
RUN cd runner && (npm ci --omit=dev || npm install --omit=dev) \
    && npx playwright install --with-deps chromium \
    && node -e "const v=require('playwright/package.json').version; console.log('playwright '+v+' + matching chromium installed')"

COPY . .

ENV BENCHMARK_CAPTURE_ORIGIN=server
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["bash","server/pipeline.sh"]
