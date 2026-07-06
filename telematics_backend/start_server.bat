@echo off
title BusTracker Backend
echo ==========================================
echo   Starting BusTracker Backend + ngrok...
echo ==========================================
cd /d "%~dp0backend"
python app.py
pause
