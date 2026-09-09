# Docker image publishing and deployment

The production image is built by GitHub Actions and pushed to Docker Hub. The Ubuntu server only pulls and runs the image; it never compiles OpenVSCode.

## 1. Configure Docker Hub

Create a Docker Hub repository named `openvscode-codex`, then create an access token with Read & Write permission.

In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:

- Variable `DOCKERHUB_USERNAME`: Docker Hub username.
- Secret `DOCKERHUB_TOKEN`: Docker Hub access token.
- Optional variable `DOCKERHUB_REPOSITORY`: image repository name; defaults to `openvscode-codex`.
- Optional variable `DOCKER_PLATFORMS`: defaults to `linux/amd64`. Use `linux/arm64` for an ARM64 server.
- Optional variable `OPENVSCODE_BUILD_RUNNER`: GitHub Actions runner label; defaults to `ubuntu-latest`.
- Optional variable `BUILD_NODE_MAX_OLD_SPACE_SIZE`: maximum heap in MB for each build phase; defaults to `4096`.

The Dockerfile uses a low-memory pipeline: it disables symbol mangling and bundle minification, and runs each phase in a separate Node process. This produces a larger image but avoids the previous 14 GB peak. If a private repository's standard runner still runs out of memory, configure a larger runner through `OPENVSCODE_BUILD_RUNNER`.

## 2. Publish the image

Run **Actions → Publish OpenVSCode Docker image → Run workflow**. The default manual tag is `latest`.

Alternatively, publish a version by pushing a Git tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

A version build publishes these tags:

- `openvscode-codex:latest`
- `openvscode-codex:0.1.0`
- `openvscode-codex:0.1`
- `openvscode-codex:sha-<commit>`

Build layers are cached in the `buildcache` tag on Docker Hub.

## 3. Prepare the Ubuntu server

Run from this directory on the server:

```bash
cp .env.example .env
```

Edit `.env` and set the published image:

```dotenv
OPENVSCODE_IMAGE=docker.io/YOUR_DOCKERHUB_USERNAME/openvscode-codex:latest
```

Create persistent storage and a connection token:

```bash
mkdir -p data/home data/workspace secrets
openssl rand -hex 32 > secrets/connection-token
chmod 600 secrets/connection-token
sudo chown -R 1000:1000 data
docker network inspect nginx_network >/dev/null
```

For a private Docker Hub repository, log in once on the server:

```bash
docker login
```

## 4. Pull and start

```bash
docker compose pull
docker compose up -d
docker compose ps
docker compose logs -f openvscode
```

The service is attached to external network `nginx_network`, does not publish port 3000 on the host, and is reachable by the Nginx container at `http://openvscode-codex:3000`.

Open the first browser session with:

```text
https://ide.example.com/?tkn=VALUE_FROM_secrets/connection-token
```

The connection token protects one OpenVSCode instance. It is not the planned admin/user account system.

## Nginx proxy settings

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

Install or sign in to the original Codex extension after opening the server. Extension data, Codex data, credentials, and organizer metadata persist under `data/home`; source workspaces persist under `data/workspace`.

## Updating

After a successful image publishing workflow:

```bash
cd deploy/docker
docker compose pull
docker compose up -d
docker image prune -f
```

The persistent `data` directories are not replaced.
