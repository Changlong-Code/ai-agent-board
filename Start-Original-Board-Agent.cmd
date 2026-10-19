@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12 or newer is required. Run Setup-Original-Board.cmd first.
  pause
  exit /b 1
)

set "ORIGINAL_ENABLE_AGENT_EXECUTION=1"
node windows\original-start.cjs

if errorlevel 1 (
  echo Startup failed. No unrelated application was stopped.
  pause
  exit /b 1
)
