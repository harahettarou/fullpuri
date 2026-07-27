param()
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$inbox = Join-Path $repo "_update_inbox"
$done = Join-Path $repo "_update_done"
$temp = Join-Path $repo "_update_temp"

function Fail([string]$msg) {
  Write-Host "`n[エラー] $msg" -ForegroundColor Red
  Read-Host "Enterキーで終了"
  exit 1
}

$zips = @(Get-ChildItem -LiteralPath $inbox -Filter *.zip -File)
if ($zips.Count -eq 0) { Fail "_update_inbox に更新ZIPがありません。" }
if ($zips.Count -gt 1) { Fail "更新ZIPは1個だけ置いてください。" }

if (Test-Path $temp) { Remove-Item $temp -Recurse -Force }
New-Item -ItemType Directory -Path $temp | Out-Null
Expand-Archive -LiteralPath $zips[0].FullName -DestinationPath $temp -Force

$root = $temp
$children = @(Get-ChildItem -LiteralPath $temp -Force)
if ($children.Count -eq 1 -and $children[0].PSIsContainer) { $root = $children[0].FullName }

$hasPayload = (Test-Path (Join-Path $root "pages")) -or (Test-Path (Join-Path $root "assets")) -or (Test-Path (Join-Path $root "manifest.json"))
if (-not $hasPayload) { Fail "更新ZIPに pages / assets / manifest.json のいずれもありません。" }

foreach ($name in @("pages", "assets")) {
  $src = Join-Path $root $name
  if (Test-Path $src) {
    $dst = Join-Path $repo $name
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
  }
}
foreach ($name in @("manifest.json", "index.html", "validation-report.json")) {
  $src = Join-Path $root $name
  if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $repo $name) -Force }
}

$removeList = Join-Path $root "remove-list.txt"
if (Test-Path $removeList) {
  Get-Content -LiteralPath $removeList -Encoding UTF8 | ForEach-Object {
    $rel = $_.Trim()
    if ($rel -and -not $rel.StartsWith("#")) {
      $target = Join-Path $repo $rel
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    }
  }
}

& (Join-Path $PSScriptRoot "validate_site.ps1")
if ($LASTEXITCODE -ne 0) { Fail "検証に失敗しました。変更をGitHub Desktopで確認してください。" }

New-Item -ItemType Directory -Force -Path $done | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Move-Item -LiteralPath $zips[0].FullName -Destination (Join-Path $done ("$stamp-" + $zips[0].Name)) -Force
Remove-Item $temp -Recurse -Force

Write-Host "`n更新を適用し、検証にも合格しました。" -ForegroundColor Green
Write-Host "GitHub Desktopで Commit to main → Push origin を押してください。"
Read-Host "Enterキーで終了"
