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

FROM node:24-bookworm-slim AS runtime

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
                python3-venv \
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

USER node
WORKDIR /workspace

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD /usr/bin/curl --fail --silent --show-error http://127.0.0.1:3080/_dsh_gateway/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/usr/local/bin/node", "/opt/dsh-gateway/index.mjs"]
