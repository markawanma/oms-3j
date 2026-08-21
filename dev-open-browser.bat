@echo off
rem Helper for start-dev.bat: wait until Next.js is actually listening on
rem port 3000, then open the browser. Polls instead of using a fixed delay,
rem because a cold start can take 30s+ while a warm one takes 5s.
rem ASCII ONLY (see start-dev.bat header).
setlocal enabledelayedexpansion
set /a tries=0

:wait
set /a tries+=1
timeout /t 2 /nobreak >nul
netstat -aon | findstr ":3000 " | findstr "LISTENING" >nul
if errorlevel 1 (
  if !tries! lss 60 goto wait
  rem gave up after ~2 minutes - open anyway so the user sees the error page
)

start "" http://localhost:3000
exit
