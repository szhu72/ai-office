@echo off
cd /d "%~dp0"
echo ========================================================
echo   Starting AI Office (Backend port 5000 + Frontend 5173)
echo ========================================================
start "AI Office Backend (Flask)" cmd /k "".\.venv\Scripts\python.exe" app.py"
start "AI Office Frontend (Vite)" cmd /k "npm.cmd run dev -- --port 5173 --strictPort"
timeout /t 3 >nul
start "" "http://localhost:5173"
