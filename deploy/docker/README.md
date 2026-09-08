# Docker Compose deployment

This deployment builds the current fork into a production OpenVSCode Server image. It includes the thin core bridge and the `codex-task-organizer` built-in extension.

## Server preparation

Run from the repository root on the Ubuntu server:

```bash
cd deploy/docker
cp .env.example .env
mkdir -p data/home data/workspace secrets
openssl rand -hex 32 > secrets/connection-token
chmod 600 secrets/connection-token
sudo chown -R 1000:1000 data
docker network inspect nginx_network >/dev/null
```

If the host user uses another UID/GID, update `USER_UID`, `USER_GID`, and the ownership of `data` to match.

## Build and start

```bash
export BUILD_SOURCEVERSION="$(git rev-parse HEAD)"
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f openvscode
```

The image is attached to the external `nginx_network` network and does not publish port 3000 on the host. The reverse proxy can reach it at `http://openvscode-codex:3000`.

The first browser URL must include the connection token:

```text
https://ide.example.com/?tkn=VALUE_FROM_secrets/connection-token
```

The connection token is defense-in-depth for one OpenVSCode instance. It is not the planned admin/user account system.

## Nginx proxy settings

Use the following settings in the relevant HTTPS virtual host:

```nginx
location / {
	proxy_pass http://openvscode-codex:3000;
	proxy_http_version 1.1;
	proxy_set_header Host $host;
	proxy_set_header X-Real-IP $remote_addr;
	proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
	proxy_set_header X-Forwarded-Proto $scheme;
	proxy_set_header Upgrade $http_upgrade;
	proxy_set_header Connection "upgrade";
	proxy_read_timeout 3600s;
	proxy_send_timeout 3600s;
}
```

Install or sign in to the original Codex extension after opening the server. Extension data, Codex data, credentials, and the organizer's project metadata persist under `data/home`; source workspaces persist under `data/workspace`.

## Updating

After pulling or rebasing a newer version:

```bash
cd deploy/docker
export BUILD_SOURCEVERSION="$(git rev-parse HEAD)"
docker compose build --pull
docker compose up -d
```

The persistent `data` directories are not replaced when the image is rebuilt.

