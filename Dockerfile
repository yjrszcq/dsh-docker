ARG DSH_VERSION=latest
ARG ENVIRONMENT_VERSION=development
ARG TARGET_SEQUENCE=0
ARG SIGNED_IMAGE_INPUT=false

FROM node:24-bookworm-slim AS installer
ARG DSH_VERSION
ARG SIGNED_IMAGE_INPUT
COPY container/platform/image-input /opt/dsh-platform-image-input
COPY release/supported-target.json /opt/dsh-supported-target.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        g++ \
        make \
        python3 \
    && case "$SIGNED_IMAGE_INPUT" in \
       true) \
         test -f /opt/dsh-platform-image-input/dsh.tgz \
         && npm install --global /opt/dsh-platform-image-input/dsh.tgz \
         ;; \
       false) \
         requested_version="$DSH_VERSION"; \
         if [ "$requested_version" = latest ]; then \
           requested_version="$(node -p "JSON.parse(require('fs').readFileSync('/opt/dsh-supported-target.json', 'utf8')).latestSupportedDsh")"; \
         fi; \
         npm install --global "@deepseek-ai/dsh@${requested_version}" \
         ;; \
       *) echo "SIGNED_IMAGE_INPUT must be true or false" >&2; exit 64 ;; \
       esac \
    && rm -rf /var/lib/apt/lists/* /root/.npm

FROM node:24-bookworm-slim AS platform-seed
ARG PLATFORM_REVISION=development
ARG SIGNED_IMAGE_INPUT
COPY --from=installer /usr/local/lib/node_modules/@deepseek-ai/dsh /opt/installed-dsh
COPY container/control-plane/services/management/package.json container/control-plane/services/management/package-lock.json \
    /opt/dsh-platform-source/control-plane/services/management/
COPY container/environment/resources/plugins/platform-management/package/package.json \
    container/environment/resources/plugins/platform-management/package/package-lock.json \
    /opt/dsh-platform-source/environment/resources/plugins/platform-management/package/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
      --prefix /opt/dsh-platform-source/control-plane/services/management \
    && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps \
      --prefix /opt/dsh-platform-source/environment/resources/plugins/platform-management/package
COPY container /opt/dsh-platform-source
RUN case "$SIGNED_IMAGE_INPUT" in \
      true) image_input=/opt/dsh-platform-source/platform/image-input ;; \
      false) image_input=- ;; \
      *) echo "SIGNED_IMAGE_INPUT must be true or false" >&2; exit 64 ;; \
    esac \
    && node /opt/dsh-platform-source/platform/tools/build-seed.mjs \
      /opt/installed-dsh /opt/dsh-platform-seed "$image_input" "$PLATFORM_REVISION"

FROM node:24-bookworm-slim AS runtime
ARG PNPM_VERSION=11.7.0
ARG DSH_VERSION
ARG ENVIRONMENT_VERSION
ARG TARGET_SEQUENCE

LABEL org.opencontainers.image.title="DeepSeek Harness" \
      org.opencontainers.image.description="Unofficial container image for DeepSeek Harness" \
      org.opencontainers.image.source="https://github.com/yjrszcq/dsh-docker" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$DSH_VERSION" \
      io.dsh-docker.environment.version="$ENVIRONMENT_VERSION" \
      io.dsh-docker.target-sequence="$TARGET_SEQUENCE"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        g++ \
        git \
        jq \
        make \
        openssh-client \
        p7zip-full \
        procps \
        python3 \
        python3-venv \
        ripgrep \
        sudo \
        tini \
        unzip \
        util-linux \
        zip \
    && groupadd --system dsh-sudo-true \
    && groupadd --system dsh-sudo-false \
    && groupadd --system --gid 991 dsh-proxy \
    && useradd --system --uid 991 --gid 991 --home-dir /nonexistent --shell /usr/sbin/nologin dsh-proxy \
    && groupadd --system --gid 992 dsh-access \
    && useradd --system --uid 992 --gid 992 --home-dir /nonexistent --shell /usr/sbin/nologin dsh-access \
    && npm install --global "pnpm@${PNPM_VERSION}" \
    && rm -rf /var/lib/apt/lists/* /root/.npm

COPY docker-sudoers /etc/sudoers.d/dsh-sudo
RUN chmod 440 /etc/sudoers.d/dsh-sudo \
    && visudo -cf /etc/sudoers.d/dsh-sudo

COPY --from=platform-seed /opt/dsh-platform-seed /opt/dsh-platform/seed
COPY container/platform /opt/dsh-platform/runtime/platform
COPY container/control-plane /opt/dsh-platform/runtime/control-plane
COPY --from=platform-seed /opt/dsh-platform-source/control-plane/services/management/node_modules /opt/dsh-platform/runtime/control-plane/services/management/node_modules
COPY container/platform/tools/dsh-shim.sh /usr/local/bin/dsh
COPY container/platform/tools/dsh-platform-shim.sh /usr/local/bin/dsh-platform
RUN chmod 755 /usr/local/bin/dsh /usr/local/bin/dsh-platform

ENV DSH_PLATFORM_DATA=/data/platform \
    DSH_PLATFORM_MANAGED=1 \
    DSH_PLATFORM_RUN=/run/dsh-platform \
    DSH_HOME=/data/dsh \
    DSH_DEFAULT_WORKSPACE=/workspace \
    DSH_PROXY_POLYFILL=true \
    DSH_TELEMETRY_DISABLED=true \
    DSH_UPDATE_METADATA_URL=https://raw.githubusercontent.com/yjrszcq/dsh-docker/release-channel/ \
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

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD /usr/bin/curl --fail --silent --show-error --noproxy '*' http://127.0.0.1:3080/_dsh_gateway/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/node", "/opt/dsh-platform/runtime/platform/stage0/index.mjs"]
