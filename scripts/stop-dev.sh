#!/bin/bash
# Stop development environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "=== Stopping Development Environment ==="

docker compose -f docker-compose.dev.yml \
    -p momiji-dev \
    down

echo ""
echo "Development stopped."
echo "Note: Shared Ollama service is still running."
echo "To stop Ollama: docker compose -f docker-compose.shared.yml down"
