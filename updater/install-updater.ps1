# 安装 / 卸载“魅KTV效率助手”自动更新定时任务（当前用户，无需管理员）
#   安装：每 5 分钟运行一次 + 登录 Windows 时运行一次，执行 updater\auto-update.ps1（通过 run-hidden.vbs 隐藏窗口）
#   卸载：powershell -File install-updater.ps1 -Uninstall
param(
  [switch]$Uninstall,
  [switch]$DryRun   # 只显示将要创建的任务，不真正创建
)

$ErrorActionPreference = 'Stop'
$TaskName = 'MeiktvHelperAutoUpdate'
$UpdaterDir = $PSScriptRoot
$PluginDir = Split-Path -Parent $UpdaterDir
$Vbs = Join-Path $UpdaterDir 'run-hidden.vbs'
$User = "$env:USERDOMAIN\$env:USERNAME"
$ProtocolKey = 'HKCU:\Software\Classes\meiktv-helper-update'   # 2.4.3 的旧链接协议，安装/卸载时清理

if ($Uninstall) {
  if (Test-Path $ProtocolKey) { Remove-Item $ProtocolKey -Recurse -Force }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host '已关闭自动更新（定时任务已删除）。' -ForegroundColor Green
  } else {
    Write-Host '没有找到自动更新任务，无需卸载。'
  }
  exit 0
}

if (-not (Test-Path (Join-Path $PluginDir 'manifest.json'))) {
  Write-Host "没有在 $PluginDir 找到 manifest.json，请把本脚本放在插件目录的 updater 文件夹里运行。" -ForegroundColor Red
  exit 1
}

Write-Host '插件目录：' $PluginDir
Write-Host '任务名称：' $TaskName
Write-Host '运行频率：每 5 分钟一次，另外每次登录 Windows 时运行一次'
if (Test-Path (Join-Path $PluginDir '.git')) {
  Write-Host '提示：插件目录是 git 仓库（开发目录），自动更新会跳过它。' -ForegroundColor Yellow
}
if ($DryRun) { Write-Host '（DryRun：未创建任务）'; exit 0 }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Vbs + '"') -WorkingDirectory $UpdaterDir
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$logon = New-ScheduledTaskTrigger -AtLogOn -User $User
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$desc = '魅KTV效率助手：检查并安装插件新版本（从公司内网更新服务下载）。卸载：运行插件目录里的“卸载自动更新.bat”。'

try {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($hourly, $logon) -Settings $settings `
    -Principal $principal -Description $desc -Force | Out-Null
} catch {
  # 某些电脑不允许普通用户创建“登录时”触发器，退回只用每小时
  Write-Host "“登录时运行”创建失败（$($_.Exception.Message)），改为只每 5 分钟运行。" -ForegroundColor Yellow
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $hourly -Settings $settings `
    -Principal $principal -Description $desc -Force | Out-Null
}

# 2.4.3 曾注册过“立即更新”链接协议，现已不用，顺手清理
if (Test-Path $ProtocolKey) { Remove-Item $ProtocolKey -Recurse -Force -ErrorAction SilentlyContinue }

Start-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host '已开启自动更新，并已立即检查一次。' -ForegroundColor Green
Write-Host '以后发新版本，5 分钟内自动下载覆盖，插件随后自动重新加载；已打开的业务页面刷新后生效。'
Write-Host '更新记录：' (Join-Path $UpdaterDir 'update.log')
