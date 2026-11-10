@echo off
cd /d "%~dp0"
echo ========================================================
echo   AI Office - Deploying to GitHub Pages
echo   Target Repo: https://github.com/szhu72/ai-office.git
echo ========================================================
echo.

echo [Step 1/3] Building production bundle (dist/)...
call npm.cmd run build

echo.
echo [Step 2/3] Committing files to Git (.env is excluded)...
if not exist ".git" (
    git init
    git branch -M main
)
git config user.name "szhu72"
git config user.email "szhu72@users.noreply.github.com"
git add .
git commit -m "Deploy AI Office RPG Edition to GitHub Pages"

echo.
echo [Step 3/3] Pushing to GitHub (https://github.com/szhu72/ai-office.git)...
echo (If a GitHub sign-in window pops up, please click Sign in with browser)
git remote remove origin 2>nul
git remote add origin https://github.com/szhu72/ai-office.git
git push -u origin main --force

echo.
echo ========================================================
echo   DONE!
echo   Next: Open https://github.com/szhu72/ai-office/settings/pages
echo   Set "Build and deployment -> Source" to "GitHub Actions"
echo   Your mobile site URL:
echo   https://szhu72.github.io/ai-office/
echo ========================================================
pause
