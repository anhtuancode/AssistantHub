@echo off
title MindX Assistant - Tro ly Giao vien v1.0
cd /d "%~dp0"

echo ========================================================
echo   KHOI DONG MINDX ASSISTANT - TRO LY GIAO VIEN v1.0
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [LOI] Khong tim thay Node.js tren may tinh. Vui long cai dat Node.js truoc.
  pause
  exit /b 1
)

echo Dang mo trinh duyet tai http://localhost:3000 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

echo Dang khoi chay may chu MindX Assistant...
node src/server.js
pause
