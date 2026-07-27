$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$errors = New-Object System.Collections.Generic.List[string]

foreach ($required in @("index.html", "manifest.json", "pages", "assets")) {
  if (-not (Test-Path (Join-Path $repo $required))) { $errors.Add("不足: $required") }
}

try {
  $manifest = Get-Content -LiteralPath (Join-Path $repo "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($r in $manifest.ranges) {
    $f = Join-Path $repo ([string]$r.file).Replace('/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path $f)) { $errors.Add("manifest参照先なし: $($r.file)") }
  }
} catch { $errors.Add("manifest.jsonを解析できません: $($_.Exception.Message)") }

$htmls = @(Get-ChildItem -LiteralPath (Join-Path $repo "pages") -Filter *.html -File)
foreach ($html in $htmls) {
  $text = Get-Content -LiteralPath $html.FullName -Raw -Encoding UTF8
  if ($text -match 'data:image/') { $errors.Add("Base64画像が残っています: $($html.Name)") }
  $matches = [regex]::Matches($text, '\.\./assets/[^"'']+?\.(?:jpg|jpeg|png|webp)')
  foreach ($m in $matches) {
    $rel = $m.Value.Substring(3).Replace('/', [IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path (Join-Path $repo $rel))) { $errors.Add("画像参照先なし: $($html.Name) -> $($m.Value)") }
  }
}

if ($errors.Count -gt 0) {
  Write-Host "検証エラー:" -ForegroundColor Red
  $errors | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" }
  exit 1
}
Write-Host "検証OK: HTML=$($htmls.Count) / 参照切れなし / Base64なし" -ForegroundColor Green
exit 0
