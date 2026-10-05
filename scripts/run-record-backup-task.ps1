param([Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$backupConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
function Reveal-BackupSecret([string]$Protected) {
  $backupSecure = ConvertTo-SecureString $Protected
  $backupPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($backupSecure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($backupPointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($backupPointer) }
}
# DPAPI decrypts only for the Windows account that created this configuration.
$env:REMARKT_DATABASE_URL = Reveal-BackupSecret $backupConfig.Database
$env:REMARKT_BACKUP_KEY = Reveal-BackupSecret $backupConfig.Key
$env:REMARKT_WORKSPACE_ID = $backupConfig.Workspace
$env:REMARKT_BACKUP_DIR = $backupConfig.Directory
$env:REMARKT_BACKUP_MIRROR_DIR = $backupConfig.MirrorDirectory
try {
  & $backupConfig.Node $backupConfig.Script
  if ($LASTEXITCODE -ne 0) { throw 'Backup failed; the previous recovery chain was preserved.' }
} finally {
  Remove-Item Env:REMARKT_DATABASE_URL, Env:REMARKT_BACKUP_KEY, Env:REMARKT_BACKUP_MIRROR_DIR -ErrorAction SilentlyContinue
}
