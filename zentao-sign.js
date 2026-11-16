// 禅道测试单 提交 / 编辑 页的小调整（隔离环境 content script）：
// - 提交测试页（m-testtask-create）：
//     · “负责人”文案改为“测试负责人”；
//     · 把默认抄送名单（来自内网上报服务的 teamConfig.mailto）写到 <html data-mkz-mailto>，
//       由 zentao-create-main.js（页面环境）读取并选中——页面环境脚本用不了 chrome.storage。
//   （2026-11-16 起不再在名称前固定加【当前用户】签名，提测人改由列表“提测人员”列显示。）
// - 编辑测试单页（m-testtask-edit）：名称若以【某人】开头（历史数据），该签名锁定不可修改，只能改后面的内容。
(function () {
  'use strict';

  const body = document.body;
  if (!body) return;
  const isCreate = body.classList.contains('m-testtask-create');
  const isEdit = body.classList.contains('m-testtask-edit');
  if (!isCreate && !isEdit) return;

  const SIGN_RE = /^【([^】]{1,20})】/;

  // ---------- 提交测试页 ----------
  if (isCreate) {
    document.querySelectorAll('#dataform th').forEach(th => {
      if (th.textContent.trim() === '负责人') th.textContent = '测试负责人';
    });
    chrome.storage.local.get('teamConfig').then(({ teamConfig }) => {
      document.documentElement.dataset.mkzMailto = JSON.stringify((teamConfig && teamConfig.mailto) || []);
    }).catch(() => {
      document.documentElement.dataset.mkzMailto = '[]';
    });
    blockAdminSubmit();
    return;
  }

  // admin 账号不能提交测试单：按禅道“个人资料”里的用户名判断（只比较是否为 admin，不保存账号）
  async function currentAccount() {
    const html = await (await fetch('/index.php?m=my&f=profile&onlybody=yes', { credentials: 'include' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const row = Array.from(doc.querySelectorAll('table tr')).find(tr => tr.querySelector('th')?.textContent.trim() === '用户名');
    return row?.querySelector('td')?.textContent.trim() || '';
  }

  async function blockAdminSubmit() {
    let account = '';
    try { account = await currentAccount(); } catch (_) { return; }
    if (account.toLowerCase() !== 'admin') return;

    const MESSAGE = 'admin 账号不能提交测试单，请用自己的账号提交';
    const form = document.getElementById('dataform');
    if (!form) return;
    const banner = document.createElement('div');
    banner.className = 'mkz-admin-block';
    banner.textContent = `⚠ ${MESSAGE}`;
    form.prepend(banner);
    // 按钮不禁用（禁用后点击没有任何反应），点击时弹出提示
    const submitBtn = form.querySelector('#submit, button[type="submit"]');
    if (submitBtn) submitBtn.title = MESSAGE;
    // 捕获阶段拦截：既阻止原生提交，也不让禅道自己的提交处理执行
    const stop = e => {
      if (e.type === 'click' && !e.target.closest('#submit, button[type="submit"], input[type="submit"]')) return;
      if (e.type === 'submit' && e.target !== form) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.alert(MESSAGE);
    };
    window.addEventListener('submit', stop, true);
    window.addEventListener('click', stop, true);
  }

  // ---------- 编辑测试单页：锁定已有签名 ----------
  const real = document.querySelector('#dataform [name="name"]') || document.querySelector('form [name="name"]');
  if (!real || real.dataset.mkzSign) return;
  const match = (real.value || '').match(SIGN_RE);
  if (!match) return; // 没有签名：保持原样

  const signature = match[0];
  real.dataset.mkzSign = '1';
  const addon = document.createElement('span');
  addon.className = 'input-group-addon mkz-sign-addon';
  addon.textContent = signature;
  addon.title = '提交人签名，不可修改';
  const proxy = document.createElement('input');
  proxy.type = 'text';
  proxy.className = 'form-control';
  proxy.autocomplete = 'off';
  proxy.required = true;
  proxy.value = real.value.slice(signature.length);
  const group = document.createElement('div');
  group.className = 'input-group mkz-sign-group';
  group.append(addon, proxy);
  const sync = () => { real.value = signature + proxy.value.replace(SIGN_RE, ''); };
  proxy.addEventListener('input', sync);
  proxy.addEventListener('change', sync);
  real.form?.addEventListener('submit', sync, true);
  real.type = 'hidden';
  real.parentNode.insertBefore(group, real);
  sync();
})();
