param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [ValidateSet('Plan','Migrate','Resume','Verify')][string]$Mode='Plan'
)
$ErrorActionPreference='Stop'
$maintenanceConfig=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
function Reveal-MaintenanceSecret([string]$Protected) {
  $maintenanceSecure=ConvertTo-SecureString $Protected
  $maintenancePointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($maintenanceSecure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($maintenancePointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($maintenancePointer) }
}
$env:REMARKT_DATABASE_URL=Reveal-MaintenanceSecret $maintenanceConfig.Database
$env:REMARKT_DATABASE_URL_UNPOOLED=$env:REMARKT_DATABASE_URL
$env:REMARKT_BACKUP_KEY=Reveal-MaintenanceSecret $maintenanceConfig.Key
$env:REMARKT_WORKSPACE_ID=$maintenanceConfig.Workspace
$env:REMARKT_BACKUP_DIR=$maintenanceConfig.Directory
try {
  if($Mode -eq 'Verify') {
    & $maintenanceConfig.Node (Join-Path $PSScriptRoot 'verify-recovery-chain.mjs') $maintenanceConfig.Directory
  } else {
    $maintenanceArgs=@()
    if($Mode -ne 'Plan') { $maintenanceArgs=@('--apply','--freeze-source') }
    if($Mode -eq 'Resume') { $maintenanceArgs+='--resume' }
    & $maintenanceConfig.Node (Join-Path $PSScriptRoot 'migrate-record-storage.mjs') @maintenanceArgs
  }
  if($LASTEXITCODE -ne 0){throw 'Maintenance stopped safely. Inspect the error; do not replace production with empty or older data.'}
} finally {
  Remove-Item Env:REMARKT_DATABASE_URL,Env:REMARKT_DATABASE_URL_UNPOOLED,Env:REMARKT_BACKUP_KEY -ErrorAction SilentlyContinue
}
