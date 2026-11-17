(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const current = chrome.runtime.getManifest().version;

  function compareVersion(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  // 磁盘上的 manifest 版本（自动更新已把新文件放好、但插件还没重新加载时，会比运行中的新）
  function readDiskVersion() {
    return fetch(`${chrome.runtime.getURL('manifest.json')}?t=${Date.now()}`, { cache: 'no-store' })
      .then(res => res.json()).then(m => m.version).catch(() => '');
  }

  // 自动更新状态：updater 写在插件目录里的 updater/status.json（没有这个文件 = 还没开启）
  function readAutoStatus() {
    return fetch(`${chrome.runtime.getURL('updater/status.json')}?t=${Date.now()}`, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null)).catch(() => null)
      .then(status => {
        if (!status) return { on: false };
        const last = new Date(String(status.lastRun).replace(' ', 'T'));
        const stale = Number.isFinite(last.getTime()) && Date.now() - last.getTime() > 3 * 3600 * 1000;
        return { on: true, stale, status, lastText: String(status.lastRun || '').slice(5, 16) };
      });
  }

  let auto = { on: false };
  let diskVersion = '';

  function renderAuto(info) {
    const box = $('auto-update');
    const guide = $('au-guide');
    const healthy = auto.on && !auto.stale && auto.status.result !== 'error';
    guide.hidden = healthy;
    guide.open = !healthy;
    if (!auto.on) {
      box.className = 'auto-update is-off';
      box.textContent = '自动更新：未开启';
      return;
    }
    const s = auto.status;
    let text = `自动更新：已开启 · 上次运行 ${auto.lastText}`;
    if (auto.stale) text += '，已超过 3 小时没有运行，可能已被关闭';
    else if (s.result === 'error') text += `，${s.message}`;
    else if (s.result === 'updated') text += `，${s.message}`;
    else if (s.result === 'skipped') text += `，${s.message}`;
    else if (!(info && info.hasUpdate)) text += '，已是最新';
    box.className = `auto-update ${healthy && s.result !== 'skipped' ? 'is-on' : 'is-warn'}`;
    box.textContent = text;
  }

  function render(info) {
    $('current').textContent = current;
    renderAuto(info);
    if (!info) {
      $('state').textContent = '尚未检查';
      return;
    }
    // 远端比当前旧（如自己是开发目录、还没发版）时，最新版本就是当前版本
    $('latest').textContent = info.latest ? (compareVersion(info.latest, current) < 0 ? current : info.latest) : '-';
    $('checked-at').textContent = info.checkedAt ? `上次检查 ${new Date(info.checkedAt).toLocaleString('zh-CN', { hour12: false })}` : '';

    const state = $('state');
    const downloaded = diskVersion && compareVersion(diskVersion, current) > 0;
    if (info.hasUpdate || downloaded) {
      const target = downloaded ? diskVersion : info.latest;
      state.className = 'state is-new';
      state.textContent = `有新版本 ${target}${info.date && !downloaded ? `（${info.date}）` : ''}`;
      $('update').hidden = false;
      $('notes-title').textContent = info.notes && info.notes.length ? '更新内容：' : '';
      const ul = $('notes');
      ul.innerHTML = '';
      (info.notes || []).forEach(n => {
        const li = document.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });

      const note = $('auto-note');
      if (downloaded) {
        // 新文件已经在磁盘上（自动更新或 git pull 已完成），只差重新加载
        note.hidden = false;
        note.textContent = `新版本 ${diskVersion} 已下载好，几分钟内会自动生效，也可以点下面按钮立即生效。`;
        $('reload-now').hidden = false;
        $('manual').hidden = true;
      } else if (auto.on && !auto.stale && auto.status.result !== 'error' && auto.status.result !== 'skipped') {
        note.hidden = false;
        note.textContent = '已开启自动更新，1 小时内会自动安装新版本，无需任何操作。';
        $('reload-now').hidden = true;
        $('manual').hidden = true;
      } else {
        note.hidden = true;
        $('reload-now').hidden = true;
        $('manual').hidden = false;
        document.querySelectorAll('.download').forEach(a => { a.href = UPDATE_CONFIG.zipUrl; });
      }
    } else {
      $('update').hidden = true;
      state.className = info.error ? 'state is-error' : 'state is-ok';
      state.textContent = info.error ? `检查失败：${info.error}`
        : '已是最新版本';
    }
  }

  Promise.all([chrome.storage.local.get('update'), readAutoStatus(), readDiskVersion()])
    .then(([{ update }, a, disk]) => {
      auto = a;
      diskVersion = disk;
      render(update);
    });

  // 打开本插件的详情页（能看到插件目录路径）；Edge 用 edge://，Chrome 用 chrome://
  $('open-details').addEventListener('click', e => {
    e.preventDefault();
    const scheme = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
    chrome.tabs.create({ url: `${scheme}://extensions/?id=${chrome.runtime.id}` });
    window.close();
  });

  $('check').addEventListener('click', () => {
    $('state').className = 'state';
    $('state').textContent = '检查中…';
    chrome.runtime.sendMessage({ type: 'meiktv-check-update' }).then(render);
  });

  const reload = () => {
    chrome.runtime.sendMessage({ type: 'meiktv-reload' });
    window.close();
  };
  $('reload').addEventListener('click', reload);
  $('reload-now').addEventListener('click', reload);
})();
