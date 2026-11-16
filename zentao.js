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
    const id = text(C.id);
    return {
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
    return p.comments.map(c => `${shortDate(c.date)} ${c.who}：${c.comment}`).join('\n');
  }

  function renderProgress(row) {
    const td = row.progressTd;
    if (!td) return;
    td.innerHTML = '';
    const p = row.progress;
    if (!p) { td.appendChild(el('span', { class: 'mkz-muted', text: '加载中…' })); return; }
    if (p.error) { td.appendChild(el('span', { class: 'mkz-muted', text: `加载失败：${p.error}` })); return; }
    if (p.comments.length) {
      p.comments.forEach((c, i) => {
        td.appendChild(el('div', { class: `mkz-note${i ? ' mkz-note--old' : ''}`, title: `${c.date} ${c.time} ${c.who}\n${c.comment}` }, [
          el('span', { class: 'mkz-note__meta', text: `${shortDate(c.date)} ${c.who}` }),
          el('span', { class: 'mkz-note__text', text: c.comment })
        ]));
      });
    } else {
      td.appendChild(el('span', { class: 'mkz-muted', text: '暂无备注' }));
    }
    if (p.last && (!p.comments.length || p.last.date !== p.comments[0].date || p.last.time !== p.comments[0].time)) {
      td.appendChild(el('div', { class: 'mkz-last', text: `最近：${shortDate(p.last.date)} ${p.last.who} ${p.last.action}` }));
    }
    const d = staleDays(row);
    if (isStale(row)) td.appendChild(el('span', { class: 'mkz-badge mkz-badge--stale', text: `${d} 天无更新` }));
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
      const fmt = x => (x ? `${x.date} ${x.who}：${x.comment}` : '');
      const last = r.progress?.last;
      return [r.rawId, r.name, r.product, r.project, r.build, r.owner, r.begin, r.end, STATUS_TEXT[r.status],
        overdueDays(r) || '', fmt(c[0]), fmt(c[1]), last ? `${last.date} ${last.who} ${last.action}` : ''].map(esc).join(',');
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
    const text = parts.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setInfo('摘要已复制到剪贴板');
    } catch (_) {
      const ta = el('textarea', { class: 'mkz-copy-fallback' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setInfo('摘要已复制到剪贴板');
    }
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
