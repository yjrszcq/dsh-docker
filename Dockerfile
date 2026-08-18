FROM node:24-bookworm-slim AS installer
ARG DSH_VERSION=latest

COPY container/patches/directory-picker.mjs /tmp/patch-directory-picker.mjs
COPY container/patches/browser-loopback.mjs /tmp/patch-browser-loopback.mjs

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        make \
        python3 \
    && npm install --global "@deepseek-ai/dsh@${DSH_VERSION}" \
    && node /tmp/patch-directory-picker.mjs \
    && node /tmp/patch-browser-loopback.mjs \
    && rm /tmp/patch-directory-picker.mjs /tmp/patch-browser-loopback.mjs \
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
        sudo \
        tini \
    && groupadd --system dsh-sudo-true \
    && groupadd --system dsh-sudo-false \
    && npm install --global "pnpm@11.7.0" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY docker-sudoers /etc/sudoers.d/dsh-sudo
RUN chmod 440 /etc/sudoers.d/dsh-sudo \
    && visudo -cf /etc/sudoers.d/dsh-sudo

COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /usr/local/lib/node_modules/@deepseek-ai/dsh
RUN ln -s ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh

ENV DSH_HOME=/home/node/.dsh \
    DSH_DEFAULT_WORKSPACE=/workspace \
    DSH_PROXY_POLYFILL=true \
    DSH_TELEMETRY_DISABLED=true

COPY --chown=node:node container/gateway/package.json container/gateway/index.mjs /opt/dsh-gateway/
COPY --chown=node:node container/gateway/lib /opt/dsh-gateway/lib

RUN mkdir -p /home/node/.dsh /workspace \
    && chown -R node:node /home/node/.dsh /workspace

USER node
WORKDIR /workspace

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent --show-error http://127.0.0.1:3080/_dsh_gateway/health >/dev/null || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "/opt/dsh-gateway/index.mjs"]
