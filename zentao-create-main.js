// 禅道“提交测试”页默认值（运行在页面自身环境 world: MAIN，才能操作禅道的 jQuery / chosen 下拉组件）：
// 1) 所属项目默认“测试计划跟进”（projectID 136）且锁定不可改；
// 2) 版本下拉旁加“新建版本”（新标签打开禅道创建版本页）和“刷新”，从新建页回来时自动刷新并选中新版本；
// 3) 抄送人默认加上固定名单（按禅道里的显示姓名匹配，不写账号）。
// 注意：MAIN world 脚本不能用 chrome.* 接口；改配置直接改下面的常量。
(function () {
  'use strict';

  const PROJECT_ID = '136'; // 测试计划跟进
  const BUILD_CREATE_URL = `/index.php?m=build&f=create&project=${PROJECT_ID}`;
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

  // ---------- 2. 版本：新建 / 刷新 ----------
  function buildIds() {
    const select = document.getElementById('build');
    return select ? Array.from(select.options).map(o => o.value).filter(Boolean) : [];
  }

  function refreshBuilds(selectNew) {
    const before = new Set(buildIds());
    const box = document.getElementById('buildBox');
    if (!box || typeof window.loadProjectBuilds !== 'function') return;
    if (selectNew) {
      const observer = new MutationObserver(() => {
        const added = buildIds().filter(id => !before.has(id));
        if (!document.getElementById('build')) return;
        observer.disconnect();
        if (added.length) {
          const newest = added.map(Number).sort((a, b) => b - a)[0];
          setTimeout(() => $()('#build').val(String(newest)).trigger('chosen:updated').trigger('change'), 50);
        }
      });
      observer.observe(box, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 10000);
    }
    window.loadProjectBuilds(PROJECT_ID);
  }

  function addBuildButtons() {
    const box = document.getElementById('buildBox');
    if (!box || document.getElementById('mkz-build-actions')) return;
    let waitingNewBuild = false;
    const wrap = document.createElement('div');
    wrap.id = 'mkz-build-actions';
    wrap.className = 'mkz-build-actions';
    const create = document.createElement('a');
    create.href = BUILD_CREATE_URL;
    create.target = '_blank';
    create.className = 'btn btn-sm';
    create.textContent = '+ 新建版本';
    create.title = '在新标签页打开“创建版本”，保存后回到本页会自动刷新并选中新版本';
    create.addEventListener('click', () => { waitingNewBuild = true; });
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn-sm';
    refresh.textContent = '刷新';
    refresh.title = '重新加载版本列表';
    refresh.addEventListener('click', () => refreshBuilds(false));
    wrap.append(create, refresh);
    box.after(wrap); // 放在 buildBox 外面：禅道刷新版本时会整体替换 buildBox 的内容
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && waitingNewBuild) {
        waitingNewBuild = false;
        refreshBuilds(true);
      }
    });
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
