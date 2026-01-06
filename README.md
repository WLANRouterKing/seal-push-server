# Seal Push Server

Self-hostable push notification server for [Seal Messenger](https://github.com/WLANRouterKing/seal).

Connects to Nostr relays and sends push notifications via [ntfy.sh](https://ntfy.sh) when new encrypted messages arrive.

## Why?

Nostr is decentralized - there's no central server to send push notifications. This server bridges the gap:

1. Subscribes to Nostr relays for your npub
2. Watches for incoming Gift-Wrap events (encrypted messages)
3. Sends push notifications via ntfy.sh
4. Works on all platforms (Android, iOS, PWA, Desktop)

## Privacy

- Server only knows your **public** npub (not private key)
- Cannot decrypt messages (Gift-Wraps are E2E encrypted)
- No logs by default
- Self-host for maximum privacy

## Quick Start

### Docker (Recommended)

```bash
docker run -d \
  -p 3000:3000 \
  -e DEFAULT_RELAYS=wss://relay.damus.io,wss://nos.lol \
  ghcr.io/wlanrouterking/seal-push-server:latest
```

### Docker Compose

```bash
git clone https://github.com/WLANRouterKing/seal-push-server
cd seal-push-server
docker compose up -d
```

### From Source (Bun)

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone and run
git clone https://github.com/WLANRouterKing/seal-push-server
cd seal-push-server
bun install
bun run dev
```

## API

### Subscribe to Push Notifications

```bash
POST /subscribe
Content-Type: application/json

{
  "npub": "npub1abc...",
  "ntfy_topic": "seal-abc123",
  "relays": ["wss://relay.damus.io"]  # optional
}
```

### Unsubscribe

```bash
POST /unsubscribe
Content-Type: application/json

{
  "npub": "npub1abc..."
}
```

### Health Check

```bash
GET /health
```

### Stats

```bash
GET /stats
X-API-Key: your-api-key  # if API_KEY is set
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Server host |
| `DEFAULT_RELAYS` | `wss://relay.damus.io` | Comma-separated relay URLs |
| `NTFY_SERVER` | `https://ntfy.sh` | ntfy.sh server URL |
| `API_KEY` | - | Optional API key for /stats |

## Client Integration

In Seal Messenger, configure push notifications:

```
Settings → Notifications → Push Server → https://your-server.com
```

The app will:
1. Generate a unique ntfy topic
2. Subscribe via your push server
3. Subscribe to the ntfy topic on the device

## Self-Hosting ntfy.sh

For maximum privacy, self-host ntfy.sh too:

```bash
docker run -d \
  -p 8080:80 \
  binwiederhier/ntfy
```

Then set `NTFY_SERVER=http://your-ntfy-server:8080`

## License

MIT