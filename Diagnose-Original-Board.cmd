@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_OPTIONS="
where node >nul 2>nul
if errorlevel 1 (
  goto missing_node
)
node windows\original-diagnose.cjs
set "DIAG_EXIT=%ERRORLEVEL%"
if not "%DIAG_EXIT%"=="0" (
  echo 部分检查未通过，请打开上方显示的中文报告，按提示处理后重试。
) else (
  echo 环境诊断通过。可以运行 Start-Original-Board.cmd。
)
echo 本次没有运行 Agent 或项目代码。
pause
exit /b %DIAG_EXIT%

:missing_node
set "REPORT_DIR=%~dp0reports"
if defined ORIGINAL_REPORT_DIR set "REPORT_DIR=%ORIGINAL_REPORT_DIR%"
if not exist "%REPORT_DIR%" mkdir "%REPORT_DIR%" >nul 2>nul
set "REPORT_FILE=%REPORT_DIR%\original-diagnose-node-missing-%RANDOM%-%RANDOM%.txt"
if exist "%REPORT_FILE%" goto missing_node
> "%REPORT_FILE%" echo AI Agent Board 原版基础模式 — Node.js 缺失诊断
>> "%REPORT_FILE%" echo 未通过：系统没有找到 node 命令，无法进行 SQLite、构建和端口检查。
>> "%REPORT_FILE%" echo 下一步：安装兼容本机系统的 Node.js 22.12 或更新版本，再重新运行本诊断。
>> "%REPORT_FILE%" echo 本次没有运行 Agent、登录账号或修改已有项目、配置及数据库。
if exist "%REPORT_FILE%" (
  echo 未找到 Node.js。中文报告已保存：
  echo "%REPORT_FILE%"
) else (
  echo 未找到 Node.js，且无法保存诊断报告。请检查报告目录是否可写。
)
pause
exit /b 1
