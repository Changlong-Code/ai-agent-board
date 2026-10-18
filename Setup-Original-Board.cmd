@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
where node >nul 2>nul
if errorlevel 1 goto :failed
node windows\original-setup.cjs
if errorlevel 1 goto :failed
pause
exit /b 0
:failed
echo Setup failed. Node.js 22.12+ and internet access for npm are required.
echo Existing application data has not been migrated by this setup.
pause
exit /b 1
