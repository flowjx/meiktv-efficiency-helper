// 在线更新配置：改仓库只需要改这里（background.js 和 popup.js 共用）。
// version.json 放在仓库根目录，发版时由 scripts/bump_version.py 和 manifest.json 一起改。
const UPDATE_CONFIG = {
  repo: 'flowjx/meiktv-efficiency-helper',
  branch: 'main',
  get versionUrl() { return `https://raw.githubusercontent.com/${this.repo}/${this.branch}/version.json`; },
  get repoUrl() { return `https://github.com/${this.repo}`; },
  get zipUrl() { return `https://github.com/${this.repo}/archive/refs/heads/${this.branch}.zip`; },
  checkIntervalMinutes: 60,
  // 安装明细上报（server/install_server.py）。改地址时同步改 manifest.json 的 host_permissions。
  reportUrl: 'http://172.16.5.36:8790/api/ping',
  reportIntervalMinutes: 60
};
