#!/usr/bin/env bash

set -euo pipefail

server_root="${OPENVSCODE_SERVER_ROOT:-/home/.openvscode-server}"
token_file="${OPENVSCODE_CONNECTION_TOKEN_FILE:-/run/secrets/openvscode_connection_token}"

server_args=(
	--host 0.0.0.0
	--port 3000
)

if [[ -s "${token_file}" ]]; then
	server_args+=(--connection-token-file "${token_file}")
elif [[ "${OPENVSCODE_WITHOUT_CONNECTION_TOKEN:-false}" == "true" ]]; then
	server_args+=(--without-connection-token)
else
	echo "Connection token is missing or empty: ${token_file}" >&2
	echo "Create the Compose secret or explicitly set OPENVSCODE_WITHOUT_CONNECTION_TOKEN=true." >&2
	exit 1
fi

exec "${server_root}/bin/openvscode-server" "${server_args[@]}" "$@"

