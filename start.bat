@echo off
setlocal

docker compose up -d
if errorlevel 1 exit /b 1

echo.
echo Application is running at http://localhost:8080
