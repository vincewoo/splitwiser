# Splitwiser Deployment Guide

This guide covers deploying Splitwiser to [Fly.io](https://fly.io).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Fly.io Edge Network                   │
│                  (HTTPS termination)                     │
│                    port 443 → 8080                       │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│              Unified Container (Supervisor)              │
│  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │  Nginx :8080   │  │  FastAPI :8000 (internal)      │ │
│  │  (React SPA)   │──▶│  SQLite: /data/db.sqlite3     │ │
│  └────────────────┘  └────────────────────────────────┘ │
│                          │                               │
│                    ┌─────▼────┐                          │
│                    │ Fly Vol  │                          │
│                    │  /data   │                          │
│                    └──────────┘                          │
└─────────────────────────────────────────────────────────┘
```

The application runs as a single container using `supervisord` to manage both the Nginx frontend (serving the React app) and the FastAPI backend.

## Prerequisites

- [Fly.io account](https://fly.io)
- [flyctl CLI](https://fly.io/docs/hands-on/install-flyctl/) installed

## Initial Setup

### 1. Login to Fly.io

```bash
fly auth login
```

### 2. Create the app (first time only)

```bash
cd /path/to/splitwiser
fly apps create splitwiser
```

### 3. Create persistent volume

Splitwiser uses SQLite, so a persistent volume is required to save data across deployments.

```bash
fly volumes create splitwiser_data --region sjc --size 1
```

> **Note:** Replace `sjc` with your preferred region code (use `fly platform regions` to list).

### 4. Set secrets

```bash
# Required: JWT secret key
fly secrets set SECRET_KEY="your-secure-secret-key-here"

# Optional: Google Cloud credentials for OCR (base64 encoded)
cat path/to/google-credentials.json | base64 | fly secrets set GOOGLE_CREDENTIALS_BASE64=-
```

### 5. Deploy

```bash
fly deploy
```

## Continuous Deployment (GitHub Actions)

The repository is configured to automatically deploy to Fly.io on every push to the `main` branch.

### Setup

1.  **Generate a Fly.io Deploy Token:**

    ```bash
    fly tokens create deploy -x 999999h
    ```

2.  **Add to GitHub Secrets:**

    Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

    | Secret Name | Value |
    |-------------|-------|
    | `FLY_API_TOKEN` | The token generated in step 1 |

3.  **Deploy:**

    Pushing to `main` will now trigger the deployment via `.github/workflows/deploy.yml`.

## Useful Commands

```bash
# View app status
fly status

# View logs
fly logs

# SSH into container
fly ssh console

# Scale to 0 (pause - saves money)
fly scale count 0

# Scale back up
fly scale count 1

# Check volume status
fly volumes list
```

## Troubleshooting

### Check container processes
```bash
fly ssh console
# Inside the container
ps aux
```

### View supervisor logs
```bash
fly ssh console
# Inside the container
cat /var/log/supervisor/supervisord.log
```

### Database access
```bash
fly ssh console
# Inside the container
sqlite3 /data/db.sqlite3
```

## Costs

- **Free tier**: 3 shared-cpu-1x VMs with 256MB RAM (sufficient for this app)
- **Volume**: ~$0.15/GB/month
- **Total**: Usually free or cents per month for typical usage.
