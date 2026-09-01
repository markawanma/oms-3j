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
rem Two-tier fallback (added with capture-silver-price-sheet.mjs): try the
rem Sheet-based capture first (plain fetch, no browser, also writes the new
rem append-only analytics.silver_price_history log) — if it exits non-zero
rem (Sheet unreachable, cross-check failed, structure changed), fall back to
rem the original Playwright website scraper so the daily price capture still
rem has a second chance to succeed. Both write --commit; only one needs to
rem land for the day's price to be captured.
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

echo --- primary: capture-silver-price-sheet.mjs --- >> "logs\silver-price.log"
"C:\Program Files\nodejs\node.exe" --env-file=".env.local" "scripts\capture-silver-price-sheet.mjs" --commit >> "logs\silver-price.log" 2>&1

set RC=%ERRORLEVEL%
echo exit code (sheet capture): %RC% >> "logs\silver-price.log"

if %RC% EQU 0 goto :done

echo --- primary failed, falling back to scrape-silver-price.mjs (Playwright) --- >> "logs\silver-price.log"
"C:\Program Files\nodejs\node.exe" --env-file=".env.local" "scripts\scrape-silver-price.mjs" --commit >> "logs\silver-price.log" 2>&1

set RC=%ERRORLEVEL%
echo exit code (fallback scrape): %RC% >> "logs\silver-price.log"

:done
exit /b %RC%
