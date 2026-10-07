param([Parameter(Mandatory=$true)][string]$ManifestPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$reviewRoot=Join-Path $projectRoot 'output/grading-image-review'
New-Item -ItemType Directory -Path $reviewRoot -Force | Out-Null
$rows=Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$font=New-Object Drawing.Font('Arial', 12)
try {
  for($page=0; $page -lt [Math]::Ceiling($rows.Count/9); $page++) {
    $sheet=New-Object Drawing.Bitmap(1200, 915)
    $g=[Drawing.Graphics]::FromImage($sheet)
    try {
      $g.Clear([Drawing.Color]::White)
      for($slot=0; $slot -lt 9; $slot++) {
        $index=$page*9+$slot
        if($index -ge $rows.Count) { break }
        $row=$rows[$index]
        $image = if ($row.image) { $row.image } else { 'assets/dell-grading-fast/'+$row.name+'-v1-ai.jpg' }
        $assetPath=Join-Path $projectRoot $image
        $photo=[Drawing.Image]::FromFile($assetPath)
        try {
          $x=[int](($slot%3)*400); $y=[int]([Math]::Floor($slot/3)*305)
          $g.DrawImage($photo,$x,$y,400,267)
          $caption = if ($row.label) { $row.component + ': ' + $row.label } else { $row.name }
          $g.DrawString($caption,$font,[Drawing.Brushes]::Black,$x+8,$y+272)
        } finally { $photo.Dispose() }
      }
      $sheet.Save((Join-Path $reviewRoot ('sheet-'+($page+1)+'.jpg')),[Drawing.Imaging.ImageFormat]::Jpeg)
    } finally { $g.Dispose(); $sheet.Dispose() }
  }
} finally { $font.Dispose() }
Get-ChildItem -LiteralPath $reviewRoot -Filter 'sheet-*.jpg' | Select-Object Name,Length
