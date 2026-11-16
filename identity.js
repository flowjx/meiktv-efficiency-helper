// 在禅道（bug.meiktv.com）识别当前登录人，交给 background.js 用于安装明细上报。
// 只取 真实姓名 / 所属部门 / 职位；不取用户名（是手机号）、邮箱等其他字段。每天最多拉一次个人资料页。
(function () {
  'use strict';
  if (window.top !== window || !chrome?.runtime?.id) return;

  const nameNode = document.querySelector('#userNav .user-name');
  const name = nameNode ? nameNode.textContent.trim() : '';
  if (!name) return; // 未登录（登录页）不处理

  const DAY = 24 * 3600 * 1000;

  async function fetchProfile() {
    const res = await fetch('/index.php?m=my&f=profile&onlybody=yes', { credentials: 'include' });
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const info = {};
    doc.querySelectorAll('table tr').forEach(tr => {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (!th || !td) return;
      const label = th.textContent.trim();
      const value = td.textContent.replace(/\s+/g, ' ').trim();
      if (label === '所属部门') info.dept = value.replace(/^\/+/, '');
      if (label === '职位') info.role = value;
    });
    return info;
  }

  chrome.storage.local.get('identity').then(async ({ identity }) => {
    if (identity && identity.name === name && identity.at && Date.now() - identity.at < DAY) return;
    let extra = {};
    try { extra = await fetchProfile(); } catch (_) { /* 拿不到部门职位也照样上报姓名 */ }
    chrome.runtime.sendMessage({ type: 'meiktv-identity', identity: { name, ...extra } });
  }).catch(() => { /* 插件重新加载后旧页面里的脚本失效，忽略 */ });
})();
