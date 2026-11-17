// 在线更新配置（background.js、popup.js、updater/auto-update.ps1 共用）。
// version.json 放在仓库根目录，发版时由 scripts/bump_version.py 和 manifest.json 一起改。
const UPDATE_CONFIG = {
  // 更新只走公司内网（server/install_server.py 提供，内容是本地仓库 release 分支 = 已发布版本）。
  // updater/auto-update.ps1 也从这里读这两个地址，改地址时同步改 manifest.json 的 host_permissions。
  versionUrl: 'http://172.16.5.36:8790/update/version.json',
  zipUrl: 'http://172.16.5.36:8790/update/plugin.zip',
  checkIntervalMinutes: 60,
  fetchTimeoutMs: 8000,
  // 安装明细上报（server/install_server.py）。改地址时同步改 manifest.json 的 host_permissions。
  reportUrl: 'http://172.16.5.36:8790/api/ping',
  // 分组和默认抄送名单（只存在上报服务的本地配置里，不进公开仓库）
  teamConfigUrl: 'http://172.16.5.36:8790/api/team-config',
  reportIntervalMinutes: 60
};
