@echo off
chcp 65001 >nul
title 3J Insight - Dev Server (ปิดหน้าต่างนี้ = ปิดเซิร์ฟเวอร์)
cd /d "%~dp0"

rem Node ไม่ได้อยู่ใน PATH ของเครื่องนี้ ต้องเติมเองทุกครั้ง
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo   3J Insight — กำลังเปิดเซิร์ฟเวอร์...
echo   เดี๋ยวเบราว์เซอร์จะเปิดให้เองใน 8 วินาที
echo.
echo   ปิดเซิร์ฟเวอร์: กด Ctrl+C หรือปิดหน้าต่างนี้ทิ้ง
echo.

rem เปิดเบราว์เซอร์แบบหน่วงเวลา ให้ Next.js ตั้งตัวเสร็จก่อน
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start "" http://localhost:3000"

call npm run dev

echo.
echo   เซิร์ฟเวอร์หยุดแล้ว — กดปุ่มอะไรก็ได้เพื่อปิดหน้าต่าง
pause >nul
