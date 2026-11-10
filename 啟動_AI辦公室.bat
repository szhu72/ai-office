@echo off
chcp 65001 >nul
title 無所事事辦公室 — AI Office 一鍵啟動器
cd /d "d:\AI\ai-office-prototype"

echo [1/2] 啟動 Flask AI 後端服務 (Port 5000)...
start "AI-Office-Backend" cmd /k ""d:\AI\ai-office-prototype\.venv\Scripts\python.exe" app.py"

echo [2/2] 啟動 Vite 前端介面 (Port 5173)...
start "AI-Office-Frontend" cmd /k "npm.cmd run dev -- --port 5173 --strictPort"

timeout /t 3 >nul
start http://localhost:5173/
echo 已開啟瀏覽器 http://localhost:5173/ ！
