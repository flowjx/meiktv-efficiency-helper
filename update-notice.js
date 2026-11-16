// 页面内的新版本提示条：读取 background.js 写入的 chrome.storage.local.update，
// 有新版且用户没对该版本点过"知道了"时，在页面左下角显示一次。只在顶层页面显示，避免 iframe 里重复。
(function () {
  'use strict';
  if (window.top !== window || !chrome?.storage?.local) return;

  const ID = 'meiktv-update-notice';

  function show(update) {
    if (document.getElementById(ID)) return;
    const box = document.createElement('div');
    box.id = ID;
    box.style.cssText = [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483646', 'max-width:320px',
      'padding:10px 12px', 'border-radius:8px', 'background:#1f2329', 'color:#fff',
      'font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif', 'box-shadow:0 6px 20px rgba(0,0,0,.25)'
    ].join(';');

    const title = document.createElement('div');
    title.style.fontWeight = 'bold';
    title.textContent = `魅KTV效率助手有新版本 ${update.latest}`;
    const desc = document.createElement('div');
    desc.style.cssText = 'color:#c9cdd4;font-size:12px';
    desc.textContent = (update.notes && update.notes[0]) ? `${update.notes[0]}${update.notes.length > 1 ? ' 等' : ''}` : '';
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:4px;font-size:12px;color:#c9cdd4';
    hint.textContent = '点浏览器工具栏的插件图标查看更新步骤。';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '知道了';
    btn.style.cssText = 'margin-top:6px;padding:2px 10px;border:0;border-radius:4px;background:#e8336d;color:#fff;cursor:pointer;font:inherit';
    btn.addEventListener('click', () => {
      chrome.storage.local.set({ dismissedUpdate: update.latest });
      box.remove();
    });

    box.append(title, desc, hint, btn);
    (document.body || document.documentElement).appendChild(box);
  }

  chrome.storage.local.get(['update', 'dismissedUpdate']).then(({ update, dismissedUpdate }) => {
    if (update && update.hasUpdate && update.latest && update.latest !== dismissedUpdate) show(update);
  }).catch(() => { /* 插件刚被重新加载时旧页面里的脚本会失效，忽略 */ });
})();
