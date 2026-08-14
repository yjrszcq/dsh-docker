FROM node:24-bookworm-slim AS installer
ARG DSH_VERSION=latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        make \
        python3 \
    && npm install --global "@deepseek-ai/dsh@${DSH_VERSION}" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

FROM node:24-bookworm-slim

LABEL org.opencontainers.image.title="DeepSeek Harness" \
      org.opencontainers.image.description="Unofficial container image for DeepSeek Harness" \
      org.opencontainers.image.source="https://github.com/yjrszcq/dsh-docker" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        jq \
        openssh-client \
        procps \
        ripgrep \
        tini \
    && npm install --global "pnpm@11.7.0" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /usr/local/lib/node_modules/@deepseek-ai/dsh
RUN ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh

ENV DSH_HOME=/home/node/.dsh \
    DSH_TELEMETRY_DISABLED=true

COPY --chown=node:node docker.cordis.yml /opt/dsh/docker.cordis.yml
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node/.dsh /workspace

USER node
WORKDIR /workspace

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3080/ >/dev/null || exit 1

ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["dsh", "web", "--patch", "/opt/dsh/docker.cordis.yml"]
