$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$files = @(
  'gas/Config.gs',
  'gas/Database.gs',
  'gas/Auth.gs',
  'gas/DriveHelper.gs',
  'gas/OwnerApi.gs',
  'gas/GuestApi.gs',
  'gas/Main.gs',
  'gas/Trigger.gs'
)

$chunks = foreach ($rel in $files) {
  $fullPath = Join-Path $root $rel
  if (-not (Test-Path $fullPath)) {
    throw "Missing file: $rel"
  }
  $content = [System.IO.File]::ReadAllText($fullPath, [System.Text.Encoding]::UTF8)
  "/* ==================== $rel ==================== */`r`n$content"
}

$combined = $chunks -join "`r`n`r`n"
Set-Clipboard -Value $combined

Write-Host "OK: $($files.Count) files ($($combined.Length) chars) copied to clipboard."
