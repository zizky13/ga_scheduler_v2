#!/usr/bin/env sh
set -eu

docker compose up -d

echo
echo "Application is running at http://localhost:8080"
