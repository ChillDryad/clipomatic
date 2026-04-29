# Production + Development Deployment Guide

This document describes how to run both production and development environments simultaneously on the same machine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Host Machine                            │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Shared Ollama (isolated network)           │   │
│  │  Container: momiji-ollama-shared                     │   │
│  │  Volume: ollama_shared_data                          │   │
│  │  Network: momiji-llm-network (internal only)         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          ▲                                  │
│         ┌────────────────┴────────────────┐                │
│         │                                 │                │
│  ┌──────────────┐                 ┌──────────────┐        │
│  │  Production  │                 │ Development  │        │
│  │              │                 │              │        │
│  │ Port 7860    │                 │ Port 7861    │        │
│  │ ./workspace  │                 │ ./workspace-dev│      │
│  └──────────────┘                 └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start Shared Ollama (Required First Step)

```bash
# Start the shared Ollama service (run once)
docker compose -f docker-compose.shared.yml up -d

# Pull your model
docker exec -it momiji-ollama-shared ollama pull llama3.1:8b
```

### 2. Prepare Environment Files

```bash
# Production
cp .env.prod.example .env.prod
# Edit .env.prod with your production secrets

# Development
cp .env.dev.example .env.dev
# Edit .env.dev as needed
```

### 3. Start Environments

```bash
# Start production (detached)
./scripts/start-prod.sh

# Start development (attached, shows logs)
./scripts/start-dev.sh
```

## Manual Commands

### Production

```bash
# Start (detached)
docker compose -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f docker-compose.prod.yml \
    -p momiji-prod \
    --env-file .env.prod \
    up -d

# View logs
docker compose -p momiji-prod logs -f

# Stop
./scripts/stop-prod.sh

# Restart
docker compose -p momiji-prod restart
```

### Development

```bash
# Start (attached)
docker compose -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f docker-compose.dev.yml \
    -p momiji-dev \
    --env-file .env.dev \
    up

# Stop (in another terminal)
./scripts/stop-dev.sh
```

### With Nvidia GPU Support

```bash
# Production with GPU
docker compose -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f docker-compose.prod.yml \
    -f docker-compose.nvidia.yml \
    -p momiji-prod \
    --env-file .env.prod \
    up -d

# Development with GPU
docker compose -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f docker-compose.dev.yml \
    -f docker-compose.nvidia.yml \
    -p momiji-dev \
    --env-file .env.dev \
    up
```

## Access Points

| Environment | Frontend | Backend |
|-------------|----------|---------|
| Production  | http://localhost:7860 | http://localhost:8000 |
| Development | http://localhost:7861 | http://localhost:8001 |

## Data Isolation

| Resource | Production | Development |
|----------|------------|-------------|
| Workspace | `./workspace/` | `./workspace-dev/` |
| Database | `./workspace/momiji.db` | `./workspace-dev/momiji.db` |
| Ollama Models | Shared (`ollama_shared_data`) | Shared (`ollama_shared_data`) |

## Troubleshooting

### Ollama Not Starting

```bash
# Check status
docker ps | grep ollama-shared

# View logs
docker compose -f docker-compose.shared.yml logs

# Restart
docker compose -f docker-compose.shared.yml restart
```

### Port Already in Use

If port 7860 or 8000 is already in use, another instance may be running:

```bash
# Check what's using the port
lsof -i :7860
lsof -i :8000

# Stop any stray containers
docker compose -p momiji-prod down
docker compose -p momiji-dev down
```

### Network Issues

If environments can't connect to Ollama:

```bash
# Verify network exists
docker network ls | grep momiji-llm-network

# Recreate network
docker compose -f docker-compose.shared.yml down
docker compose -f docker-compose.shared.yml up -d
```

## Cleanup

```bash
# Stop all environments
./scripts/stop-prod.sh
./scripts/stop-dev.sh

# Stop shared Ollama
docker compose -f docker-compose.shared.yml down

# Remove all containers and networks
docker compose -p momiji-prod down -v
docker compose -p momiji-dev down -v
docker compose -f docker-compose.shared.yml down -v
```
