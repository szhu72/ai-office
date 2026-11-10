@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   🚀 無所事事辦公室 (AI Office) — 一鍵部署到 GitHub Pages
echo ========================================================
echo.
set /p REPO_URL="請貼上你在 GitHub 建立的空白儲存庫網址 (例如 https://github.com/你的帳號/ai-office.git): "
if "%REPO_URL%"=="" (
    echo [錯誤] 未輸入 GitHub 儲存庫網址，已取消。
    pause
    exit /b 1
)

echo.
echo [1/3] 正在編譯最新前端與 GitHub Pages 靜態資料包...
call npm.cmd run build

echo.
echo [2/3] 正在打包 Git 版本紀錄 (已自動排除 .env 私密金鑰)...
if not exist ".git" (
    git init
    git branch -M main
)
git config user.name "AI Office Director"
git config user.email "director@ai-office.local"
git add .
git commit -m "Deploy AI Office RPG Edition to GitHub Pages" 2>nul

echo.
echo [3/3] 正在推送到 GitHub (%REPO_URL%)...
git remote remove origin 2>nul
git remote add origin "%REPO_URL%"
git push -u origin main --force

echo.
echo ========================================================
echo ✅ 推送完成！
echo 請到你的 GitHub 儲存庫網頁：
echo   1. 點選上方 [Settings] -^> 左側 [Pages]
echo   2. 在 [Build and deployment] 的 Source 選擇 [GitHub Actions]
echo   3. 等待約 40 秒，即可用手機打開你的 github.io 專屬網址！
echo   4. 手機打開網頁後，點右上角 [🔑 金鑰設定] 填入你的 GEMINI_API_KEY 即可暢玩！
echo ========================================================
pause
