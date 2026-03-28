param(
  [string]$PackageId = "com.jtzt.app",
  [string]$AdminReceiver = ".KioskDeviceAdminReceiver"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$adb = (Get-Command adb -ErrorAction Stop).Source
$componentName = if ($AdminReceiver.StartsWith(".")) {
  "$PackageId/$AdminReceiver"
} else {
  "$PackageId/$AdminReceiver"
}

$connectedDevices = & $adb devices | Select-String -Pattern "device$"
if (-not $connectedDevices) {
  throw "No Android device detected by adb."
}

$installedPackages = & $adb shell pm list packages $PackageId
if (-not ($installedPackages -match [regex]::Escape($PackageId))) {
  throw "Package $PackageId is not installed on the connected device."
}

Write-Host "Provisioning device owner: $componentName"
Write-Host "The device must be freshly reset and have no accounts configured."
& $adb shell dpm set-device-owner $componentName
if ($LASTEXITCODE -ne 0) {
  throw "Device-owner provisioning failed."
}

Write-Host "Launching kiosk app..."
& $adb shell monkey -p $PackageId -c android.intent.category.LAUNCHER 1 | Out-Null
Write-Host "Device-owner provisioning completed."
