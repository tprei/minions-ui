FROM node:22-slim AS devtools
WORKDIR /opt/devtools
RUN echo '{"name":"devtools","version":"0.0.0","dependencies":{"vitest":"*","typescript":"*","happy-dom":"*","jsdom":"*"}}' > package.json \
    && npm install --no-audit --no-fund --omit=optional \
    && sha256sum package.json > .devtools-version

FROM node:22-slim AS uv-base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python
RUN uv python install 3.13
ENV UV_TOOL_DIR=/opt/uv-tools UV_TOOL_BIN_DIR=/opt/uv-tools/bin
RUN uv tool install ruff && uv tool install pytest && uv tool install mypy

FROM node:22-slim AS playwright-base
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/pw-browsers && chmod 755 /opt/pw-browsers
RUN npx --yes @playwright/test@latest install --with-deps chromium

FROM oven/bun:1.2-debian AS final

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    git gh nodejs npm ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g \
      @anthropic-ai/claude-code \
      @playwright/mcp \
      @upstash/context7-mcp \
      github-mcp-server

COPY --from=devtools /opt/devtools /opt/devtools
COPY --from=uv-base /opt/uv-python /opt/uv-python
COPY --from=uv-base /opt/uv-tools /opt/uv-tools
COPY --from=uv-base /usr/local/bin/uv /usr/local/bin/uv
COPY --from=uv-base /usr/local/bin/uvx /usr/local/bin/uvx
COPY --from=playwright-base /opt/pw-browsers /opt/pw-browsers

RUN useradd -u 10001 -m -s /bin/bash minion

WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY tsconfig.server.json tsconfig.json ./

RUN mkdir -p /workspace /workspace/home && chown -R minion:minion /app /workspace /opt/devtools /opt/pw-browsers
USER minion

ENV PORT=8080 \
    WORKSPACE_ROOT=/workspace \
    HOME=/workspace/home \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_PYTHON_PREFERENCE=only-managed \
    UV_CACHE_DIR=/workspace/.uv-cache \
    UV_LINK_MODE=hardlink \
    PATH=/opt/uv-tools/bin:/usr/local/bin:/usr/bin:/bin \
    CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=30000

EXPOSE 8080
CMD ["bun", "run", "server/index.ts"]
