#!/bin/bash
# Start development environment (attached for live logs)
# Development runs on ports 7861 (frontend) and 8001 (backend)
# Uses ./workspace-dev for data storage

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "=== Starting Development Environment ==="
echo ""

# Check if shared Ollama is running
if ! docker ps --format '{{.Names}}' | grep -q "^momiji-ollama-shared$"; then
    echo "Shared Ollama service not found. Starting it now..."
    docker compose -f docker-compose.shared.yml up -d
    echo "Waiting for Ollama to initialize..."
    sleep 5
fi

echo "Starting development services (attached mode - Ctrl+C to stop)..."
echo ""

docker compose -f docker-compose.dev.yml \
    -p momiji-dev \
    --env-file .env.dev \
    up
