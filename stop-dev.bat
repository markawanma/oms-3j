@echo off
rem ---------------------------------------------------------------
rem 3J Insight - free port 3000 when the server window is gone but
rem the port is still held (window closed without Ctrl+C).
rem ASCII ONLY (see start-dev.bat header).
rem ---------------------------------------------------------------
title 3J Insight - Stop Dev Server

set "FOUND="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 " ^| findstr "LISTENING"') do (
  echo   Killing process %%a holding port 3000
  taskkill /F /PID %%a >nul 2>&1
  set "FOUND=1"
)

echo.
if defined FOUND (
  echo   Done - port 3000 is free. You can start again.
) else (
  echo   Nothing was running on port 3000.
)
echo.
timeout /t 4 >nul
