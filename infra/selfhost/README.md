# Self-hosted SpacetimeDB

Run the `idle-survivor` module on your own VPS instead of Maincloud.

## Files

- `spacetimedb.service` — systemd unit. Runs `spacetime start` bound to `127.0.0.1:3000` as the `spacetime` user, restarts on failure.
- `Caddyfile` — Caddy reverse proxy. Terminates TLS via Let's Encrypt and forwards WebSockets to the local SpacetimeDB.

## One-time host setup

1. Create the service user and install the CLI:
   ```bash
   sudo useradd -m -s /bin/bash spacetime
   sudo -iu spacetime bash -c 'curl -sSf https://install.spacetimedb.com | sh'
   ```
2. Drop the unit in place and start it:
   ```bash
   sudo cp spacetimedb.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now spacetimedb
   ```
3. Point `stdb.<your-domain>` at the host (A/AAAA record), update `Caddyfile`, then:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

## Publishing from your dev machine

```bash
spacetime server add selfhost https://stdb.<your-domain> --no-fingerprint
npm run spacetime:publish:selfhost
```

## Pointing the client

```bash
EXPO_PUBLIC_SPACETIMEDB_HOST=wss://stdb.<your-domain> \
EXPO_PUBLIC_SPACETIMEDB_DB_NAME=idle-survivor \
npm run build:web
```

## Operational notes

- Data lives in `/home/spacetime/.local/share/spacetime` — back it up before risky publishes.
- Tail logs with `spacetime logs --server selfhost idle-survivor -f`.
- Non-additive schema changes need `spacetime publish ... --clear-database -y`, which wipes all rows.
