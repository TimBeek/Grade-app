param(
  [Parameter(Mandatory=$true)][string]$Directory,
  [Parameter(Mandatory=$true)][string]$ConfigPath
)
$ErrorActionPreference='Stop'
if (-not $env:REMARKT_DATABASE_URL -or -not $env:REMARKT_WORKSPACE_ID) { throw 'Set the private database URL and explicit workspace first.' }
if ($env:REMARKT_WORKSPACE_ID -notmatch '^[a-zA-Z0-9_-]{1,100}$') { throw 'Invalid workspace identifier.' }
if (-not [IO.Path]::IsPathRooted($Directory) -or -not [IO.Path]::IsPathRooted($ConfigPath)) { throw 'Use absolute paths outside the repository.' }
$backupConfigFile=[IO.Path]::GetFullPath($ConfigPath)
$backupDataDirectory=[IO.Path]::GetFullPath($Directory)
$backupRepoRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($backupConfigFile.StartsWith($backupRepoRoot,[StringComparison]::OrdinalIgnoreCase) -or $backupDataDirectory.StartsWith($backupRepoRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery files and protected configuration must be outside the repository.' }
if (Test-Path -LiteralPath $backupConfigFile) { throw 'Configuration already exists; never regenerate a key for an existing backup chain.' }
$backupBytes=New-Object byte[] 32
$backupGenerator=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $backupGenerator.GetBytes($backupBytes) } finally { $backupGenerator.Dispose() }
$backupHex=([BitConverter]::ToString($backupBytes)).Replace('-','').ToLowerInvariant()
$backupNode=(Get-Command node.exe -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($backupConfigFile)), $backupDataDirectory | Out-Null
$backupConfig=@{
  Database=(ConvertTo-SecureString $env:REMARKT_DATABASE_URL -AsPlainText -Force | ConvertFrom-SecureString)
  Key=(ConvertTo-SecureString $backupHex -AsPlainText -Force | ConvertFrom-SecureString)
  Workspace=$env:REMARKT_WORKSPACE_ID;Directory=$backupDataDirectory;Node=$backupNode
  Script=(Join-Path $PSScriptRoot 'backup-record-storage.mjs')
}
$backupJson=$backupConfig | ConvertTo-Json -Compress
$backupFileStream=[IO.File]::Open($backupConfigFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try { $backupOut=New-Object IO.StreamWriter($backupFileStream);$backupOut.Write($backupJson);$backupOut.Flush() }
finally { if($backupOut){$backupOut.Dispose()}else{$backupFileStream.Dispose()} }
Write-Output 'Protected configuration created. Keep this Windows profile intact; transfer the recovery key separately via your approved password vault before relying on another PC for restore.'
