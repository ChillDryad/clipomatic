#!/bin/sh
# Export BACKEND_HOST so envsubst can substitute it in the nginx template
export BACKEND_HOST="${BACKEND_HOST:-momiji-clipper}"
echo "Frontend configured with BACKEND_HOST=$BACKEND_HOST"
