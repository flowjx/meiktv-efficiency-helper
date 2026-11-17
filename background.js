// 后台 service worker：定时检查 version.json（先 GitHub，连不上再走内网服务），有新版时给工具栏图标加角标，
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

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPDATE_CONFIG.fetchTimeoutMs || 8000);
  try {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '连接超时' : (e.message || '连接失败'));
  } finally {
    clearTimeout(timer);
  }
}

// 先 GitHub，失败再内网；返回 { remote, source, download }
async function fetchLatest() {
  const errors = [];
  try {
    const remote = await fetchJson(UPDATE_CONFIG.versionUrl);
    return { remote, source: 'github', download: remote.download || UPDATE_CONFIG.zipUrl };
  } catch (e) {
    errors.push(`GitHub：${e.message}`);
  }
  if (UPDATE_CONFIG.intranetVersionUrl) {
    try {
      const remote = await fetchJson(UPDATE_CONFIG.intranetVersionUrl);
      return { remote, source: 'intranet', download: UPDATE_CONFIG.intranetZipUrl };
    } catch (e) {
      errors.push(`内网：${e.message}`);
    }
  }
  throw new Error(errors.join('；'));
}

async function checkUpdate() {
  const current = chrome.runtime.getManifest().version;
  const result = { current, checkedAt: Date.now() };
  try {
    const { remote, source, download } = await fetchLatest();
    Object.assign(result, {
      latest: String(remote.version || ''),
      date: remote.date || '',
      notes: Array.isArray(remote.notes) ? remote.notes : [],
      download,
      source,
      hasUpdate: compareVersion(remote.version, current) > 0,
      error: ''
    });
  } catch (e) {
    const { update: old } = await chrome.storage.local.get('update');
    // 两个来源都失败时保留上次结果，只记录错误
    Object.assign(result, old || {}, { current, checkedAt: Date.now(), error: e.message || '检查失败' });
    if (old && compareVersion(old.latest, current) <= 0) result.hasUpdate = false;
  }
  await chrome.storage.local.set({ update: result });
  await setBadge(Boolean(result.hasUpdate));
  return result;
}

// ---------- 安装明细上报 ----------
// 上报内容：随机安装ID、插件版本、浏览器、系统，以及在禅道页面识别到的姓名/部门/职位（identity.js 提供）。
async function getClientId() {
  const { clientId } = await chrome.storage.local.get('clientId');
  if (clientId) return clientId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ clientId: id });
  return id;
}

function browserInfo() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const pick = brands.find(b => /Edge/i.test(b.brand)) || brands.find(b => /Chrome/i.test(b.brand) && !/Chromium/i.test(b.brand))
    || brands.find(b => !/Not.?A.?Brand/i.test(b.brand));
  const browser = pick ? `${pick.brand.replace('Microsoft ', '').replace('Google ', '')} ${pick.version}` : (navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/) || [''])[0];
  const os = (navigator.userAgentData && navigator.userAgentData.platform) || (navigator.userAgent.match(/Windows|Mac OS X|Linux/) || [''])[0];
  return { browser, os };
}

async function report(force) {
  if (!UPDATE_CONFIG.reportUrl) return;
  const { lastReportAt = 0, identity = {} } = await chrome.storage.local.get(['lastReportAt', 'identity']);
  if (!force && Date.now() - lastReportAt < UPDATE_CONFIG.reportIntervalMinutes * 60000) return;
  const body = {
    client_id: await getClientId(),
    version: chrome.runtime.getManifest().version,
    name: identity.name || '', dept: identity.dept || '', role: identity.role || '',
    ...browserInfo()
  };
  try {
    const res = await fetch(UPDATE_CONFIG.reportUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store'
    });
    if (res.ok) await chrome.storage.local.set({ lastReportAt: Date.now(), lastReportError: '' });
    else await chrome.storage.local.set({ lastReportError: `HTTP ${res.status}` });
  } catch (e) {
    // 不在公司网络时连不上很正常，下次再报
    await chrome.storage.local.set({ lastReportError: e.message || '连接失败' });
  }
}

// ---------- 分组 / 默认抄送名单（从内网上报服务拉取，存 chrome.storage.local.teamConfig） ----------
async function fetchTeamConfig() {
  if (!UPDATE_CONFIG.teamConfigUrl) return;
  try {
    const res = await fetch(`${UPDATE_CONFIG.teamConfigUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await chrome.storage.local.set({
      teamConfig: { groups: data.groups || {}, mailto: data.mailto || [], at: Date.now() },
      teamConfigError: ''
    });
  } catch (e) {
    // 不在公司网络时拉不到，保留上次的配置
    await chrome.storage.local.set({ teamConfigError: e.message || '连接失败' });
  }
}

async function onIdentity(identity) {
  const { identity: old = {} } = await chrome.storage.local.get('identity');
  const changed = ['name', 'dept', 'role'].some(k => (identity[k] || '') !== (old[k] || ''));
  await chrome.storage.local.set({ identity: { ...old, ...identity, at: Date.now() } });
  await report(changed);
}

// ---------- 自动更新配合：磁盘上的文件被 updater 换成新版后，自动重新加载 ----------
// 已解压安装的插件读取的是磁盘上的实时文件：比较磁盘 manifest.json 与正在运行的版本，磁盘更新就 reload。
// updater 会最后才覆盖 manifest.json，所以版本号变了说明其他文件已经复制完。
const DISK_ALARM = 'meiktv-disk-check';

async function checkDiskVersion() {
  try {
    const res = await fetch(`${chrome.runtime.getURL('manifest.json')}?t=${Date.now()}`, { cache: 'no-store' });
    const disk = (await res.json()).version;
    const running = chrome.runtime.getManifest().version;
    if (compareVersion(disk, running) > 0) {
      console.info(`[效率助手] 磁盘上已是 ${disk}（运行中 ${running}），自动重新加载`);
      chrome.runtime.reload();
    }
  } catch (_) { /* 读不到就下次再看 */ }
}

function ensureAlarms() {
  chrome.alarms.create(ALARM, { periodInMinutes: UPDATE_CONFIG.checkIntervalMinutes });
  chrome.alarms.create(DISK_ALARM, { periodInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  checkUpdate();
  report(true);
  fetchTeamConfig();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  checkDiskVersion();
  checkUpdate();
  report(false);
  fetchTeamConfig();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) {
    checkUpdate();
    report(false);
    fetchTeamConfig();
  } else if (alarm.name === DISK_ALARM) {
    checkDiskVersion();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'meiktv-team-config') {
    fetchTeamConfig().then(() => chrome.storage.local.get('teamConfig')).then(({ teamConfig }) => sendResponse(teamConfig || null));
    return true;
  }
  if (msg && msg.type === 'meiktv-identity' && msg.identity) {
    onIdentity(msg.identity).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg && msg.type === 'meiktv-check-update') {
    checkUpdate().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'meiktv-reload') {
    chrome.runtime.reload();
  }
  return false;
});
