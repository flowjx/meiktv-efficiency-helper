@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 魅KTV效率助手 上报服务
python install_server.py
pause
