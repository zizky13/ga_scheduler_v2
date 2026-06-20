@echo off
setlocal

echo Building Docker images...
docker compose build
if errorlevel 1 exit /b 1

echo Starting PostgreSQL and Redis...
docker compose up -d postgres redis
if errorlevel 1 exit /b 1

echo Running database migrations and demo seed...
docker compose run --rm api sh -c "npx prisma migrate deploy && npm run db:seed && npm run db:seed:demo-user"
if errorlevel 1 exit /b 1

echo Starting application...
docker compose up -d
if errorlevel 1 exit /b 1

echo.
echo Done.
echo Open http://localhost:8080
echo Login: admin@upj.ac.id
echo Password: Admin12345
