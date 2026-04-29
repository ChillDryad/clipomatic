#!/bin/bash
# Stop production environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "=== Stopping Production Environment ==="

docker compose -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f docker-compose.prod.yml \
    -p momiji-prod \
    down

echo ""
echo "Production stopped."
echo "Note: Shared Ollama service is still running."
echo "To stop Ollama: docker compose -f docker-compose.shared.yml down"
