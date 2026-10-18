@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install a compatible Node.js 22.12+ runtime first.
  pause
  exit /b 1
)
node windows\original-diagnose.cjs
if errorlevel 1 (
  echo Some checks failed. Copy the report above for troubleshooting.
  pause
  exit /b 1
)
echo Diagnostics complete. No Agent or project code was run.
pause
