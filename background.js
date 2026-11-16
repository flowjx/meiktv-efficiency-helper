// 后台 service worker：定时检查 GitHub 仓库里的 version.json，有新版时给工具栏图标加角标，
// 并把结果写进 chrome.storage.local.update，供弹窗和页面提示条读取。
importScripts('update-config.js');

const ALARM = 'meiktv-check-update';

function compareVersion(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function setBadge(hasUpdate) {
  await chrome.action.setBadgeText({ text: hasUpdate ? '新' : '' });
  if (hasUpdate) await chrome.action.setBadgeBackgroundColor({ color: '#e5484d' });
  await chrome.action.setTitle({ title: hasUpdate ? '魅KTV效率助手：有新版本，点击查看' : '魅KTV效率助手' });
}

async function checkUpdate() {
  const current = chrome.runtime.getManifest().version;
  const result = { current, checkedAt: Date.now() };
  try {
    const res = await fetch(`${UPDATE_CONFIG.versionUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const remote = await res.json();
    Object.assign(result, {
      latest: String(remote.version || ''),
      date: remote.date || '',
      notes: Array.isArray(remote.notes) ? remote.notes : [],
      download: remote.download || UPDATE_CONFIG.zipUrl,
      hasUpdate: compareVersion(remote.version, current) > 0,
      error: ''
    });
  } catch (e) {
    const { update: old } = await chrome.storage.local.get('update');
    // 网络失败时保留上次结果，只记录错误
    Object.assign(result, old || {}, { current, checkedAt: Date.now(), error: e.message || '检查失败' });
    if (old && compareVersion(old.latest, current) <= 0) result.hasUpdate = false;
  }
  await chrome.storage.local.set({ update: result });
  await setBadge(Boolean(result.hasUpdate));
  return result;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: UPDATE_CONFIG.checkIntervalMinutes });
  checkUpdate();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM, { periodInMinutes: UPDATE_CONFIG.checkIntervalMinutes });
  checkUpdate();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) checkUpdate();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'meiktv-check-update') {
    checkUpdate().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'meiktv-reload') {
    chrome.runtime.reload();
  }
  return false;
});
