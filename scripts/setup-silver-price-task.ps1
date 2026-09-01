# scripts/setup-silver-price-task.ps1
#
# Registers the Windows Scheduled Task that captures silver prices from the
# Google Sheet (CSV, no browser) into Supabase, with Playwright fallback.
#
# ASCII ONLY. Do NOT put Thai text in this file: Windows PowerShell 5.1 reads
# .ps1 as ANSI unless the file has a UTF-8 BOM, so Thai characters become
# mojibake and the parser dies on unterminated strings. (Learned twice,
# 2026-08-25.)
#
# Run once (re-run replaces the task):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-silver-price-task.ps1
#
# SCHEDULE (owner decided 2026-09-01, replaces the old daily 09/13/20):
#   Mon-Fri : 09:00, 13:00, 17:00, 21:00   <- owner's every-4h plan
#   Mon-Fri : 23:55 end-of-day sweep       <- Tech Lead amendment: the sheet
#             was updated at 22:04 (Aug 31) and 23:43 (Aug 24), both AFTER a
#             21:00 cutoff and right in the nightly live window (20:00-23:00).
#             Without this round those price changes are lost forever (the
#             sheet only shows the CURRENT price, no history).
#   Sat     : 09:00 single run             <- captures the price standing at
#             the weekly market close (US close ~04:00-05:00 Thai, Sat).
#   Sun     : nothing                      <- world market closed, sheet
#             cannot meaningfully change (owner: market closed Sat morning
#             through Monday morning).
#
# Re-running the capture when the price has NOT changed inserts nothing
# (sheet_row_hash dedup in capture-silver-price-sheet.mjs), so extra rounds
# cost ~1 second of CPU and zero rows.
#
# LIMITATION (unchanged): runs on THIS PC only. If the machine is off or
# offline at a trigger time, that round is skipped; StartWhenAvailable runs
# it as soon as the PC wakes. Cloud migration is a future phase (now easy,
# since the capture is plain CSV fetch - no browser needed).

$ErrorActionPreference = "Stop"

$repo     = Split-Path -Parent $PSScriptRoot
$node     = "C:\Program Files\nodejs\node.exe"
$script   = Join-Path $repo "scripts\capture-silver-price-sheet.mjs"
$envFile  = Join-Path $repo ".env.local"
$logDir   = Join-Path $repo "logs"
$taskName = "3J Silver Price Daily"

if (-not (Test-Path $node))    { throw "node.exe not found at $node" }
if (-not (Test-Path $script))  { throw "capture script not found at $script" }
if (-not (Test-Path $envFile)) { throw ".env.local not found at $envFile" }
if (-not (Test-Path $logDir))  { New-Item -ItemType Directory -Path $logDir | Out-Null }

# .bat wrapper does its own redirect - see run-silver-price.bat header for
# why the command line cannot be built here (cmd nested-quote rules).
$runner  = Join-Path $repo "scripts\run-silver-price.bat"
if (-not (Test-Path $runner)) { throw "runner not found at $runner" }
$action  = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $repo

$weekdays = @("Monday","Tuesday","Wednesday","Thursday","Friday")

$triggers = @(
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 09:00),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 13:00),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 17:00),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 21:00),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek $weekdays -At 23:55),
  (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday  -At 09:00)
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Settings $settings -Description "Capture silver prices (Google Sheet CSV) into Supabase - Mon-Fri 09/13/17/21/23:55, Sat 09:00" -Force | Out-Null

Write-Output ""
Write-Output "  Registered task: $taskName"
Write-Output "  Mon-Fri        : 09:00 / 13:00 / 17:00 / 21:00 / 23:55"
Write-Output "  Saturday       : 09:00 (weekly close sweep)"
Write-Output "  Sunday         : off (market closed)"
Write-Output "  Log file       : $logDir\silver-price.log"
Write-Output ""
Write-Output "  Run now    : Start-ScheduledTask -TaskName '$taskName'"
Write-Output "  Check state: Get-ScheduledTaskInfo -TaskName '$taskName'"
Write-Output "  Remove     : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Output ""
