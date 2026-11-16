// 禅道“提交测试”页默认值（运行在页面自身环境 world: MAIN，才能操作禅道的 jQuery / chosen 下拉组件）：
// 1) 所属项目默认“测试计划跟进”（projectID 136）且锁定不可改；
// 2) 版本下拉旁加“新建版本”（本页弹窗填写，提交禅道原生“创建版本”表单）和“刷新”，建好后自动刷新并选中新版本；
// 3) 抄送人默认加上固定名单（按禅道里的显示姓名匹配，不写账号）。
// 注意：MAIN world 脚本不能用 chrome.* 接口；改配置直接改下面的常量。
(function () {
  'use strict';

  const PROJECT_ID = '136'; // 测试计划跟进
  const BUILD_CREATE_URL = `/index.php?m=build&f=create&project=${PROJECT_ID}&onlybody=yes`;
  const DEFAULT_MAILTO = ['蒋晓华', '王彦春', '谭兴春', '刘守铜', '郭帅兵', '丁萍花'];
  const LOG = '[禅道提交测试助手]';

  if (!document.body || !document.body.classList.contains('m-testtask-create')) return;

  function whenReady(check, fn, timeout = 5000) {
    const start = Date.now();
    (function poll() {
      if (check()) return fn();
      if (Date.now() - start > timeout) return console.warn(LOG, '等待页面组件超时，跳过默认值设置');
      setTimeout(poll, 100);
    })();
  }

  const $ = () => window.jQuery;

  // ---------- 1. 所属项目：默认并锁定 ----------
  function lockProject() {
    const select = document.getElementById('project');
    if (!select || select.dataset.mkzLocked) return;
    if (!Array.from(select.options).some(o => o.value === PROJECT_ID)) {
      console.warn(LOG, `项目下拉里没有 ${PROJECT_ID}，不锁定`);
      return;
    }
    select.dataset.mkzLocked = '1';
    if (select.value !== PROJECT_ID) {
      $()(select).val(PROJECT_ID).trigger('change'); // 触发禅道自己的 loadProjectRelated，重新加载该项目的版本
    }
    // 禁用的 select 不会提交，用同名隐藏字段带上项目 ID
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'project';
    hidden.value = PROJECT_ID;
    select.after(hidden);
    $()(select).prop('disabled', true).trigger('chosen:updated');
    const chosen = document.getElementById('project_chosen');
    if (chosen) chosen.title = '所属项目固定为“测试计划跟进”（效率助手）';
  }

  // ---------- 2. 版本：新建（本页弹窗） / 刷新 ----------
  function buildIds() {
    const select = document.getElementById('build');
    return select ? Array.from(select.options).map(o => o.value).filter(Boolean) : [];
  }

  // 重新加载版本下拉；selectName 有值时，加载完选中同名版本。返回是否成功
  function refreshBuilds(selectName) {
    return new Promise(resolve => {
      const box = document.getElementById('buildBox');
      if (!box || typeof window.loadProjectBuilds !== 'function') return resolve(false);
      const observer = new MutationObserver(() => {
        const select = document.getElementById('build');
        if (!select) return;
        observer.disconnect();
        if (!selectName) return resolve(true);
        const option = Array.from(select.options).find(o => o.text.trim() === selectName);
        if (!option) return resolve(false);
        setTimeout(() => {
          $()('#build').val(option.value).trigger('chosen:updated').trigger('change');
          resolve(true);
        }, 50);
      });
      observer.observe(box, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, 10000);
      window.loadProjectBuilds(PROJECT_ID);
    });
  }

  function todayCompact() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }

  function todayDash() {
    const t = todayCompact();
    return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6)}`;
  }

  function textToHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\r?\n/g, '<br />');
  }

  // 读取禅道“创建版本”表单的默认值（产品、构建者等），只替换名称、日期、描述后提交
  async function createBuild(name, date, desc) {
    const html = await (await fetch(BUILD_CREATE_URL, { credentials: 'include' })).text();
    if (/m=user&f=deny/.test(html)) throw new Error('没有创建版本的权限');
    if (/m=user&f=login/.test(html)) throw new Error('禅道登录已过期，请刷新页面重新登录');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('[name="name"]'));
    if (!form) throw new Error('没找到禅道的创建版本表单，页面可能改版了');
    const data = new FormData();
    Array.from(form.elements).forEach(field => {
      if (!field.name || field.disabled) return;
      const type = (field.type || '').toLowerCase();
      if (['button', 'submit', 'reset', 'file', 'image'].includes(type)) return;
      if ((type === 'checkbox' || type === 'radio') && !field.checked) return;
      if (field.tagName === 'SELECT') {
        Array.from(field.options).filter(o => o.selected).forEach(o => data.append(field.name, o.value));
        return;
      }
      data.append(field.name, field.value);
    });
    data.set('name', name);
    data.set('date', date);
    data.set('desc', desc ? textToHtml(desc) : '');
    const res = await fetch(BUILD_CREATE_URL, { method: 'POST', credentials: 'include', body: data });
    const reply = await res.text();
    // 禅道成功时也会 alert('保存成功')，所以不能凭 alert 判断；以版本列表里是否出现该版本为准
    if (await refreshBuilds(name)) return;
    const alertMsg = (reply.match(/alert\((['"])([\s\S]*?)\1\)/) || [])[2];
    throw new Error(alertMsg ? alertMsg.replace(/\\n/g, ' ').slice(0, 200) : '提交后版本列表里没找到这个版本，请到版本页确认是否创建成功');
  }

  function openBuildDialog() {
    document.getElementById('mkz-build-dialog')?.remove();
    const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
    const field = (label, input) => {
      const row = make('label', { className: 'mkz-dialog__field' });
      row.append(make('span', { textContent: label }), input);
      return row;
    };
    const nameInput = make('input', { className: 'form-control', value: todayCompact(), placeholder: '版本名称编号，如 20261116' });
    const dateInput = make('input', { type: 'date', className: 'form-control', value: todayDash() });
    const descInput = make('textarea', { className: 'form-control', rows: 3, placeholder: '可选' });
    const status = make('div', { className: 'mkz-follow__status' });
    const cancel = make('button', { type: 'button', className: 'btn btn-sm', textContent: '取消' });
    const submit = make('button', { type: 'button', className: 'btn btn-primary btn-sm', textContent: '创建并选中' });
    const actions = make('div', { className: 'mkz-follow__actions' });
    actions.append(cancel, submit);
    const card = make('div', { className: 'mkz-follow__card' });
    card.append(
      make('div', { className: 'mkz-follow__title', textContent: '新建版本（测试计划跟进）' }),
      field('名称编号', nameInput), field('打包日期', dateInput), field('描述', descInput),
      make('div', { className: 'mkz-follow__hint', textContent: '构建者默认为你本人，其他项沿用禅道默认值。创建后自动选中，本页已填写的内容不受影响。' }),
      status, actions
    );
    const overlay = make('div', { id: 'mkz-build-dialog', className: 'mkz-follow' });
    overlay.append(card);

    const inputs = [submit, nameInput, dateInput, descInput];
    const close = () => overlay.remove();
    const fail = msg => { status.className = 'mkz-follow__status is-error'; status.textContent = msg; };
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    const doSubmit = async () => {
      const name = nameInput.value.trim();
      if (!name) { fail('请填写名称编号'); nameInput.focus(); return; }
      const exists = Array.from(document.getElementById('build')?.options || []).some(o => o.text.trim() === name);
      if (exists) { fail(`版本“${name}”已存在，可直接在下拉里选择`); return; }
      inputs.forEach(el => { el.disabled = true; });
      status.className = 'mkz-follow__status';
      status.textContent = '创建中…';
      try {
        await createBuild(name, dateInput.value || todayDash(), descInput.value.trim());
        close();
      } catch (e) {
        fail(`创建失败：${e.message || e}`);
        inputs.forEach(el => { el.disabled = false; });
      }
    };
    submit.addEventListener('click', doSubmit);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSubmit(); } });
    document.body.append(overlay);
    nameInput.focus();
    nameInput.select();
  }

  function addBuildButtons() {
    const box = document.getElementById('buildBox');
    if (!box || document.getElementById('mkz-build-actions')) return;
    const wrap = Object.assign(document.createElement('div'), { id: 'mkz-build-actions', className: 'mkz-build-actions' });
    const create = Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn btn-sm', textContent: '+ 新建版本', title: '在本页弹窗创建版本，创建后自动选中'
    });
    create.addEventListener('click', openBuildDialog);
    const refresh = Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn btn-sm', textContent: '刷新', title: '重新加载版本列表'
    });
    refresh.addEventListener('click', () => refreshBuilds(''));
    wrap.append(create, refresh);
    box.after(wrap); // 放在 buildBox 外面：禅道刷新版本时会整体替换 buildBox 的内容
  }

  // ---------- 3. 抄送：默认名单 ----------
  function addDefaultMailto() {
    const select = document.querySelector('select[name="mailto[]"]');
    if (!select || select.dataset.mkzMailto) return;
    select.dataset.mkzMailto = '1';
    const displayName = o => o.text.replace(/^[^:：]*[:：]/, '').trim();
    const values = new Set($()(select).val() || []);
    const missing = [];
    DEFAULT_MAILTO.forEach(name => {
      const option = Array.from(select.options).find(o => o.value && displayName(o) === name);
      if (option) values.add(option.value);
      else missing.push(name);
    });
    $()(select).val(Array.from(values)).trigger('chosen:updated');
    if (missing.length) console.warn(LOG, '抄送名单里这些人在禅道找不到：', missing.join('、'));
  }

  whenReady(
    () => $() && document.getElementById('project_chosen') && document.getElementById('mailto_chosen'),
    () => {
      try { lockProject(); } catch (e) { console.warn(LOG, '锁定项目失败', e); }
      try { addBuildButtons(); } catch (e) { console.warn(LOG, '添加版本按钮失败', e); }
      try { addDefaultMailto(); } catch (e) { console.warn(LOG, '设置抄送失败', e); }
    }
  );
})();
