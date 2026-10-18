@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Run setup first.
  pause
  exit /b 1
)
node windows\original-selftest.cjs
if errorlevel 1 (
  echo Verification failed. Read the reports folder for details.
  pause
  exit /b 1
)
echo Verification passed. Reports are in the reports folder.
pause
