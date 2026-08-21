@echo off
chcp 65001 >nul
title 3J Insight - หยุดเซิร์ฟเวอร์

rem ใช้เมื่อหน้าต่างเซิร์ฟเวอร์หายไปแล้วแต่ port 3000 ยังไม่ว่าง
rem (เช่นปิดหน้าต่างแบบไม่ผ่าน Ctrl+C แล้วเปิดใหม่ไม่ได้)

set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  echo   หยุด process %%a ที่จับ port 3000 อยู่
  taskkill /F /PID %%a >nul 2>&1
  set "FOUND=1"
)

if defined FOUND (
  echo.
  echo   เรียบร้อย — port 3000 ว่างแล้ว เปิดใหม่ได้เลย
) else (
  echo.
  echo   ไม่มีอะไรรันอยู่ที่ port 3000 อยู่แล้ว
)

echo.
timeout /t 3 >nul
