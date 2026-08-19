FROM node:24-bookworm-slim AS installer
ARG DSH_VERSION=latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        make \
        python3 \
    && npm install --global "@deepseek-ai/dsh@${DSH_VERSION}" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

FROM node:24-bookworm-slim AS platform-seed
COPY container /opt/dsh-platform-source
COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /opt/installed-dsh
RUN node /opt/dsh-platform-source/platform/tools/build-seed.mjs \
      /opt/installed-dsh /opt/dsh-platform-seed

FROM node:24-bookworm-slim AS runtime
ARG PNPM_VERSION=11.7.0

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
        python3 \
        python3-venv \
        ripgrep \
        sudo \
        tini \
    && groupadd --system dsh-sudo-true \
    && groupadd --system dsh-sudo-false \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY docker-sudoers /etc/sudoers.d/dsh-sudo
RUN chmod 440 /etc/sudoers.d/dsh-sudo \
    && visudo -cf /etc/sudoers.d/dsh-sudo

COPY --from=platform-seed /opt/dsh-platform-seed /opt/dsh-platform/seed
COPY container/platform /opt/dsh-platform/runtime/platform
COPY container/control-plane /opt/dsh-platform/runtime/control-plane
COPY container/platform/tools/dsh-shim.sh /usr/local/bin/dsh
RUN chmod 755 /usr/local/bin/dsh \
    && printf '%s\n' '#!/bin/sh' 'exec /usr/local/bin/node /opt/dsh-platform/runtime/control-plane/services/management/dsh-platform.mjs "$@"' > /usr/local/bin/dsh-platform \
    && chmod 755 /usr/local/bin/dsh-platform

ENV DSH_PLATFORM_DATA=/data/platform \
    DSH_HOME=/data/dsh \
    DSH_DEFAULT_WORKSPACE=/workspace \
    DSH_PROXY_POLYFILL=true \
    DSH_TELEMETRY_DISABLED=true \
    DSH_UPDATE_METADATA_URL=https://github.com/yjrszcq/dsh-docker/releases/latest/download/ \
    DSH_UPDATE_CHECK_INTERVAL_SECONDS=21600 \
    DSH_LOG_MAX_BYTES=104857600 \
    DSH_LOG_RETENTION_DAYS=14 \
    DSH_ACTIVATION_TIMEOUT_SECONDS=60 \
    DSH_EXPERIMENTAL_PROBATION_SECONDS=120

RUN mkdir -p /data/platform /data/dsh /workspace \
    && chown -R node:node /data/dsh /workspace

ARG INSTALL_DEVTOOLS=false
ARG UV_VERSION=0.11.32

RUN case "$INSTALL_DEVTOOLS" in \
        true) apt-get update \
            && apt-get install -y --no-install-recommends \
                bash-completion \
                build-essential \
                dnsutils \
                file \
                htop \
                iproute2 \
                iputils-ping \
                less \
                lsof \
                nano \
                netcat-openbsd \
                openssl \
                pkg-config \
                rsync \
                tmux \
                tree \
                unzip \
                vim \
                wget \
                xz-utils \
                zip \
            && curl --fail --location --silent --show-error \
                "https://astral.sh/uv/${UV_VERSION}/install.sh" \
                --output /tmp/uv-installer.sh \
            && UV_UNMANAGED_INSTALL=/usr/local/bin sh /tmp/uv-installer.sh \
            && mkdir -p /etc/uv \
            && printf '%s\n' 'python-downloads = "manual"' > /etc/uv/uv.toml \
            && rm /tmp/uv-installer.sh \
            && rm -rf /var/lib/apt/lists/* \
            ;; \
        false) ;; \
        *) echo "INSTALL_DEVTOOLS must be true or false" >&2; exit 64 ;; \
    esac

WORKDIR /workspace

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD /usr/bin/curl --fail --silent --show-error http://127.0.0.1:3080/_dsh_gateway/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/node", "/opt/dsh-platform/runtime/platform/stage0/index.mjs"]
