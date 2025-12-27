# Splitwiser Deployment Guide

This guide covers deploying Splitwiser to a Synology NAS with Docker and exposing it publicly via Tailscale Funnel.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tailscale Funnel                      │
│                  (HTTPS termination)                     │
│                    port 443 → 80                         │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                   Frontend (Nginx)                       │
│                      port 80                             │
│  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │  Static files  │  │  /api/* → backend:8000         │ │
│  │  (React SPA)   │  │  (proxy, strips /api prefix)   │ │
│  └────────────────┘  └────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                   Backend (FastAPI)                      │
│                      port 8000                           │
│              SQLite: /data/db.sqlite3                    │
└─────────────────────────────────────────────────────────┘
```

All three containers share the same network namespace via `network_mode: service:tailscale`.

## Prerequisites

### On Synology NAS
- Docker package installed
- SSH access enabled
- A deployment directory (e.g., `/volume1/docker/splitwiser`)

### Tailscale Setup
1. Create a Tailscale account at https://tailscale.com
2. Enable Tailscale Funnel in your tailnet's ACL policy:
   ```json
   {
     "nodeAttrs": [
       {
         "target": ["tag:container"],
         "attr": ["funnel"]
       }
     ]
   }
   ```
3. Generate an auth key:
   - Go to https://login.tailscale.com/admin/settings/keys
   - Create an auth key with "Reusable" enabled
   - Tag it appropriately (e.g., `tag:container`)

4. Create OAuth credentials for CI:
   - Go to https://login.tailscale.com/admin/settings/oauth
   - Create an OAuth client with appropriate scopes
   - Note the client ID and secret

## GitHub Secrets

Configure these secrets in your GitHub repository (Settings → Secrets and variables → Actions):

| Secret | Description | Example |
|--------|-------------|---------|
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID for CI | `k1234...` |
| `TS_OAUTH_SECRET` | Tailscale OAuth secret | `tskey-client-...` |
| `TS_AUTHKEY` | Tailscale device auth key | `tskey-auth-...` |
| `SYNOLOGY_TAILSCALE_IP` | Synology's Tailscale IP | `100.64.0.1` |
| `SYNOLOGY_USER` | SSH username | `admin` |
| `SYNOLOGY_SSH_KEY` | SSH private key (full content) | `-----BEGIN OPENSSH...` |
| `SYNOLOGY_SSH_PORT` | SSH port | `22` |
| `SYNOLOGY_DEPLOY_PATH` | Deployment directory | `/volume1/docker/splitwiser` |
| `GOOGLE_CREDENTIALS_JSON` | Google Cloud service account JSON (optional, for OCR) | `{"type":"service_account",...}` |

## Google Cloud Vision (OCR) Setup

The receipt scanning feature uses Google Cloud Vision API. This is **optional** - the app works without it, but OCR will be disabled.

### Setup Steps

1. **Create a Google Cloud project** at https://console.cloud.google.com

2. **Enable the Cloud Vision API:**
   - Go to APIs & Services → Library
   - Search for "Cloud Vision API"
   - Click Enable

3. **Create a service account:**
   - Go to IAM & Admin → Service Accounts
   - Click "Create Service Account"
   - Name it (e.g., `splitwiser-ocr`)
   - Grant the role "Cloud Vision API User"
   - Click "Create Key" → JSON
   - Download the JSON file

4. **Add to GitHub Secrets:**
   - Open the downloaded JSON file
   - Copy the entire contents
   - Add as `GOOGLE_CREDENTIALS_JSON` secret in GitHub

### Free Tier
- 1,000 images/month free
- Requires billing account (won't charge within free tier)

### Manual Deployment
For manual deployment, place the credentials file at:
```
secrets/google-credentials.json
```

## Deployment Methods

### Automatic (GitHub Actions)

Push to the `main` branch triggers automatic deployment:

1. Frontend is built with `npm run build`
2. Files are synced to Synology via rsync
3. Docker images are rebuilt
4. Containers are started
5. Tailscale Funnel is enabled

You can also trigger manually via GitHub Actions → Deploy to Synology → Run workflow.

### Manual Deployment

1. **Build the frontend locally:**
   ```bash
   cd frontend
   npm install
   npm run build
   ```

2. **Copy files to Synology:**
   ```bash
   rsync -avz --delete \
     --exclude 'node_modules' \
     --exclude '.git' \
     --exclude 'backend/venv' \
     --exclude 'backend/__pycache__' \
     --exclude 'backend/db.sqlite3' \
     --exclude '.env' \
     ./ user@synology:/volume1/docker/splitwiser/
   ```

3. **SSH to Synology and deploy:**
   ```bash
   ssh user@synology
   cd /volume1/docker/splitwiser

   # Create .env with Tailscale auth key
   echo "TS_AUTHKEY=tskey-auth-..." > .env

   # Build and start containers
   sudo docker-compose build --no-cache
   sudo docker-compose up -d

   # Wait for Tailscale to authenticate
   sleep 10

   # Enable Tailscale Funnel
   sudo docker-compose exec tailscale tailscale funnel --bg --https=443 localhost:80

   # Verify funnel status
   sudo docker-compose exec tailscale tailscale funnel status

   # Clean up .env
   rm .env
   ```

## Container Details

### Backend (`splitwiser-backend`)
- **Image:** Python 3.11 slim
- **Port:** 8000 (internal)
- **Volume:** `backend-data:/data` (SQLite database)
- **Environment:**
  - `DATABASE_PATH=/data/db.sqlite3`
- **Healthcheck:** `curl -f http://localhost:8000/docs`

### Frontend (`splitwiser-frontend`)
- **Image:** Nginx Alpine
- **Port:** 80 (internal, exposed via Tailscale)
- **Config:** Proxies `/api/*` to backend, serves React SPA

### Tailscale (`splitwiser-tailscale`)
- **Image:** `tailscale/tailscale:latest`
- **Hostname:** `splitwiser`
- **Volume:** `tailscale-state:/var/lib/tailscale`
- **Capabilities:** `NET_ADMIN`, `NET_RAW`

## Public URL

After deployment, the app is available at:
```
https://splitwiser.<your-tailnet>.ts.net
```

Find your tailnet name in the Tailscale admin console.

## Troubleshooting

### Check container status
```bash
sudo docker-compose ps
sudo docker-compose logs --tail=50
```

### Check individual container logs
```bash
sudo docker-compose logs backend
sudo docker-compose logs frontend
sudo docker-compose logs tailscale
```

### Verify Tailscale connection
```bash
sudo docker-compose exec tailscale tailscale status
```

### Verify Funnel is working
```bash
sudo docker-compose exec tailscale tailscale funnel status
```

### Rebuild a single container
```bash
sudo docker-compose build --no-cache backend
sudo docker-compose up -d backend
```

### Reset Tailscale state
```bash
sudo docker-compose down
sudo docker volume rm splitwiser_tailscale-state
sudo docker-compose up -d
```

### Database access
```bash
sudo docker-compose exec backend sqlite3 /data/db.sqlite3
```

## Data Persistence

- **Database:** Stored in `backend-data` Docker volume at `/data/db.sqlite3`
- **Tailscale state:** Stored in `tailscale-state` Docker volume

These volumes survive container rebuilds. To backup the database:
```bash
sudo docker cp splitwiser-backend:/data/db.sqlite3 ./backup.sqlite3
```

## Environment Variables

### Backend
| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_PATH` | Path to SQLite database | `./db.sqlite3` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to Google Cloud credentials JSON | (none) |

### Tailscale Container
| Variable | Description |
|----------|-------------|
| `TS_AUTHKEY` | Tailscale authentication key |
| `TS_STATE_DIR` | State directory (`/var/lib/tailscale`) |
| `TS_USERSPACE` | Use kernel mode (`false`) |
| `TS_HOSTNAME` | Device hostname (`splitwiser`) |
| `TS_ACCEPT_DNS` | Accept Tailscale DNS (`false`) |

## Security Notes

- The `.env` file containing `TS_AUTHKEY` is deleted after deployment
- SSH keys are temporary during GitHub Actions workflow
- Tailscale provides encrypted tunnel for all traffic
- HTTPS is terminated at Tailscale Funnel (automatic certificates)
- Database is only accessible within the container network
