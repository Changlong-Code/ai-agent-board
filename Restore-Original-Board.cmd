@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
echo Restore first previews and validates. Applying requires the exact snapshot ID.
node windows\original-backup.cjs interactive-restore
pause
