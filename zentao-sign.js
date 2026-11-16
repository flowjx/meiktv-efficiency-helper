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
    return;
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
