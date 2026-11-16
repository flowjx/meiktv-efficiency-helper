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
      $('download').href = info.download || UPDATE_CONFIG.zipUrl;
    } else {
      $('update').hidden = true;
      state.className = info.error ? 'state is-error' : 'state is-ok';
      state.textContent = info.error ? `检查失败：${info.error}` : '已是最新版本';
    }
  }

  chrome.storage.local.get('update').then(({ update }) => render(update));

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
