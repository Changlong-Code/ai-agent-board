@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
node windows\original-backup.cjs backup
if errorlevel 1 echo Backup failed. Stop the original board first; existing files were not replaced.
pause
