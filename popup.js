(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  function render(info) {
    const current = chrome.runtime.getManifest().version;
    $('current').textContent = current;
    if (!info) {
      $('state').textContent = '尚未检查';
      return;
    }
    $('latest').textContent = info.latest || '-';
    $('checked-at').textContent = info.checkedAt ? `上次检查 ${new Date(info.checkedAt).toLocaleString('zh-CN', { hour12: false })}` : '';

    const state = $('state');
    if (info.hasUpdate) {
      state.className = 'state is-new';
      state.textContent = `有新版本 ${info.latest}${info.date ? `（${info.date}）` : ''}`;
      $('update').hidden = false;
      $('notes-title').textContent = info.notes && info.notes.length ? '更新内容：' : '';
      const ul = $('notes');
      ul.innerHTML = '';
      (info.notes || []).forEach(n => {
        const li = document.createElement('li');
        li.textContent = n;
        ul.appendChild(li);
      });
      const intranet = info.source === 'intranet';
      $('step-github').hidden = intranet;
      $('step-intranet').hidden = !intranet;
      document.querySelectorAll('.download').forEach(a => { a.href = info.download || UPDATE_CONFIG.zipUrl; });
      $('source').textContent = intranet ? '来源：公司内网（GitHub 不可用时的备用通道）' : '来源：GitHub';
    } else {
      $('update').hidden = true;
      state.className = info.error ? 'state is-error' : 'state is-ok';
      state.textContent = info.error ? `检查失败：${info.error}`
        : `已是最新版本${info.source === 'intranet' ? '（通过公司内网检查）' : ''}`;
    }
  }

  chrome.storage.local.get('update').then(({ update }) => render(update));

  // 自动更新状态：读 updater 写在插件目录里的 updater/status.json（没有这个文件 = 还没开启）
  fetch(`${chrome.runtime.getURL('updater/status.json')}?t=${Date.now()}`, { cache: 'no-store' })
    .then(res => (res.ok ? res.json() : null))
    .catch(() => null)
    .then(status => {
      const box = $('auto-update');
      if (!status) {
        box.className = 'auto-update is-off';
        box.textContent = '自动更新：未开启。在插件目录双击“安装自动更新.bat”即可开启，以后无需手动更新。';
        return;
      }
      const last = new Date(String(status.lastRun).replace(' ', 'T'));
      const stale = Number.isFinite(last.getTime()) && Date.now() - last.getTime() > 3 * 3600 * 1000;
      box.className = `auto-update ${stale || status.result === 'error' ? 'is-warn' : 'is-on'}`;
      box.textContent = `自动更新：已开启 · 上次 ${status.lastRun}：${status.message}`
        + (stale ? '（超过 3 小时没有运行，可能已被关闭）' : '');
    });

  $('check').addEventListener('click', () => {
    $('state').className = 'state';
    $('state').textContent = '检查中…';
    chrome.runtime.sendMessage({ type: 'meiktv-check-update' }).then(render);
  });

  $('reload').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'meiktv-reload' });
    window.close();
  });
})();
