@echo off
setlocal
if not exist "%~dp0index.html" (
  echo Missing index.html. Extract the entire ZIP before starting.
  pause
  exit /b 1
)
start "" "%~dp0index.html"
if errorlevel 1 (
  echo Open index.html manually in Chrome or Edge.
  pause
  exit /b 1
)
