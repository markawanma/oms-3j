# scripts/setup-silver-price-task.ps1
#
# Registers a Windows Scheduled Task that captures the daily silver price
# from 3jthailand.com/silver-price into Supabase.
#
# ASCII ONLY. Do NOT put Thai text in this file: Windows PowerShell 5.1 reads
# .ps1 as ANSI unless the file has a UTF-8 BOM, so Thai characters become
# mojibake and the parser dies on unterminated strings. (Same trap as the
# .bat files - learned twice now, 2026-08-25.)
#
# Run once:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-silver-price-task.ps1
#
# Three runs per day, not one:
#   09:00 = the main run the owner asked for
#   13:00 = fallback if the PC was off / network failed at 09:00
#   20:00 = last chance, just before the nightly live starts
# The scraper upserts by date, so later runs overwrite the same row rather
# than adding duplicates. Miss all three and that day has no price at all -
# the site only ever shows the CURRENT price, there is no history to backfill.
#
# LIMITATION: this runs on THIS PC only. If the machine is off all day, that
# day is lost. StartWhenAvailable makes it run as soon as the PC wakes, which
# helps but does not fully solve it. Moving this to the cloud needs somewhere
# that can run a real browser (the page needs JavaScript before prices exist).

$ErrorActionPreference = "Stop"

$repo     = Split-Path -Parent $PSScriptRoot
$node     = "C:\Program Files\nodejs\node.exe"
$script   = Join-Path $repo "scripts\scrape-silver-price.mjs"
$envFile  = Join-Path $repo ".env.local"
$logDir   = Join-Path $repo "logs"
$taskName = "3J Silver Price Daily"

if (-not (Test-Path $node))    { throw "node.exe not found at $node" }
if (-not (Test-Path $script))  { throw "scraper not found at $script" }
if (-not (Test-Path $envFile)) { throw ".env.local not found at $envFile" }
if (-not (Test-Path $logDir))  { New-Item -ItemType Directory -Path $logDir | Out-Null }

# Calls a .bat wrapper instead of building the command line here. Passing a
# quoted node path AND a >> redirect through cmd.exe /c "..." trips cmd's
# nested-quote rules: the task exits with code 1 before writing any log, which
# looks like the scraper failed when in fact it never started. The .bat does
# its own redirect, so nothing needs quoting at this layer.
$logFile = Join-Path $logDir "silver-price.log"
$runner  = Join-Path $repo "scripts\run-silver-price.bat"
if (-not (Test-Path $runner)) { throw "runner not found at $runner" }
$action  = New-ScheduledTaskAction -Execute $runner -WorkingDirectory $repo

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 09:00),
  (New-ScheduledTaskTrigger -Daily -At 13:00),
  (New-ScheduledTaskTrigger -Daily -At 20:00)
)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Settings $settings -Description "Capture daily silver price from 3jthailand.com into Supabase" -Force | Out-Null

Write-Output ""
Write-Output "  Registered task: $taskName"
Write-Output "  Runs at        : 09:00 / 13:00 / 20:00 every day"
Write-Output "  Log file       : $logFile"
Write-Output ""
Write-Output "  Run now    : Start-ScheduledTask -TaskName '$taskName'"
Write-Output "  Check state: Get-ScheduledTaskInfo -TaskName '$taskName'"
Write-Output "  Remove     : Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
Write-Output ""
