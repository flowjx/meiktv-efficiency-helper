// 禅道测试单列表增强（bug.meiktv.com，m=testtask&f=browse）
// 功能：统计栏、产品/项目合并、进度列（详情页最新两条备注）、搜索与筛选、逾期/停滞提示、导出 CSV、复制摘要。
(function () {
  'use strict';

  const LOG = '[禅道测试单助手]';
  const ROOT_ID = 'mkz-toolbar';
  const CACHE_PREFIX = 'mkz-progress:';
  const PREF_KEY = 'mkz-prefs';
  const CACHE_TTL = 30 * 60 * 1000; // 进度缓存 30 分钟
  const STALE_DAYS = 3; // 超过 N 天没有任何历史记录算"停滞"
  const CONCURRENCY = 4;

  const STATUS_TEXT = { wait: '未开始', doing: '进行中', blocked: '被阻塞', done: '已完成' };
  const STATUS_ORDER = ['doing', 'wait', 'blocked', 'done'];

  if (!document.body || !document.body.classList.contains('m-testtask-browse')) return;
  const table = document.getElementById('taskList');
  if (!table || !table.tBodies[0]) return;

  // ---------- 工具 ----------
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 存不了就算了 */ } }
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    [].concat(children).filter(Boolean).forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dayDiff(a, b) { // a - b，单位天，参数 YYYY-MM-DD
    return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  }

  function shortDate(s) { return s ? s.slice(5, 10) : ''; }

  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  // ---------- 解析行 ----------
  const headers = Array.from(table.tHead.rows[0].cells).map(th => norm(th.textContent));
  const col = name => headers.indexOf(name);
  const C = {
    id: col('ID'), name: col('名称'), product: col('所属产品'), project: col('所属项目'), build: col('版本'),
    owner: col('负责人'), begin: col('开始日期'), end: col('结束日期'), status: col('状态'), actions: col('操作')
  };
  if (C.id < 0 || C.name < 0 || C.status < 0) {
    console.warn(LOG, '表头和预期不一致，放弃增强', headers);
    return;
  }

  let rows = [];

  function parseRow(tr) {
    const cell = i => (i >= 0 ? tr.cells[i] : null);
    const text = i => norm(cell(i)?.textContent);
    const statusSpan = cell(C.status)?.querySelector('[class*="status-"]');
    const statusKey = (statusSpan?.className.match(/status-(wait|doing|blocked|done)/) || [])[1]
      || Object.keys(STATUS_TEXT).find(k => STATUS_TEXT[k] === text(C.status)) || 'wait';
    const viewLink = tr.querySelector('a[href*="f=view"][href*="taskID="]');
    const editLink = tr.querySelector('a[href*="f=edit"][href*="taskID="]');
    const id = text(C.id);
    return {
      editUrl: editLink ? editLink.getAttribute('href') : '',
      tr, id: String(Number(id) || id), rawId: id,
      name: text(C.name), product: text(C.product), project: text(C.project), build: text(C.build),
      owner: text(C.owner), begin: text(C.begin), end: text(C.end), status: statusKey,
      viewUrl: viewLink ? viewLink.getAttribute('href') : `/index.php?m=testtask&f=view&taskID=${Number(id)}&onlybody=yes`,
      progress: null
    };
  }

  // ---------- 加载全部分页 ----------
  async function loadAllPages() {
    const pager = document.querySelector('.table-footer .pager[data-link-creator]');
    if (!pager) return false;
    const total = Number(pager.dataset.recTotal || 0);
    const current = table.tBodies[0].rows.length;
    if (!total || total <= current || total > 1000) return false;
    const url = pager.dataset.linkCreator.replace('{recPerPage}', String(total)).replace('{page}', '1');
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newBody = doc.querySelector('#taskList tbody');
    if (!newBody || newBody.rows.length <= current) return false;
    const body = table.tBodies[0];
    body.innerHTML = '';
    Array.from(newBody.rows).forEach(tr => {
      const imported = document.importNode(tr, true);
      // 动态插入的行没有绑定禅道的弹窗脚本，"概况"改为新标签打开
      imported.querySelectorAll('a.iframe').forEach(a => {
        a.classList.remove('iframe');
        a.target = '_blank';
        a.href = a.getAttribute('href').replace(/&onlybody=yes/, '');
      });
      body.appendChild(imported);
    });
    const label = pager.querySelector('.pager-label');
    if (label) label.innerHTML = `共 <strong>${total}</strong> 项（效率助手已在本页加载全部）`;
    Array.from(pager.children).forEach((li, i) => { if (i > 0) li.style.display = 'none'; });
    return true;
  }

  // ---------- 进度（详情页历史记录） ----------
  function parseHistory(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = Array.from(doc.querySelectorAll('#actionbox .histories-list > li')).map(li => {
      const head = norm(Array.from(li.childNodes).filter(n => n.nodeType === 3 || n.tagName === 'STRONG').map(n => n.textContent).join(''));
      const m = head.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?,\s*由\s*(.+?)\s+(\S+?)。/);
      const comment = li.querySelector('.article-content.comment, .comment');
      return {
        date: m ? m[1] : '', time: m ? m[2] : '', who: m ? m[3] : '', action: m ? m[4] : '',
        comment: comment ? norm(comment.textContent) : ''
      };
    });
    const comments = items.filter(i => i.comment).slice(-2).reverse();
    const last = items[items.length - 1] || null;
    return { comments, last, fetchedAt: Date.now() };
  }

  async function fetchProgress(row, force) {
    const key = CACHE_PREFIX + row.id;
    const cached = store.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached;
    const html = await (await fetch(row.viewUrl, { credentials: 'include' })).text();
    const data = parseHistory(html);
    store.set(key, data);
    return data;
  }

  async function loadAllProgress(force) {
    const queue = rows.slice();
    let done = 0;
    setInfo(`进度加载中 0/${rows.length}…`);
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift();
        try {
          row.progress = await fetchProgress(row, force);
        } catch (e) {
          row.progress = { error: e.message || '加载失败' };
        }
        renderProgress(row);
        done += 1;
        setInfo(`进度加载中 ${done}/${rows.length}…`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setInfo(`进度已更新（缓存 ${CACHE_TTL / 60000} 分钟）`);
    renderStats();
    applyFilters();
  }

  function staleDays(row) {
    const last = row.progress?.last?.date;
    return last ? dayDiff(todayStr(), last) : null;
  }

  function isStale(row) {
    const d = staleDays(row);
    return row.status !== 'done' && d !== null && d > STALE_DAYS;
  }

  function progressText(row) {
    const p = row.progress;
    if (!p || p.error) return '';
    return p.comments.map(c => `${shortDate(c.date)} ${c.time} ${c.who}：${c.comment}`).join('\n');
  }

  function renderProgress(row) {
    const td = row.progressTd;
    if (!td) return;
    td.innerHTML = '';
    // 左边是备注内容，右边是“跟进”按钮；用 flex 让按钮在格子里竖直居中
    const body = el('div', { class: 'mkz-progress-body' });
    const wrap = el('div', { class: 'mkz-progress-wrap' }, [body]);
    td.appendChild(wrap);
    if (row.editUrl) {
      wrap.appendChild(el('button', {
        type: 'button', class: 'mkz-follow-btn', title: '提交一条跟进备注（走禅道“编辑测试单”的备注）',
        text: '跟进', onclick: () => openFollowDialog(row)
      }));
    }
    const p = row.progress;
    if (!p) { body.appendChild(el('span', { class: 'mkz-muted', text: '加载中…' })); return; }
    if (p.error) { body.appendChild(el('span', { class: 'mkz-muted', text: `加载失败：${p.error}` })); return; }
    if (p.comments.length) {
      p.comments.forEach((c, i) => {
        body.appendChild(el('div', { class: `mkz-note${i ? ' mkz-note--old' : ''}`, title: `${c.date} ${c.time} ${c.who}\n${c.comment}` }, [
          el('span', { class: 'mkz-note__meta', text: `${shortDate(c.date)} ${c.time} ${c.who}` }),
          el('span', { class: 'mkz-note__text', text: c.comment })
        ]));
      });
    } else {
      body.appendChild(el('span', { class: 'mkz-muted', text: '暂无备注' }));
    }
    if (p.last && (!p.comments.length || p.last.date !== p.comments[0].date || p.last.time !== p.comments[0].time)) {
      body.appendChild(el('div', { class: 'mkz-last', text: `最近：${shortDate(p.last.date)} ${p.last.time} ${p.last.who} ${p.last.action}` }));
    }
    const d = staleDays(row);
    if (isStale(row)) body.appendChild(el('span', { class: 'mkz-badge mkz-badge--stale', text: `${d} 天无更新` }));
  }

  // ---------- 跟进：通过禅道自带的“编辑测试单”表单提交备注 ----------
  // 本站禅道的 action-comment 接口对普通账号无权限，所以用编辑页：原样带回全部字段，只填 comment。
  function editFormUrl(row) {
    const url = new URL(row.editUrl, location.origin);
    url.searchParams.set('onlybody', 'yes');
    return url.pathname + url.search;
  }

  function textToHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\r?\n/g, '<br />');
  }

  async function submitFollowUp(row, text) {
    const url = editFormUrl(row);
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (/m=user&f=deny/.test(html)) throw new Error('没有编辑这张测试单的权限');
    if (/m=user&f=login/.test(html)) throw new Error('禅道登录已过期，请刷新页面重新登录');
    const form = Array.from(doc.querySelectorAll('form')).find(f => f.querySelector('[name="comment"]'));
    if (!form) throw new Error('没找到编辑表单里的备注框，禅道页面可能改版了');

    // 用表单当前值（即测试单原值）组装提交数据，只替换备注
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
      if (field.name === 'comment') return;
      data.append(field.name, field.value);
    });
    data.set('comment', textToHtml(text));

    const res = await fetch(form.getAttribute('action') || url, { method: 'POST', credentials: 'include', body: data });
    const reply = await res.text();
    // 禅道成功时也可能 alert('保存成功')，所以不凭 alert 判断；以历史记录里是否出现这条备注为准
    const progress = await fetchProgress(row, true);
    const latest = progress.comments[0];
    if (latest && norm(latest.comment) === norm(text)) return progress;
    const alertMsg = (reply.match(/alert\((['"])([\s\S]*?)\1\)/) || [])[2];
    throw new Error(alertMsg ? alertMsg.replace(/\\n/g, ' ').slice(0, 200) : '提交后没在历史记录里找到这条备注，请到禅道详情页确认');
  }

  function openFollowDialog(row) {
    document.getElementById('mkz-follow')?.remove();
    const textarea = el('textarea', { class: 'mkz-follow__input', placeholder: '写跟进内容，如：冒烟测试通过，待回归支付流程（Ctrl+Enter 提交）' });
    const status = el('div', { class: 'mkz-follow__status' });
    const submit = el('button', { type: 'button', class: 'btn btn-primary btn-sm', text: '提交跟进' });
    const cancel = el('button', { type: 'button', class: 'btn btn-sm', text: '取消' });
    const recent = (row.progress?.comments || []).map(c => el('div', { class: 'mkz-follow__recent' }, [
      el('span', { class: 'mkz-note__meta', text: `${shortDate(c.date)} ${c.time} ${c.who}` }), c.comment
    ]));
    const overlay = el('div', { id: 'mkz-follow', class: 'mkz-follow' }, [
      el('div', { class: 'mkz-follow__card' }, [
        el('div', { class: 'mkz-follow__title', text: `跟进 #${row.rawId} ${row.name}` }),
        recent.length ? el('div', { class: 'mkz-follow__history' }, recent) : null,
        textarea,
        el('div', { class: 'mkz-follow__hint', text: '提交后会以你的账号在禅道记录一条“编辑”并附上这段备注，测试单其他字段保持不变。' }),
        status,
        el('div', { class: 'mkz-follow__actions' }, [cancel, submit])
      ])
    ]);
    const close = () => overlay.remove();
    cancel.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const doSubmit = async () => {
      const text = textarea.value.trim();
      if (!text) { status.className = 'mkz-follow__status is-error'; status.textContent = '请先填写跟进内容'; return; }
      submit.disabled = true;
      textarea.disabled = true;
      status.className = 'mkz-follow__status';
      status.textContent = '提交中…';
      try {
        row.progress = await submitFollowUp(row, text);
        renderProgress(row);
        renderStats();
        setInfo(`#${row.rawId} 跟进已提交`);
        close();
      } catch (e) {
        status.className = 'mkz-follow__status is-error';
        status.textContent = `提交失败：${e.message || e}`;
        submit.disabled = false;
        textarea.disabled = false;
      }
    };
    submit.addEventListener('click', doSubmit);
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doSubmit();
      if (e.key === 'Escape') close();
    });
    document.body.appendChild(overlay);
    textarea.focus();
  }

  // ---------- 表格改造 ----------
  function decorateTable() {
    const headRow = table.tHead.rows[0];
    // 1) 产品/项目合并：隐藏"所属项目"列，不一致时在产品下方提示
    if (C.project >= 0) {
      headRow.cells[C.project].classList.add('mkz-hide');
      const productTh = headRow.cells[C.product];
      if (productTh && !productTh.dataset.mkz) {
        productTh.dataset.mkz = '1';
        productTh.querySelector('a')?.append('/项目');
      }
    }
    // 表格是 table-layout: fixed，没写宽度的列会平分剩余空间：给 ID/产品/版本定宽，剩下的留给进度列
    const markCol = (index, cls) => {
      if (index < 0) return;
      headRow.cells[index]?.classList.add(cls);
      rows.forEach(row => row.tr.cells[index]?.classList.add(cls));
    };
    markCol(C.id, 'mkz-col-id');
    markCol(C.product, 'mkz-col-product');
    markCol(C.build, 'mkz-col-build');
    // 2) 进度列：插在"状态"后
    if (!headRow.querySelector('.mkz-progress-th')) {
      headRow.cells[C.status].insertAdjacentElement('afterend', el('th', { class: 'mkz-progress-th text-left', text: '进度（最新两条备注）' }));
    }

    rows.forEach(row => {
      const tr = row.tr;
      tr.classList.add(`mkz-row--${row.status}`);
      if (C.project >= 0) {
        tr.cells[C.project].classList.add('mkz-hide');
        if (row.project && row.project !== row.product) {
          tr.cells[C.product].appendChild(el('div', { class: 'mkz-project-diff', title: '所属项目与产品不同', text: `项目：${row.project}` }));
        }
      }
      // 结束日期提示
      if (row.status !== 'done' && /^\d{4}-\d{2}-\d{2}$/.test(row.end)) {
        const diff = dayDiff(row.end, todayStr());
        const endTd = tr.cells[C.end];
        if (diff < 0) endTd.appendChild(el('span', { class: 'mkz-badge mkz-badge--overdue', text: `逾期${-diff}天` }));
        else if (diff === 0) endTd.appendChild(el('span', { class: 'mkz-badge mkz-badge--soon', text: '今天到期' }));
        else if (diff === 1) endTd.appendChild(el('span', { class: 'mkz-badge mkz-badge--soon', text: '明天到期' }));
      }
      const td = el('td', { class: 'mkz-progress-td' });
      tr.cells[C.status].insertAdjacentElement('afterend', td);
      row.progressTd = td;
      renderProgress(row);
    });
  }

  function overdueDays(row) {
    if (row.status === 'done' || !/^\d{4}-\d{2}-\d{2}$/.test(row.end)) return 0;
    return Math.max(0, dayDiff(todayStr(), row.end));
  }

  function isDueSoon(row) {
    if (row.status === 'done' || !/^\d{4}-\d{2}-\d{2}$/.test(row.end)) return false;
    const d = dayDiff(row.end, todayStr());
    return d === 0 || d === 1;
  }

  // ---------- 筛选状态 ----------
  const prefs = Object.assign({ status: 'all', risk: '', owner: '', keyword: '', hideDone: false }, store.get(PREF_KEY) || {});
  const savePrefs = () => store.set(PREF_KEY, prefs);

  function matches(row) {
    if (prefs.status !== 'all' && row.status !== prefs.status) return false;
    if (prefs.hideDone && row.status === 'done') return false;
    if (prefs.owner && row.owner !== prefs.owner) return false;
    if (prefs.risk === 'overdue' && !overdueDays(row)) return false;
    if (prefs.risk === 'soon' && !isDueSoon(row)) return false;
    if (prefs.risk === 'stale' && !isStale(row)) return false;
    if (prefs.risk === 'nonote' && (!row.progress || row.progress.error || row.progress.comments.length || row.status === 'done')) return false;
    const kw = prefs.keyword.trim().toLowerCase();
    if (kw) {
      const hay = [row.rawId, row.name, row.product, row.project, row.build, row.owner, STATUS_TEXT[row.status], progressText(row)]
        .join(' ').toLowerCase();
      if (!kw.split(/\s+/).every(k => hay.includes(k))) return false;
    }
    return true;
  }

  function visibleRows() { return rows.filter(r => !r.tr.classList.contains('mkz-filtered')); }

  function applyFilters() {
    let shown = 0;
    const kw = prefs.keyword.trim();
    rows.forEach(row => {
      const ok = matches(row);
      row.tr.classList.toggle('mkz-filtered', !ok);
      if (ok) shown += 1;
      highlight(row.tr.cells[C.name], kw);
    });
    const count = document.getElementById('mkz-count');
    if (count) count.textContent = `显示 ${shown} / ${rows.length}`;
    document.querySelectorAll('#mkz-toolbar [data-filter]').forEach(chip => {
      const [type, value] = chip.dataset.filter.split(':');
      const active = type === 'status' ? prefs.status === value : type === 'risk' ? prefs.risk === value : prefs.owner === value;
      chip.classList.toggle('is-active', active);
    });
    const hideDone = document.getElementById('mkz-hide-done');
    if (hideDone) hideDone.checked = prefs.hideDone;
  }

  function highlight(td, kw) {
    const a = td?.querySelector('a');
    if (!a) return;
    if (!a.dataset.mkzText) a.dataset.mkzText = a.textContent;
    const original = a.dataset.mkzText;
    a.textContent = '';
    const keys = kw.split(/\s+/).filter(Boolean);
    if (!keys.length) { a.textContent = original; return; }
    const re = new RegExp(`(${keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
    original.split(re).forEach(part => {
      if (!part) return;
      a.appendChild(keys.some(k => k.toLowerCase() === part.toLowerCase()) ? el('mark', { class: 'mkz-mark', text: part }) : document.createTextNode(part));
    });
  }

  // ---------- 统计栏 ----------
  function chip(label, count, filter, extraClass) {
    return el('button', {
      type: 'button', class: `mkz-chip ${extraClass || ''}`, 'data-filter': filter,
      onclick: () => {
        const [type, value] = filter.split(':');
        if (type === 'status') prefs.status = prefs.status === value ? 'all' : value;
        else if (type === 'risk') prefs.risk = prefs.risk === value ? '' : value;
        else prefs.owner = prefs.owner === value ? '' : value;
        savePrefs();
        applyFilters();
      }
    }, [label, el('b', { text: String(count) })]);
  }

  function renderStats() {
    const box = document.getElementById('mkz-stats');
    if (!box) return;
    box.innerHTML = '';
    const total = rows.length;
    const open = rows.filter(r => r.status !== 'done');
    const progressLoaded = rows.every(r => r.progress && !r.progress.error);

    const statusGroup = el('div', { class: 'mkz-group' }, [el('span', { class: 'mkz-group__title', text: '状态' }), chip('全部', total, 'status:all')]);
    STATUS_ORDER.forEach(s => statusGroup.appendChild(chip(STATUS_TEXT[s], rows.filter(r => r.status === s).length, `status:${s}`, `mkz-chip--${s}`)));

    const riskGroup = el('div', { class: 'mkz-group' }, [
      el('span', { class: 'mkz-group__title', text: '风险' }),
      chip('已逾期', open.filter(r => overdueDays(r)).length, 'risk:overdue', 'mkz-chip--danger'),
      chip('今明到期', open.filter(isDueSoon).length, 'risk:soon', 'mkz-chip--warn'),
      chip(`${STALE_DAYS}天无更新`, progressLoaded ? open.filter(isStale).length : '…', 'risk:stale', 'mkz-chip--warn'),
      chip('未完成且无备注', progressLoaded ? open.filter(r => !r.progress.comments.length).length : '…', 'risk:nonote', 'mkz-chip--muted')
    ]);

    const owners = {};
    rows.forEach(r => {
      owners[r.owner] = owners[r.owner] || { total: 0, open: 0, overdue: 0 };
      owners[r.owner].total += 1;
      if (r.status !== 'done') owners[r.owner].open += 1;
      if (overdueDays(r)) owners[r.owner].overdue += 1;
    });
    const ownerGroup = el('div', { class: 'mkz-group mkz-group--wrap' }, [el('span', { class: 'mkz-group__title', text: '负责人（未完成/总数）' })]);
    Object.entries(owners).sort((a, b) => b[1].open - a[1].open || b[1].total - a[1].total).forEach(([name, s]) => {
      const c = chip(name || '（空）', `${s.open}/${s.total}`, `owner:${name}`);
      if (s.overdue) c.title = `其中逾期 ${s.overdue} 个`;
      ownerGroup.appendChild(c);
    });

    box.append(statusGroup, riskGroup, ownerGroup);
    applyFilters();
  }

  // ---------- 导出 / 摘要 ----------
  function exportCsv() {
    const header = ['ID', '名称', '所属产品', '所属项目', '版本', '负责人', '开始日期', '结束日期', '状态', '逾期天数', '最新备注', '上一条备注', '最后更新'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = visibleRows().map(r => {
      const c = r.progress?.comments || [];
      const fmt = x => (x ? `${x.date} ${x.time} ${x.who}：${x.comment}` : '');
      const last = r.progress?.last;
      return [r.rawId, r.name, r.product, r.project, r.build, r.owner, r.begin, r.end, STATUS_TEXT[r.status],
        overdueDays(r) || '', fmt(c[0]), fmt(c[1]), last ? `${last.date} ${last.time} ${last.who} ${last.action}` : ''].map(esc).join(',');
    });
    const csv = [header.map(esc).join(','), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: `测试单-${todayStr()}.csv` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copySummary() {
    const list = visibleRows();
    const by = s => list.filter(r => r.status === s);
    const line = r => {
      const note = r.progress?.comments?.[0];
      const od = overdueDays(r);
      return `- #${r.rawId} ${r.name}（${r.owner}，截止 ${shortDate(r.end)}${od ? `，逾期${od}天` : ''}）${note ? `：${note.comment.slice(0, 40)}` : ''}`;
    };
    const parts = [
      `测试单进度 ${todayStr()}：共 ${list.length} 张，进行中 ${by('doing').length}、未开始 ${by('wait').length}、被阻塞 ${by('blocked').length}、已完成 ${by('done').length}；已逾期 ${list.filter(r => overdueDays(r)).length}。`
    ];
    if (by('blocked').length) parts.push('', '【被阻塞】', ...by('blocked').map(line));
    const overdue = list.filter(r => r.status !== 'blocked' && overdueDays(r)).sort((a, b) => overdueDays(b) - overdueDays(a));
    if (overdue.length) parts.push('', '【已逾期】', ...overdue.map(line));
    const soon = list.filter(isDueSoon);
    if (soon.length) parts.push('', '【今明到期】', ...soon.map(line));
    await copyText(parts.join('\n'));
    setInfo('摘要已复制到剪贴板');
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = el('textarea', { class: 'mkz-copy-fallback' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  // 归档：把当前筛选结果里“已完成”的测试单移到归档产品（product = 91），由维护者拿 SQL 去库里执行
  const ARCHIVE_PRODUCT_ID = 91;
  async function copyArchiveSql() {
    const done = visibleRows().filter(r => r.status === 'done' && /^\d+$/.test(r.id));
    if (!done.length) {
      setInfo('当前列表里没有“已完成”的测试单（检查是否勾选了“隐藏已完成”）');
      return;
    }
    const sql = done.map(r => `UPDATE \`meiktv_bug\`.\`meiktv_testtask\` SET \`product\` = ${ARCHIVE_PRODUCT_ID} WHERE \`id\` = ${Number(r.id)};`);
    const header = `-- 归档已完成测试单 ${todayStr()}，共 ${done.length} 条：${done.map(r => `#${r.rawId}`).join(' ')}`;
    await copyText([header, ...sql].join('\n'));
    setInfo(`已复制 ${done.length} 条归档 SQL（${done.map(r => `#${r.rawId}`).join('、')}）`);
  }

  // ---------- 工具栏 ----------
  function setInfo(msg) {
    const n = document.getElementById('mkz-info');
    if (n) n.textContent = msg;
  }

  function buildToolbar() {
    if (document.getElementById(ROOT_ID)) return;
    const search = el('input', {
      id: 'mkz-search', type: 'search', class: 'form-control mkz-search',
      placeholder: '搜索 ID / 名称 / 负责人 / 版本 / 备注，空格分隔多个词', value: prefs.keyword
    });
    let timer;
    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { prefs.keyword = search.value; savePrefs(); applyFilters(); }, 150);
    });
    const hideDone = el('input', { id: 'mkz-hide-done', type: 'checkbox' });
    hideDone.addEventListener('change', () => { prefs.hideDone = hideDone.checked; savePrefs(); applyFilters(); });

    const toolbar = el('div', { id: ROOT_ID, class: 'mkz-toolbar' }, [
      el('div', { class: 'mkz-toolbar__top' }, [
        el('strong', { class: 'mkz-title', text: '效率助手' }),
        search,
        el('label', { class: 'mkz-check' }, [hideDone, ' 隐藏已完成']),
        el('span', { id: 'mkz-count', class: 'mkz-count' }),
        el('button', { type: 'button', class: 'btn btn-sm', text: '清空筛选', onclick: () => {
          Object.assign(prefs, { status: 'all', risk: '', owner: '', keyword: '', hideDone: false });
          search.value = '';
          savePrefs();
          applyFilters();
        } }),
        el('button', { type: 'button', class: 'btn btn-sm', text: '刷新进度', onclick: () => loadAllProgress(true) }),
        el('button', { type: 'button', class: 'btn btn-sm', text: '导出CSV', onclick: exportCsv }),
        el('button', { type: 'button', class: 'btn btn-sm btn-primary', text: '复制摘要', onclick: copySummary }),
        el('button', {
          type: 'button', class: 'btn btn-sm', text: '复制归档SQL', onclick: copyArchiveSql,
          title: '把当前列表中“已完成”的测试单生成归档 SQL（product 改为 91）并复制'
        }),
        el('span', { id: 'mkz-info', class: 'mkz-info' })
      ]),
      el('div', { id: 'mkz-stats', class: 'mkz-stats' })
    ]);
    table.parentElement.insertBefore(toolbar, table);
    // 按 / 快速聚焦搜索框
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        e.preventDefault();
        search.focus();
      }
    });
  }

  // ---------- 启动 ----------
  async function init() {
    buildToolbar();
    try {
      if (await loadAllPages()) console.info(LOG, '已加载全部分页');
    } catch (e) {
      console.warn(LOG, '加载全部分页失败，只处理当前页', e);
    }
    rows = Array.from(table.tBodies[0].rows).filter(tr => tr.cells.length > 3).map(parseRow);
    decorateTable();
    renderStats();
    console.info(LOG, `已增强 ${rows.length} 张测试单`);
    loadAllProgress(false);
  }

  init();
})();
