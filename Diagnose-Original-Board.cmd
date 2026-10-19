@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="

where node >nul 2>nul
if errorlevel 1 goto missing_node

node windows\original-diagnose.cjs
set "DIAG_EXIT=%ERRORLEVEL%"

if not "%DIAG_EXIT%"=="0" (
  echo Diagnosis found one or more issues. Open the report shown above for details.
) else (
  echo Diagnosis passed. You can run Start-Original-Board.cmd.
)

echo No Agent or project code was executed.
pause
exit /b %DIAG_EXIT%

:missing_node
echo Node.js was not found in PATH.
echo Run Setup-Original-Board.cmd first, then retry this diagnosis.
echo No Agent or project code was executed.
pause
exit /b 1
