@echo off
rem ---------------------------------------------------------------
rem 3J Insight - start local dev server
rem ASCII ONLY. Do NOT put Thai text in this file: cmd.exe misparses
rem multi-byte characters and the whole script breaks, not just the
rem message. (Learned the hard way 2026-08-21.)
rem ---------------------------------------------------------------
title 3J Insight - Dev Server
cd /d "%~dp0"

rem Node is not on this machine's PATH - add it here every time.
set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo   3J Insight - starting dev server...
echo   Browser opens by itself as soon as the server is ready.
echo.
echo   URL  : http://localhost:3000
echo   Stop : press Ctrl+C, or just close this window.
echo.

rem Delayed browser open runs in its own minimised window so it does not
rem block the server. Separate file = no nested-quote headaches.
start "" /min "%~dp0dev-open-browser.bat"

call npm run dev

echo.
echo   Server stopped. Press any key to close this window.
pause >nul
