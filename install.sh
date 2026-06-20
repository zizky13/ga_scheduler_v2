#!/usr/bin/env sh
set -eu

echo "Building Docker images..."
docker compose build

echo "Starting PostgreSQL and Redis..."
docker compose up -d postgres redis

echo "Running database migrations and demo seed..."
docker compose run --rm api sh -c "npx prisma migrate deploy && npm run db:seed && npm run db:seed:demo-user"

echo "Starting application..."
docker compose up -d

echo
echo "Done."
echo "Open http://localhost:8080"
echo "Login: admin@upj.ac.id"
echo "Password: Admin12345"
