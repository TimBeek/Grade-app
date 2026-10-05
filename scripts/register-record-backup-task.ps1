param(
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [switch]$Register
)
$ErrorActionPreference = 'Stop'
$backupConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$backupConfig = Get-Content -LiteralPath $backupConfigPath -Raw | ConvertFrom-Json
$backupRunner = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'run-record-backup-task.ps1')).Path
if ($backupConfigPath.Contains('"') -or $backupRunner.Contains('"')) { throw 'Invalid task path.' }
$backupName = 'ReMarkt record backups - ' + $backupConfig.Workspace
if (Get-ScheduledTask -TaskName $backupName -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect it instead of overwriting.' }
Write-Output "Hourly encrypted incremental backup: $backupName"
if (-not $Register) { Write-Output 'Read-only plan. Add -Register to install.'; return }
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -File `"$backupRunner`" -ConfigPath `"$backupConfigPath`""
$backupTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -Hidden -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$backupPrincipal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $backupName -Action $backupAction -Trigger $backupTrigger -Settings $backupSettings -Principal $backupPrincipal -Description 'Encrypted external ReMarkt full checkpoint and incremental backups; no archive read on unchanged revisions.' | Select-Object TaskName, State
