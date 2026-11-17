# 魅KTV效率助手 —— 自动更新（由定时任务每小时调用，也可手动运行）
# 流程：读本地 manifest 版本 → 从公司内网更新服务查最新版本 → 有新版则：
#   · 插件目录是 git 仓库（开发目录）：跳过，不用 zip 覆盖 git 仓库；
#   · 否则下载 zip → 校验 zip 内版本 → 覆盖插件目录（manifest.json 最后覆盖，插件据此自动重新加载）。
# 结果写 updater\status.json（插件弹窗读取），日志写 updater\update.log。
param(
  [switch]$DryRun           # 只检查不更新
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$UpdaterDir = $PSScriptRoot
$PluginDir = Split-Path -Parent $UpdaterDir
$LogFile = Join-Path $UpdaterDir 'update.log'
$StatusFile = Join-Path $UpdaterDir 'status.json'

function Write-Log([string]$msg) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch { }
  Write-Output $line
}

function Save-Status([string]$result, [string]$message, $remote) {
  $status = [ordered]@{
    lastRun       = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    result        = $result          # updated / latest / skipped / error / dryrun
    message       = $message
    localVersion  = (Get-LocalVersion)
    remoteVersion = if ($remote) { $remote.version } else { '' }
    source        = if ($remote) { $remote.source } else { '' }
    protocol      = (Test-Path 'HKCU:\Software\Classes\meiktv-helper-update\shell\open\command')   # 弹窗据此显示“立即更新”按钮
  }
  try {
    [IO.File]::WriteAllText($StatusFile, ($status | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  } catch { }
}

function Get-LocalVersion {
  $text = [IO.File]::ReadAllText((Join-Path $PluginDir 'manifest.json'), [Text.Encoding]::UTF8)
  return ($text | ConvertFrom-Json).version
}

# 从 update-config.js 读地址，保证地址只在一处配置
function Get-UpdateConfig {
  $js = [IO.File]::ReadAllText((Join-Path $PluginDir 'update-config.js'), [Text.Encoding]::UTF8)
  $get = { param($key) if ($js -match "$key\s*:\s*'([^']+)'") { $Matches[1] } else { '' } }
  $cfg = [ordered]@{ versionUrl = (& $get 'versionUrl'); zipUrl = (& $get 'zipUrl') }
  if (-not $cfg.versionUrl -or -not $cfg.zipUrl) { throw 'update-config.js 里没有 versionUrl / zipUrl' }
  return $cfg
}

function Get-Json([string]$url) {
  $sep = if ($url.Contains('?')) { '&' } else { '?' }
  $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Uri "$url$($sep)t=$([DateTimeOffset]::Now.ToUnixTimeSeconds())"
  $bytes = $resp.RawContentStream.ToArray()
  return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
}

function Get-Remote($cfg) {
  try {
    $j = Get-Json $cfg.versionUrl
  } catch {
    throw "连不上公司内网更新服务（$($_.Exception.Message)）"
  }
  return [ordered]@{ version = [string]$j.version; zip = $cfg.zipUrl; source = 'intranet' }
}

function Test-Newer([string]$remote, [string]$local) {
  try { return ([version]$remote) -gt ([version]$local) } catch { return $false }
}

# ---------- 防止并发运行 ----------
$lockPath = Join-Path $env:TEMP 'meiktv-helper-autoupdate.lock'
try {
  $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch {
  Write-Output '另一个更新进程正在运行，本次跳过'
  exit 0
}

try {
  if ((Test-Path $LogFile) -and (Get-Item $LogFile).Length -gt 1MB) {
    Move-Item $LogFile "$LogFile.1" -Force
  }

  $local = Get-LocalVersion
  $cfg = Get-UpdateConfig
  try {
    $remote = Get-Remote $cfg
  } catch {
    Write-Log "检查失败（当前 $local）：$($_.Exception.Message)"
    Save-Status 'error' "检查失败：$($_.Exception.Message)" $null
    exit 0
  }

  if (-not (Test-Newer $remote.version $local)) {
    Save-Status 'latest' "已是最新版本" $remote
    exit 0
  }

  Write-Log "发现新版本 $($remote.version)（当前 $local）"
  if ($DryRun) {
    Save-Status 'dryrun' "发现新版本 $($remote.version)（仅检查，未更新）" $remote
    exit 0
  }

  # ---------- git 安装（开发目录）：不自动更新，避免 zip 覆盖 git 仓库 ----------
  if (Test-Path (Join-Path $PluginDir '.git')) {
    Write-Log '插件目录是 git 仓库（开发目录），跳过自动更新'
    Save-Status 'skipped' '插件目录是 git 仓库（开发目录），不自动更新' $remote
    exit 0
  }

  # ---------- zip 安装：下载 → 校验 → 覆盖 ----------
  $work = Join-Path $env:TEMP ("meiktv-helper-update-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $work | Out-Null
  try {
    $zip = Join-Path $work 'plugin.zip'
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri $remote.zip -OutFile $zip
    $extract = Join-Path $work 'x'
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    $manifest = Get-ChildItem -Path $extract -Recurse -Filter 'manifest.json' | Sort-Object { $_.FullName.Length } | Select-Object -First 1
    if (-not $manifest) { throw 'zip 里没有 manifest.json' }
    $src = $manifest.DirectoryName
    $zipVersion = ([IO.File]::ReadAllText($manifest.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json).version
    if ($zipVersion -ne $remote.version) { throw "zip 版本 $zipVersion 与 version.json 的 $($remote.version) 不一致" }

    # 先复制除 manifest.json 外的所有文件（不删除本地多出来的文件），最后复制 manifest.json
    & robocopy $src $PluginDir /E /XF manifest.json /XD .git /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "复制文件失败（robocopy 返回 $LASTEXITCODE）" }
    Copy-Item -Path $manifest.FullName -Destination (Join-Path $PluginDir 'manifest.json') -Force

    Write-Log "已更新到 $zipVersion"
    Save-Status 'updated' "已自动更新到 $zipVersion" $remote
  } catch {
    Write-Log "更新失败：$($_.Exception.Message)"
    Save-Status 'error' "更新失败：$($_.Exception.Message)" $remote
  } finally {
    Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
  }
} finally {
  $lock.Close()
  Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
}
