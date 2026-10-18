@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo This connected edition requires Node.js 22.12 or newer that runs on your PC.
  echo For the offline board, open portable\index.html in Chrome.
  pause
  exit /b 1
)
node "%~dp0local\start.cjs"
if errorlevel 1 pause
