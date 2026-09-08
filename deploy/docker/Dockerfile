# syntax=docker/dockerfile:1.7

FROM node:22.22.0-bookworm AS builder

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		build-essential \
		ca-certificates \
		curl \
		git \
		libkrb5-dev \
		libxkbfile-dev \
		pkg-config \
		python3 \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . .

ARG TARGETARCH
ARG BUILD_SOURCEVERSION=0000000000000000000000000000000000000000

ENV BUILD_SOURCEVERSION=${BUILD_SOURCEVERSION} \
	ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
	PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN npm ci

RUN case "${TARGETARCH}" in \
		amd64) vscode_arch=x64 ;; \
		arm64) vscode_arch=arm64 ;; \
		*) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 1 ;; \
	esac \
	&& npm run gulp -- "vscode-reh-web-linux-${vscode_arch}-min" \
	&& mv "/vscode-reh-web-linux-${vscode_arch}" /opt/openvscode-server

FROM buildpack-deps:bookworm-curl AS runtime

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		libatomic1 \
		less \
		procps \
		sudo \
	&& rm -rf /var/lib/apt/lists/*

ARG USERNAME=openvscode-server
ARG USER_UID=1000
ARG USER_GID=1000

ENV OPENVSCODE_SERVER_ROOT=/home/.openvscode-server

RUN groupadd --gid "${USER_GID}" "${USERNAME}" \
	&& useradd --uid "${USER_UID}" --gid "${USER_GID}" --create-home --shell /bin/bash "${USERNAME}" \
	&& echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
	&& chmod 0440 "/etc/sudoers.d/${USERNAME}" \
	&& mkdir -p /home/workspace \
	&& chown "${USER_UID}:${USER_GID}" /home/workspace

COPY --from=builder --chown=${USER_UID}:${USER_GID} /opt/openvscode-server ${OPENVSCODE_SERVER_ROOT}
COPY --chmod=0755 deploy/docker/entrypoint.sh /usr/local/bin/openvscode-entrypoint

RUN cp "${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/openvscode-server" "${OPENVSCODE_SERVER_ROOT}/bin/remote-cli/code"

USER ${USERNAME}
WORKDIR /home/workspace

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD curl --silent --show-error --output /dev/null --max-time 5 http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/usr/local/bin/openvscode-entrypoint"]
