@echo off
chcp 65001 >nul
title 魅KTV效率助手 - 开启自动更新
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0updater\install-updater.ps1"
echo.
pause
