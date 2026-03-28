param(
  [string]$LogoSvgPath = (Join-Path $PSScriptRoot "..\..\frontend\public\logo.svg")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..")
$tempDir = Join-Path $repoRoot "apk\.generated-assets"
$tempSvg = Join-Path $tempDir "logo-android.svg"
$tempPng = Join-Path $tempDir "logo-android.png"

function Resolve-Inkscape {
  $candidates = @(
    "C:\Program Files\Inkscape\bin\inkscape.com",
    "C:\Program Files\Inkscape\bin\inkscape.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command inkscape.com -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $command = Get-Command inkscape -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Inkscape is required to render Android assets. Install Inkscape or add inkscape.com to PATH."
}

function New-SquarePng {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Bitmap]$Source,
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][int]$Size,
    [Parameter(Mandatory = $true)][bool]$BlackBackground
  )

  $canvas = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)

  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $backgroundColor = if ($BlackBackground) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::Transparent }
    $graphics.Clear($backgroundColor)

    $scale = [Math]::Min(($Size * 0.44) / $Source.Width, ($Size * 0.44) / $Source.Height)
    $drawWidth = [int][Math]::Round($Source.Width * $scale)
    $drawHeight = [int][Math]::Round($Source.Height * $scale)
    $drawX = [int][Math]::Floor(($Size - $drawWidth) / 2)
    $drawY = [int][Math]::Floor(($Size - $drawHeight) / 2)

    $graphics.DrawImage($Source, $drawX, $drawY, $drawWidth, $drawHeight)
    $canvas.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $canvas.Dispose()
  }
}

if (-not (Test-Path $LogoSvgPath)) {
  throw "Missing logo SVG at $LogoSvgPath"
}

$inkscape = Resolve-Inkscape
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null

$svg = Get-Content -Raw -Path $LogoSvgPath
$svg = [regex]::Replace($svg, '\s*<rect\s+width="1535"\s+height="1000"\s+fill="#000000"\s*/>\s*', "`r`n")
[System.IO.File]::WriteAllText($tempSvg, $svg, (New-Object System.Text.UTF8Encoding($false)))

& $inkscape $tempSvg --export-type=png --export-filename=$tempPng --export-background-opacity=0 --export-width=1535 | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to export logo SVG with Inkscape."
}

$sourceImage = [System.Drawing.Bitmap]::FromFile($tempPng)

try {
  $iconSizes = @{
    mdpi = 48
    hdpi = 72
    xhdpi = 96
    xxhdpi = 144
    xxxhdpi = 192
  }

  $splashSizes = @{
    mdpi = 300
    hdpi = 450
    xhdpi = 600
    xxhdpi = 900
    xxxhdpi = 1200
  }

  foreach ($entry in $iconSizes.GetEnumerator()) {
    $density = $entry.Key
    $size = [int]$entry.Value

    $mipmapDir = Join-Path $repoRoot "apk\twa\app\src\main\res\mipmap-$density"
    $drawableDir = Join-Path $repoRoot "apk\twa\app\src\main\res\drawable-$density"
    New-Item -ItemType Directory -Force -Path $mipmapDir, $drawableDir | Out-Null

    New-SquarePng -Source $sourceImage -Path (Join-Path $mipmapDir "ic_launcher.png") -Size $size -BlackBackground $true
    New-SquarePng -Source $sourceImage -Path (Join-Path $mipmapDir "ic_maskable.png") -Size $size -BlackBackground $false
    New-SquarePng -Source $sourceImage -Path (Join-Path $drawableDir "ic_notification_icon.png") -Size $size -BlackBackground $false
  }

  foreach ($entry in $splashSizes.GetEnumerator()) {
    $density = $entry.Key
    $size = [int]$entry.Value
    $drawableDir = Join-Path $repoRoot "apk\twa\app\src\main\res\drawable-$density"
    New-Item -ItemType Directory -Force -Path $drawableDir | Out-Null

    New-SquarePng -Source $sourceImage -Path (Join-Path $drawableDir "splash.png") -Size $size -BlackBackground $true
  }
} finally {
  $sourceImage.Dispose()
}
