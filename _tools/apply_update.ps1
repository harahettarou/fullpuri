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
if ($children.Count -eq 1 -and $children[0].PSIsContainer -and $children[0].Name -notin @('assets','pages','_tools')) { $root = $children[0].FullName }

$hasPayload = (Test-Path (Join-Path $root "pages")) -or (Test-Path (Join-Path $root "assets")) -or (Test-Path (Join-Path $root "manifest.json"))
if (-not $hasPayload) { Fail "更新ZIPに pages / assets / manifest.json のいずれもありません。" }

# Fail before overwriting any file if a changed base image lacks verified provenance.
$imageFiles = @()
$assetPayload = Join-Path $root "assets"
if (Test-Path -LiteralPath $assetPayload) {
  $imageFiles = @(Get-ChildItem -LiteralPath $assetPayload -Recurse -File | Where-Object {
    $_.Name -match '_(base|tray).*\.(jpg|jpeg|png|webp)$'
  })
}

function GetOriginalHash([string]$path) {
  $stream = [IO.File]::OpenRead($path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
$provenance = @{}
$provenancePath = Join-Path $root "assets/original-image-provenance.json"
if (Test-Path -LiteralPath $provenancePath) {
  $metadata = Get-Content -LiteralPath $provenancePath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($item in $metadata.images) {
    if ($provenance.ContainsKey([string]$item.asset)) { Fail "画像の出典記録が重複しています。" }
    $provenance[[string]$item.asset] = $item
  }
}
foreach ($image in $imageFiles) {
  $rel = $image.FullName.Substring($root.TrimEnd('\','/').Length + 1).Replace('\','/')
  $hash = GetOriginalHash $image.FullName
  $existing = Join-Path $repo $rel
  if ((Test-Path -LiteralPath $existing) -and ((GetOriginalHash $existing) -eq $hash)) { continue }
  $record = $provenance[$rel]
  if (-not $record -or $record.sha256 -ne $hash) { Fail "原本検証記録がない画像更新を拒否しました: $rel" }
  if ($record.source_kind -notin @('zip_pdf','zip_jpeg')) { Fail "修正モードZIP以外の画像は原本にできません: $rel" }
  if ($record.source_kind -eq 'zip_jpeg' -and -not $metadata.jpeg_exception_authorized) { Fail "ZIP内JPEGの使用許可が記録されていません: $rel" }
  if ($record.source_archive_sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $record.source_pixel_sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $record.source_pixel_sha256 -ne $record.output_pixel_sha256) { Fail "原本画素の一致記録が不正です: $rel" }
  if ($record.generation_method -eq 'unchanged-original-bytes') {
    if ($record.source_sha256 -ne $hash) { Fail "原本と更新画像の内容が一致しません: $rel" }
  } elseif ($record.generation_method -ne 'lossless-PNG-native-pixels') { Fail "加工済み画像の生成方法は許可されていません: $rel" }
}

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
