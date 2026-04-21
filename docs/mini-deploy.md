# Deploying the engine to `mini` (home server)

Target: run the engine as a long-lived service on `minions@mini` and expose it to the PWA via a Cloudflare Tunnel. Engine state lives at `~/meta-minion/`. The PWA connects to `https://<your-tunnel>.<your-domain>/api` with a bearer token.

The compose file ships a `cloudflared` service under the `tunnel` profile — you don't install `cloudflared` on the host.

## One-time setup on `mini`

### 1. Clone the repo

```sh
ssh minions@mini
git clone git@github.com:tprei/minions-ui.git ~/meta-minion
cd ~/meta-minion/docker
cp .env.example .env
```

### 2. Fill `.env`

```sh
MINION_API_TOKEN=$(openssl rand -hex 32)          # any random string
# ANTHROPIC_API_KEY stays blank if you mount ~/.claude (see compose.mini.yaml below)
GITHUB_TOKEN=<gh PAT, repo scope>
DEFAULT_REPO=https://github.com/<org>/<repo>.git  # what the minion works on
CORS_ALLOWED_ORIGINS=https://<your-tunnel>.<your-domain>,https://<your-pages>.pages.dev
CLOUDFLARE_TUNNEL_TOKEN=                          # filled in step 4
```

### 3. Mount `~/.claude` for claude-CLI auth (optional but recommended)

If you ran `claude login` on mini, create `docker/compose.mini.yaml`:

```yaml
services:
  engine:
    volumes:
      - ${HOME}/.claude:/workspace/home/.claude
```

This lets the in-container claude CLI reuse your host login instead of needing an `ANTHROPIC_API_KEY`.

### 4. Create a Cloudflare Tunnel

- Open https://one.dash.cloudflare.com → Networks → Tunnels → **Create a tunnel** → *Cloudflared* → name it (e.g. `minions-engine`).
- Cloudflare shows a token on the next screen. Copy it, paste into `docker/.env` as `CLOUDFLARE_TUNNEL_TOKEN=<token>`.
- In the tunnel's **Public Hostnames** tab, add: `Type=HTTP`, `URL=engine:8080`, `Hostname=minions.<your-domain>` (or any subdomain). Save.

### 5. Build + start

```sh
cd ~/meta-minion
docker build -f docker/engine.Dockerfile -t minions-engine:local .
docker compose -f docker/compose.yaml -f docker/compose.mini.yaml --profile tunnel up -d
```

Verify locally:

```sh
curl -s http://localhost:8080/api/version | jq
TOKEN=$(grep ^MINION_API_TOKEN docker/.env | cut -d= -f2)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/sessions | jq
```

Verify through the tunnel:

```sh
curl -s https://minions.<your-domain>/api/version | jq
```

### 6. Connect the PWA

In the PWA's connection picker add:

- **Base URL:** `https://minions.<your-domain>`
- **Token:** the `MINION_API_TOKEN` from `docker/.env`

## Updates

```sh
ssh minions@mini
cd ~/meta-minion
git pull
docker compose -f docker/compose.yaml -f docker/compose.mini.yaml build engine
docker compose -f docker/compose.yaml -f docker/compose.mini.yaml --profile tunnel up -d
```

## Troubleshooting

- `docker compose -f docker/compose.yaml -f docker/compose.mini.yaml logs -f engine` — engine logs.
- `docker compose -f docker/compose.yaml -f docker/compose.mini.yaml logs -f cloudflared` — tunnel logs.
- `docker exec docker-engine-1 bun run server/cli/index.ts doctor` — in-container diagnostic grid.
- Engine won't start? Check `docker/.env` has `MINION_API_TOKEN` (required), `GITHUB_TOKEN`, and either `ANTHROPIC_API_KEY` or the `~/.claude` mount via `compose.mini.yaml`.
- Tunnel returning 502? The Public Hostname service URL must be `http://engine:8080` (the compose service name), not `localhost:8080`.
