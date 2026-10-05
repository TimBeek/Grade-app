param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$Directory,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
$mirrorConfigFile=(Resolve-Path -LiteralPath $ConfigPath).Path
$mirrorConfig=Get-Content -LiteralPath $mirrorConfigFile -Raw | ConvertFrom-Json
if(-not [IO.Path]::IsPathRooted($Directory)){throw 'Use an absolute path to an approved second disk, NAS or company folder.'}
$mirrorTarget=[IO.Path]::GetFullPath($Directory).TrimEnd('\','/')
$mirrorPrimary=[IO.Path]::GetFullPath($mirrorConfig.Directory).TrimEnd('\','/')
$mirrorRepo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\','/')
foreach($mirrorForbidden in @($mirrorPrimary,$mirrorRepo)) {
  if($mirrorTarget.Equals($mirrorForbidden,[StringComparison]::OrdinalIgnoreCase) -or $mirrorTarget.StartsWith($mirrorForbidden+'\',[StringComparison]::OrdinalIgnoreCase)) {
    throw 'The second backup must be separate from the primary folder and source repository.'
  }
}
Write-Output 'Plan: copy only encrypted recovery files; never mirror credentials or the recovery key. Primary files will not be deleted.'
if(-not $Apply){Write-Output 'Add -Apply after confirming this is a different physical disk, NAS or company backup location.';return}
if(-not (Test-Path -LiteralPath $mirrorTarget -PathType Container)){throw 'The approved second folder must already exist and be accessible.'}
$mirrorConfig | Add-Member -NotePropertyName MirrorDirectory -NotePropertyValue $mirrorTarget -Force
$mirrorSaved=$mirrorConfigFile+'.before-mirror-'+(Get-Date -Format 'yyyyMMddHHmmss')
Copy-Item -LiteralPath $mirrorConfigFile -Destination $mirrorSaved -ErrorAction Stop
$mirrorPending=$mirrorConfigFile+'.pending'
if(Test-Path -LiteralPath $mirrorPending){throw 'An earlier pending configuration exists; inspect it before proceeding.'}
[IO.File]::WriteAllText($mirrorPending,($mirrorConfig|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
Move-Item -LiteralPath $mirrorPending -Destination $mirrorConfigFile -Force
& (Join-Path $PSScriptRoot 'run-record-backup-task.ps1') -ConfigPath $mirrorConfigFile
if($LASTEXITCODE -ne 0){throw 'Second copy is not verified. Primary backup remains intact; check access and task status.'}
