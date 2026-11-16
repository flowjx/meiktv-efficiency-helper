// 禅道测试单名称签名：
// - 提交测试页（m-testtask-create）：名称前自动加当前登录人签名【姓名】，签名不可编辑，只填后面的内容；
// - 编辑测试单页（m-testtask-edit）：名称若以【某人】开头，该签名锁定不可修改，只能改后面的内容；没有签名的老单子保持原样。
// 实现：真正提交的 name 输入框改为 hidden，旁边放一个只填“内容”的输入框，输入时实时把“签名+内容”写回 hidden，
// 这样不管禅道用原生提交还是 ajax 序列化，提交的都是完整名称。
(function () {
  'use strict';

  const body = document.body;
  if (!body) return;
  const isCreate = body.classList.contains('m-testtask-create');
  const isEdit = body.classList.contains('m-testtask-edit');
  if (!isCreate && !isEdit) return;

  const real = document.querySelector('#dataform [name="name"]') || document.querySelector('form [name="name"]');
  if (!real || real.dataset.mkzSign) return;

  const SIGN_RE = /^【([^】]{1,20})】/;

  async function currentUser() {
    const fromNav = document.querySelector('#userNav .user-name')?.textContent.trim();
    if (fromNav) return fromNav;
    // 弹窗（onlybody）里没有顶部导航，用 identity.js 记下的姓名兜底
    try {
      const { identity } = await chrome.storage.local.get('identity');
      return identity?.name || '';
    } catch (_) {
      return '';
    }
  }

  function lockSignature(signature, rest) {
    real.dataset.mkzSign = '1';

    const addon = document.createElement('span');
    addon.className = 'input-group-addon mkz-sign-addon';
    addon.textContent = signature;
    addon.title = '提交人签名，不可修改';

    const proxy = document.createElement('input');
    proxy.type = 'text';
    proxy.className = 'form-control';
    proxy.autocomplete = 'off';
    proxy.required = true; // 只有签名没有内容时，浏览器会拦住提交
    proxy.placeholder = '填写测试单名称（签名会自动加在前面）';
    proxy.value = rest;

    const group = document.createElement('div');
    group.className = 'input-group mkz-sign-group';
    group.append(addon, proxy);

    const sync = () => {
      // 内容里如果又粘贴了一个【xx】开头，去掉，避免出现双签名
      const content = proxy.value.replace(SIGN_RE, '');
      real.value = signature + content;
    };
    proxy.addEventListener('input', sync);
    proxy.addEventListener('change', sync);
    real.form?.addEventListener('submit', sync, true);

    real.type = 'hidden';
    real.parentNode.insertBefore(group, real);
    sync();
  }

  async function init() {
    const value = real.value || '';
    const match = value.match(SIGN_RE);
    if (isEdit) {
      if (!match) return; // 老单子没有签名：不锁定、不补签名
      lockSignature(match[0], value.slice(match[0].length));
      return;
    }
    const user = await currentUser();
    if (!user) return; // 识别不到登录人就不处理，保持禅道原样
    lockSignature(`【${user}】`, match ? value.slice(match[0].length) : value);
  }

  init();
})();
