@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if exist ".runtime\python\Scripts\python.exe" goto install
py -3.10 -m venv ".runtime\python"
if errorlevel 1 goto failed
:install
".runtime\python\Scripts\python.exe" -m pip install -r requirements-usd.txt
if errorlevel 1 goto failed
".runtime\python\Scripts\python.exe" -c "from pxr import Usd; import numpy; print('OpenUSD 已就绪')"
if errorlevel 1 goto failed
echo 安装完成。请重新运行「启动室内空间.bat」并使用它打开的新页面。
pause
exit /b 0
:failed
echo USDZ 支持安装失败。请确认已安装 Python 3.10 和 Python Launcher，并检查上方错误信息。
pause
exit /b 1
