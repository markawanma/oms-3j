# scripts/setup-silver-price-task.ps1
#
# ตั้งให้ Windows รัน scrape-silver-price.mjs อัตโนมัติ เก็บราคาเงินรายวัน
#
# รันครั้งเดียวจบ (คลิกขวาไฟล์นี้ -> Run with PowerShell)
# หรือเปิด PowerShell แล้วสั่ง:
#   powershell -ExecutionPolicy Bypass -File scripts\setup-silver-price-task.ps1
#
# ตั้งไว้ 3 รอบต่อวัน ไม่ใช่รอบเดียว:
#   09:00 = รอบหลักตามที่เจ้าของกำหนด
#   13:00 = เผื่อ 09:00 คอมปิด/เน็ตล่ม
#   20:00 = เผื่ออีกชั้น ก่อนไลฟ์เริ่มพอดี
# สคริปต์ upsert ตามวัน รอบหลังจึงไม่สร้างแถวซ้ำ แค่ทับค่าเดิมของวันนั้น
# — วันไหนพลาดทั้ง 3 รอบคือวันนั้นไม่มีราคา และกู้ย้อนหลังไม่ได้ เพราะหน้าเว็บ
#   โชว์เฉพาะราคาปัจจุบัน ไม่มีย้อนหลัง
#
# ⚠️ ข้อจำกัดที่ต้องรู้: งานนี้รันบนคอมเครื่องนี้เท่านั้น ถ้าคอมปิดทั้งวัน
#    จะไม่มีราคาของวันนั้น · ถ้าอยากให้เก็บได้แม้ปิดคอม ต้องย้ายไปรันบนคลาวด์
#    ซึ่งต้องมีที่ให้เปิดเบราว์เซอร์ได้ (หน้าเว็บต้องรัน JavaScript ถึงจะมีราคา)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$node = "C:\Program Files\nodejs\node.exe"
$script = Join-Path $repo "scripts\scrape-silver-price.mjs"
$envFile = Join-Path $repo ".env.local"
$logDir = Join-Path $repo "logs"
$taskName = "3J - เก็บราคาเงินรายวัน"

if (-not (Test-Path $node))    { throw "ไม่พบ node.exe ที่ $node" }
if (-not (Test-Path $script))  { throw "ไม่พบสคริปต์ที่ $script" }
if (-not (Test-Path $envFile)) { throw "ไม่พบ .env.local ที่ $envFile" }
if (-not (Test-Path $logDir))  { New-Item -ItemType Directory -Path $logDir | Out-Null }

# ห่อด้วย cmd เพื่อเก็บ log ทั้ง stdout และ stderr ไว้ดูย้อนหลังได้
$logFile = Join-Path $logDir "silver-price.log"
$inner = "`"$node`" --env-file=`"$envFile`" `"$script`" --commit >> `"$logFile`" 2>&1"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $inner" -WorkingDirectory $repo

$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At 09:00),
  (New-ScheduledTaskTrigger -Daily -At 13:00),
  (New-ScheduledTaskTrigger -Daily -At 20:00)
)

# StartWhenAvailable: ถ้าตอน 09:00 คอมหลับอยู่ ให้รันทันทีที่ตื่น
# (ดีกว่าข้ามไปเลย เพราะราคาสายๆ ยังดีกว่าไม่มีราคา)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
  -Settings $settings -Description "อ่านราคาเงินจาก 3jthailand.com/silver-price เก็บลง Supabase" -Force | Out-Null

Write-Output ""
Write-Output "  ตั้งงานอัตโนมัติเรียบร้อย: `"$taskName`""
Write-Output "  รอบเวลา : 09:00 / 13:00 / 20:00 ทุกวัน"
Write-Output "  log     : $logFile"
Write-Output ""
Write-Output "  ทดสอบรันเดี๋ยวนี้เลย:  Start-ScheduledTask -TaskName `"$taskName`""
Write-Output "  ดูสถานะ            :  Get-ScheduledTaskInfo -TaskName `"$taskName`""
Write-Output "  ยกเลิกงาน          :  Unregister-ScheduledTask -TaskName `"$taskName`" -Confirm:`$false"
Write-Output ""
