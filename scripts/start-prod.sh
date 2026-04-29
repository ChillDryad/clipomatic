#!/bin/bash
# Start production environment (detached)
# Production runs on ports 7860 (frontend) and 8000 (backend)
# Uses ./workspace for data storage

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "=== Starting Production Environment ==="
echo ""

# Check if shared Ollama is running
if ! docker ps --format '{{.Names}}' | grep -q "^momiji-ollama-shared$"; then
    echo "Shared Ollama service not found. Starting it now..."
    docker compose -f docker-compose.shared.yml up -d
    echo "Waiting for Ollama to initialize..."
    sleep 5
fi

echo "Starting production services..."
docker compose -f docker-compose.prod.yml \
    -p momiji-prod \
    --env-file .env.prod \
    up -d

echo ""
echo "=== Production Started ==="
echo "Frontend: http://localhost:7860"
echo "Backend:  http://localhost:8000"
echo ""
echo "To stop: ./scripts/stop-prod.sh"
echo "To view logs: docker compose -p momiji-prod logs -f"
