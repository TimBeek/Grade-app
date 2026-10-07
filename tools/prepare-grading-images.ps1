param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$assetRoot = Join-Path $projectRoot 'assets/dell-grading-fast'
$sourceRoot = [IO.Path]::GetFullPath('C:/Users/ReMarkt/.codex/generated_images')
$rows = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
$encoding = New-Object Drawing.Imaging.EncoderParameters(1)
$encoding.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]86)
foreach ($row in $rows) {
  $sourcePath = [IO.Path]::GetFullPath($row.path)
  if (!$sourcePath.StartsWith($sourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Source outside generated images.' }
  if ($row.name -notmatch '^[a-z0-9-]+$') { throw 'Invalid asset name.' }
  $version = if ($row.version) { $row.version } else { 'v1' }
  if ($version -notmatch '^v[0-9]+$') { throw 'Invalid asset version.' }
  $target = Join-Path $assetRoot ($row.name + '-' + $version + '-ai.jpg')
  if (Test-Path -LiteralPath $target) { continue }
  $original = [Drawing.Image]::FromFile($sourcePath)
  $bitmap = New-Object Drawing.Bitmap(1200, 800)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::White)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scale = [Math]::Min(1200 / $original.Width, 800 / $original.Height)
    $width = [int][Math]::Round($original.Width * $scale)
    $height = [int][Math]::Round($original.Height * $scale)
    $graphics.DrawImage($original, [int]((1200-$width)/2), [int]((800-$height)/2), $width, $height)
    $bitmap.Save($target, $codec, $encoding)
    [PSCustomObject]@{file=[IO.Path]::GetFileName($target); bytes=(Get-Item -LiteralPath $target).Length}
  } finally { $graphics.Dispose(); $bitmap.Dispose(); $original.Dispose() }
}
$encoding.Dispose()
