@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "ACCESS_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "ACCESS_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%ACCESS_NODE%" server.cjs %*
if errorlevel 1 pause
endlocal
