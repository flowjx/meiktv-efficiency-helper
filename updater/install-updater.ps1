# 安装 / 卸载“魅KTV效率助手”自动更新定时任务（当前用户，无需管理员）
#   安装：每小时运行一次 + 登录 Windows 时运行一次，执行 updater\auto-update.ps1（通过 run-hidden.vbs 隐藏窗口）
#   同时注册当前用户的链接协议 meiktv-helper-update:（插件弹窗“立即更新”按钮用它在后台跑一次 auto-update）
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
$ProtocolKey = 'HKCU:\Software\Classes\meiktv-helper-update'

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
Write-Host '运行频率：每小时一次，另外每次登录 Windows 时运行一次'
if (Test-Path (Join-Path $PluginDir '.git')) {
  Write-Host '提示：插件目录是 git 仓库（开发目录），自动更新会跳过它。' -ForegroundColor Yellow
}
if ($DryRun) { Write-Host '（DryRun：未创建任务）'; exit 0 }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $Vbs + '"') -WorkingDirectory $UpdaterDir
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
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
  Write-Host "“登录时运行”创建失败（$($_.Exception.Message)），改为只每小时运行。" -ForegroundColor Yellow
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $hourly -Settings $settings `
    -Principal $principal -Description $desc -Force | Out-Null
}

# 链接协议：只写当前用户注册表；不接收任何参数，打开它只会在后台跑一次 auto-update.ps1
try {
  New-Item -Path "$ProtocolKey\shell\open\command" -Force | Out-Null
  Set-ItemProperty -Path $ProtocolKey -Name '(default)' -Value 'URL:魅KTV效率助手 立即更新'
  Set-ItemProperty -Path $ProtocolKey -Name 'URL Protocol' -Value ''
  Set-ItemProperty -Path "$ProtocolKey\shell\open\command" -Name '(default)' -Value ('wscript.exe "' + $Vbs + '"')
  Write-Host '已启用插件弹窗里的“立即更新”按钮。'
} catch {
  Write-Host "“立即更新”按钮启用失败（$($_.Exception.Message)），不影响每小时自动更新。" -ForegroundColor Yellow
}

Start-ScheduledTask -TaskName $TaskName
Write-Host ''
Write-Host '已开启自动更新，并已立即检查一次。' -ForegroundColor Green
Write-Host '以后有新版本会自动下载覆盖，插件会在几分钟内自动重新加载；已打开的业务页面刷新后生效。'
Write-Host '更新记录：' (Join-Path $UpdaterDir 'update.log')
