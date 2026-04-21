# Deploying the engine to `mini` (home server)

Target: run the engine as a long-lived service on `minions@mini` and expose it to the PWA (hosted on Cloudflare Pages) via a Cloudflare Tunnel. Engine state lives at `~/meta-minion/`.

The PWA connects to `https://<your-tunnel>.<your-domain>/api` with a bearer token it stores locally.

## One-time setup on `mini`

### 1. Clone the repo

```sh
ssh minions@mini
mkdir -p ~/meta-minion && cd ~/meta-minion
git clone https://github.com/tprei/minions-ui.git .
```

### 2. Configure environment

```sh
cd ~/meta-minion/docker
cp .env.example .env
```

Edit `.env`:

```sh
MINION_API_TOKEN=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<your key>                     # or mount ~/.claude, see below
GITHUB_TOKEN=<gh PAT with repo scope>
DEFAULT_REPO=https://github.com/<org>/<repo>.git # the repo minion will work on
CORS_ALLOWED_ORIGINS=https://<your-tunnel>.<your-domain>,https://<your-pages>.pages.dev
```

If you authenticated `claude` on `mini` with `claude login`, you can skip `ANTHROPIC_API_KEY` and instead mount `~/.claude` into the container — see `docker/README.md` for the dev compose override.

### 3. Build + start

```sh
cd ~/meta-minion
docker build -f docker/engine.Dockerfile -t minions-engine:latest .
docker compose -f docker/compose.yaml up -d
```

The engine now listens on `http://localhost:8080`. Verify:

```sh
curl -s http://localhost:8080/api/version | jq
curl -s -H "Authorization: Bearer $(grep MINION_API_TOKEN docker/.env | cut -d= -f2)" http://localhost:8080/api/sessions | jq
```

### 4. Cloudflare Tunnel

Install `cloudflared` on `mini` (once):

```sh
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
```

Log in and create a named tunnel (once):

```sh
cloudflared tunnel login
cloudflared tunnel create minions-engine
```

Write `~/.cloudflared/config.yml`:

```yaml
tunnel: minions-engine
credentials-file: /home/minions/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: minions.<your-domain>
    service: http://localhost:8080
  - service: http_status:404
```

Route DNS + install as a systemd service:

```sh
cloudflared tunnel route dns minions-engine minions.<your-domain>
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

The engine is now reachable at `https://minions.<your-domain>/api`.

### 5. Connect the PWA

In the PWA, open the connection picker and add:

- **Base URL:** `https://minions.<your-domain>`
- **Token:** the `MINION_API_TOKEN` from `docker/.env`

## Updates

```sh
ssh minions@mini
cd ~/meta-minion
git pull
docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml up -d
```

## Troubleshooting

- `docker compose logs -f minion-engine` — stream engine logs.
- `bun run server/cli/index.ts doctor` inside the container — runs the diagnostic grid (Node, workspace, port, token, gh, claude).
- Tunnel health: `cloudflared tunnel info minions-engine`.
- Engine won't start? Check `docker/.env` has `MINION_API_TOKEN`, `ANTHROPIC_API_KEY` (or `~/.claude` mount), and `GITHUB_TOKEN`.
