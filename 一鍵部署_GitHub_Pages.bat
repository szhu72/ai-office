@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================================
echo   🚀 無所事事辦公室 (AI Office) — 一鍵部署到 GitHub Pages
echo   目標儲存庫: https://github.com/szhu72/ai-office.git
echo ========================================================
echo.
set "REPO_URL=https://github.com/szhu72/ai-office.git"

echo [1/3] 正在編譯最新前端與 GitHub Pages 靜態資料包...
call npm.cmd run build

echo.
echo [2/3] 正在打包 Git 版本紀錄 (已自動排除 .env 私密金鑰)...
if not exist ".git" (
    git init
    git branch -M main
)
git config user.name "szhu72"
git config user.email "szhu72@users.noreply.github.com"
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
echo 請到 https://github.com/szhu72/ai-office/settings/pages
echo 將 [Build and deployment] 的 Source 選擇為 [GitHub Actions]
echo 等待約 40 秒後，即可用手機打開：
echo 👉 https://szhu72.github.io/ai-office/
echo ========================================================
pause
