@echo off
rem ---------------------------------------------------------------
rem scripts/run-silver-price.bat
rem
rem Wrapper the Scheduled Task calls. Exists because passing the whole
rem node command line (with quoted paths AND a >> redirect) through
rem `cmd.exe /c "..."` from Register-ScheduledTask hits cmd's nested-quote
rem rules and fails with exit code 1 before writing anything. A .bat file
rem sidesteps the quoting entirely.
rem
rem ASCII ONLY (see setup-silver-price-task.ps1 header for why).
rem ---------------------------------------------------------------
setlocal
rem UTF-8 so the Thai output from the scraper is readable in the log file
rem instead of mojibake (the data was always correct, only the log was
rem unreadable - this is purely so a human can check what happened).
chcp 65001 >nul
set "REPO=%~dp0.."
cd /d "%REPO%"

if not exist "logs" mkdir "logs"

echo. >> "logs\silver-price.log"
echo ===== %DATE% %TIME% ===== >> "logs\silver-price.log"

"C:\Program Files\nodejs\node.exe" --env-file=".env.local" "scripts\scrape-silver-price.mjs" --commit >> "logs\silver-price.log" 2>&1

set RC=%ERRORLEVEL%
echo exit code: %RC% >> "logs\silver-price.log"
exit /b %RC%
