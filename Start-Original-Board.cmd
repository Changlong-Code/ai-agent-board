@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. See the Windows setup guide.
  pause
  exit /b 1
)
node windows\original-start.cjs
if errorlevel 1 (
  echo Startup failed. No unrelated application was stopped.
  pause
  exit /b 1
)
