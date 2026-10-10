@echo off
chcp 65001 >nul
where node >nul 2>nul || (echo ثبّت Node.js اولا من https://nodejs.org ثم شغّل الملف مرة ثانية & pause & exit /b)
call npm install || (echo فشل التثبيت & pause & exit /b)
call npm run build || (echo فشل البناء & pause & exit /b)
echo.
echo تم! ملف التثبيت (exe) داخل مجلد dist
start "" dist
pause
