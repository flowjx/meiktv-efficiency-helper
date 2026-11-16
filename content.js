(function () {
  'use strict';

  const BUTTON_ID = 'meiktv-batch-store-button';
  const PANEL_ID = 'meiktv-batch-store-panel';
  const TOAST_ID = 'meiktv-batch-store-toast';
  const TEXTAREA_ID = 'meiktv-batch-store-array';
  const STATUS_ID = 'meiktv-batch-store-status';
  const DEBUG_PREFIX = '[门店批量选择助手]';
  const MUSIC_API_BASE = 'http://music.remote.meiktv.com';
  const MUSIC_STORE_TEXTAREA_ID = 'meiktv-music-store-ids';
  const MUSIC_MATERIAL_ID = 'meiktv-music-material-id';
  const MUSIC_QUERY_EXISTING_ID = 'meiktv-music-query-existing';
  const MUSIC_DELAY_ID = 'meiktv-music-delay';
  const MUSIC_STATUS_ID = 'meiktv-music-status';
  const MUSIC_SUMMARY_ID = 'meiktv-music-summary';
  const MUSIC_RETRY_ID = 'meiktv-music-retry';
  const MUSIC_PANEL_CLASS = 'meiktv-music-panel';
  const SINGER_PANEL_ID = 'meiktv-singer-panel';
  const SINGER_TEXTAREA_ID = 'meiktv-singer-list';
  const SINGER_STATUS_ID = 'meiktv-singer-status';
  const SINGER_SUMMARY_ID = 'meiktv-singer-summary';
  const SINGER_PROGRESS_ID = 'meiktv-singer-progress';
  const SINGER_CURRENT_ID = 'meiktv-singer-current';
  const SINGER_DELAY_ID = 'meiktv-singer-delay';
  const singerState = { running: false, paused: false, phase: '', items: [], index: 0, success: [], skipped: [], failed: [] };

  const musicState = {
    running: false,
    paused: false,
    total: 0,
    processed: 0,
    current: '',
    materialId: null,
    delayMs: 300,
    queryExisting: true,
    success: [],
    skipped: [],
    failed: [],
    abortController: null
  };
  const musicAuth = { token: '', jsessionid: '' };

  function findSpecifiedStoreRadio() {
    return document.querySelector('input[name="row[has_all_store]"][value="0"]')
      || document.getElementById('row[has_all_store]-0')
      || document.querySelector('input[name="row[store_type]"][value="3"]')
      || document.getElementById('row[store_type]-3');
  }

  function findDirectStoreHeading() {
    return Array.from(document.querySelectorAll('span')).find(span => {
      const text = span.textContent.trim();
      return text === '----直营--------------------------------' || text.includes('----直营');
    }) || null;
  }

  function isMusicPage() {
    return location.protocol === 'http:'
      && location.hostname === 'music.remote.meiktv.com'
      && location.pathname === '/music/play.html';
  }

  function isSingerPage() {
    return location.protocol === 'http:'
      && location.hostname === 'music.remote.meiktv.com'
      && location.pathname === '/singer/index.html';
  }

  function findButtonTrigger() {
    return findSpecifiedStoreRadio() || findDirectStoreHeading() || (isMusicPage() ? document.body : null)
      || (isSingerPage() ? document.body : null);
  }

  function getSpecifiedStoreLabel(radio) {
    if (!radio) return null;
    return document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) || radio.closest('label');
  }

  function showToast(message) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement('div');
      toast.id = TOAST_ID;
      toast.className = 'meiktv-batch-store-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }

  function activateStoreSelectionMode() {
    const specifiedStoreRadio = findSpecifiedStoreRadio();
    if (specifiedStoreRadio && !specifiedStoreRadio.checked) {
      specifiedStoreRadio.click();
    }

    const customStoreRadio = document.querySelector(
      'input[name="row[has_store_type]"][value="3"], input[name="row[store_type]"][value="3"], #row\\[store_type\\]-3'
    );
    if (customStoreRadio && !customStoreRadio.checked) {
      customStoreRadio.click();
    }

    console.debug(DEBUG_PREFIX, '已切换到自定义门店模式', {
      specifiedStoreRadio: Boolean(specifiedStoreRadio),
      customStoreRadio: Boolean(customStoreRadio)
    });
  }

  function parseStoreNames() {
    const textarea = document.getElementById(TEXTAREA_ID);
    if (!textarea) return { names: null, error: '请输入门店名称数组' };

    let value;
    try {
      value = JSON.parse(textarea.value.trim());
    } catch (error) {
      return { names: null, error: '数组格式不正确，例如：["门店A", "门店B"]' };
    }

    if (!Array.isArray(value)) {
      return { names: null, error: '请输入门店名称数组，例如：["门店A", "门店B"]' };
    }

    const names = new Set(
      value
        .filter(name => typeof name === 'string' || typeof name === 'number')
        .map(name => String(name).trim())
        .filter(Boolean)
    );

    if (!names.size) {
      return { names: null, error: '数组中没有有效的门店名称' };
    }

    return { names, error: '' };
  }

  function getStoreCheckboxes() {
    return Array.from(document.querySelectorAll(
      'input[name="row[has_store_id][]"], input[name="row[store_id][]"], input[name="store_id[]"], input[id^="store_id[]-"]'
    ));
  }

  function getStoreName(checkbox) {
    if (!checkbox || !checkbox.id) return null;

    const label = document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) || checkbox.closest('label');
    const fullStoreName = label ? label.textContent.trim() : '';
    return {
      fullName: fullStoreName,
      name: fullStoreName.replace(/^[A-Z]-/, '').trim(),
      value: String(checkbox.value || '').trim()
    };
  }

  function applyStoreSelection(select) {
    const result = parseStoreNames();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;

    if (result.error) {
      status.className = 'meiktv-batch-store-status is-error';
      status.textContent = result.error;
      return;
    }

    activateStoreSelectionMode();
    const checkboxes = getStoreCheckboxes();
    console.debug(DEBUG_PREFIX, '开始处理门店', {
      operation: select ? 'select' : 'unselect',
      inputNames: checkboxes.map(checkbox => checkbox.name),
      checkboxCount: checkboxes.length,
      requestedNames: Array.from(result.names)
    });
    let changedCount = 0;
    let matchedCount = 0;

    checkboxes.forEach(checkbox => {
      const store = getStoreName(checkbox);
      if (!store || (!result.names.has(store.name) && !result.names.has(store.value)) || checkbox.disabled) return;

      matchedCount += 1;
      const shouldBeChecked = select;
      if (checkbox.checked !== shouldBeChecked) {
        checkbox.click();
        changedCount += 1;
      }
    });

    const operation = select ? '选中' : '取消选中';
    status.className = 'meiktv-batch-store-status is-success';
    status.textContent = `已${operation} ${changedCount} 家门店，匹配到 ${matchedCount} 家`;
    showToast(`门店${operation}完成`);
    console.info(DEBUG_PREFIX, `门店${operation}完成`, { changedCount, matchedCount });
  }

  function parseMusicStoreIds(raw) {
    const text = String(raw || '').trim();
    if (!text) return { ids: [], originalCount: 0, error: '请输入 store_id，多个 ID 用英文逗号分隔' };

    const normalized = text.split(/[,，]/).map(value => value.trim()).filter(Boolean);
    const invalid = normalized.find(id => !/^\d+$/.test(id));
    if (invalid) {
      return { ids: [], originalCount: normalized.length, error: `store_id 必须是数字：${invalid}` };
    }

    const ids = [];
    const seen = new Set();
    normalized.forEach(id => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    });

    return { ids, originalCount: normalized.length, error: ids.length ? '' : '没有解析出有效的 store_id' };
  }

  function musicPanelElement(id) {
    return document.getElementById(id);
  }

  function setMusicStatus(message, type) {
    const status = musicPanelElement(MUSIC_STATUS_ID);
    if (!status) return;
    status.className = `meiktv-batch-store-status meiktv-music-status ${type ? `is-${type}` : ''}`;
    status.textContent = message;
  }

  function updateMusicSummary(preview) {
    const summary = musicPanelElement(MUSIC_SUMMARY_ID);
    if (!summary) return;

    const parsed = preview || parseMusicStoreIds(musicPanelElement(MUSIC_STORE_TEXTAREA_ID)?.value);
    if (parsed.error) {
      summary.textContent = parsed.error;
      summary.className = 'meiktv-music-summary is-error';
      return parsed;
    }

    summary.className = 'meiktv-music-summary';
    summary.textContent = `原始 ${parsed.originalCount} 条，去重后 ${parsed.ids.length} 家，成功 ${musicState.success.length}，跳过 ${musicState.skipped.length}，失败 ${musicState.failed.length}`;
    return parsed;
  }

  function getCookie(name) {
    const prefix = `${name}=`;
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  }

  function getStoredToken() {
    const keys = ['token', 'Token', 'access_token', 'accessToken', 'authToken'];
    const storages = [];
    try { storages.push(window.localStorage); } catch (_) { /* ignore */ }
    try { storages.push(window.sessionStorage); } catch (_) { /* ignore */ }
    for (const storage of storages) {
      for (const key of keys) {
        try {
          const value = storage.getItem(key);
          if (value) {
            try {
              const parsed = JSON.parse(value);
              if (typeof parsed === 'string') return parsed;
              if (parsed && typeof parsed.token === 'string') return parsed.token;
              if (parsed && typeof parsed.accessToken === 'string') return parsed.accessToken;
            } catch (_) {
              return value;
            }
          }
        } catch (_) {
          // 某些页面会限制 storage 访问，继续检查其他来源。
        }
      }
    }

    const metaToken = document.querySelector('meta[name="token"], meta[name="Token"], meta[name="access-token"]')?.content || '';
    return metaToken || window.token || window.Token || getCookie('token') || getCookie('Token') || getCookie('access_token');
  }

  function refreshMusicAuth() {
    musicAuth.token = String(getStoredToken() || '').trim();
    musicAuth.jsessionid = getCookie('JSESSIONID') || getCookie('jsessionid');
    console.debug(DEBUG_PREFIX, '已刷新音乐页登录态参数', {
      hasToken: Boolean(musicAuth.token),
      hasJsessionidCookie: Boolean(musicAuth.jsessionid),
      cookieCredentials: true
    });
  }

  function musicHeaders() {
    refreshMusicAuth();
    const token = musicAuth.token;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (token) headers.token = token;
    return headers;
  }

  class MusicApiError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'MusicApiError';
      this.auth = Boolean(options.auth);
      this.status = options.status || 0;
      this.payload = options.payload;
    }
  }

  async function musicRequest(path, body, signal) {
    let response;
    try {
      response = await fetch(`${MUSIC_API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: musicHeaders(),
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new MusicApiError(`网络请求失败：${error.message || '无法连接接口'}`);
    }

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (_) {
      payload = text;
    }

    if (response.redirected || (typeof payload === 'string' && /<html[\s>]|<!doctype/i.test(payload))) {
      throw new MusicApiError('登录已过期，请重新登录后重试', { auth: true, status: response.status, payload });
    }

    if (response.status === 401 || response.status === 403) {
      throw new MusicApiError('登录已过期或没有接口权限，请重新登录后重试', { auth: true, status: response.status, payload });
    }
    if (!response.ok) {
      throw new MusicApiError(`接口返回 HTTP ${response.status}`, { status: response.status, payload });
    }

    const code = payload && typeof payload === 'object' ? Number(payload.code ?? payload.statusCode) : NaN;
    if (code === 401 || code === 403) {
      throw new MusicApiError('登录已过期或没有接口权限，请重新登录后重试', { auth: true, status: code, payload });
    }
    if (code >= 400) {
      throw new MusicApiError(payload.message || payload.msg || `接口业务失败（${code}）`, { status: code, payload });
    }
    if (payload && typeof payload === 'object'
      && (payload.success === false || payload.ok === false || payload.result === false
        || (payload.data && payload.data.success === false))) {
      throw new MusicApiError(payload.message || payload.msg || '接口返回失败', { status: code || response.status, payload });
    }
    return payload;
  }

  function parseSingerItems(raw) {
    const text = String(raw || '').trim();
    if (!text) return { items: [], error: '请输入歌手列表' };
    let items = [];
    try {
      if (text.startsWith('[')) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) throw new Error('必须是数组');
        items = parsed.map(item => typeof item === 'string' ? { name: item } : item);
      } else {
        items = text.split(/\r?\n/).filter(Boolean).map(line => {
          const parts = line.split(/[,，|\t]/).map(value => value.trim());
          return { name: parts[0], pinyin: parts[1] || '', fullPinyin: parts[2] || '', thumb: parts[3] || '' };
        });
      }
    } catch (error) {
      return { items: [], error: '歌手列表格式不正确，请使用每行“歌手名,简拼,全拼”或 JSON 数组' };
    }

    const normalized = [];
    const seen = new Set();
    items.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const name = String(item.name || '').trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      normalized.push({
        name,
        pinyin: String(item.pinyin || '').trim(),
        fullPinyin: String(item.fullPinyin || '').trim(),
        thumb: String(item.thumb || '').trim()
      });
    });
    return { items: normalized, error: normalized.length ? '' : '没有解析出有效歌手' };
  }

  async function singerRequest(item, signal) {
    refreshMusicAuth();
    const form = new FormData();
    form.append('singerId', '0');
    form.append('name', item.name);
    form.append('pinyin', item.pinyin);
    form.append('fullPinyin', item.fullPinyin);
    form.append('hot', '0');
    form.append('status', '0');
    form.append('hasAvatar', '1');
    form.append('language', '0');
    form.append('category', '0');
    form.append('thumb', item.thumb);

    let response;
    try {
      response = await fetch(`${MUSIC_API_BASE}/music-admin/meiktvSinger/add`, {
        method: 'POST', credentials: 'include', headers: { Accept: 'application/json, text/plain, */*', token: musicAuth.token }, body: form, signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new MusicApiError(`网络请求失败：${error.message || '无法连接接口'}`);
    }
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
    if (response.redirected || (typeof payload === 'string' && /<html[\s>]|<!doctype/i.test(payload))) {
      throw new MusicApiError('登录已过期，请重新登录后重试', { auth: true });
    }
    if (response.status === 401 || response.status === 403) {
      throw new MusicApiError('登录已过期或没有接口权限', { auth: true, status: response.status });
    }
    if (!response.ok) throw new MusicApiError(`接口返回 HTTP ${response.status}`, { status: response.status, payload });
    const code = payload && typeof payload === 'object' ? Number(payload.code ?? payload.statusCode) : NaN;
    if (code >= 400 || (payload && payload.success === false)) {
      throw new MusicApiError(payload.message || payload.msg || '添加歌手失败', { status: code, payload });
    }
    return payload;
  }

  function singerExistsInPayload(payload, name) {
    if (!payload || typeof payload !== 'object') return false;
    if (Array.isArray(payload)) return payload.some(item => singerExistsInPayload(item, name));
    const normalizedName = String(name).trim();
    for (const key of ['name', 'singerName']) {
      if (payload[key] != null && String(payload[key]).trim() === normalizedName) return true;
    }
    if (payload.singerId != null || payload.id != null) {
      if (payload.name != null || payload.singerName != null || payload.pinyin != null || payload.fullPinyin != null) return true;
    }
    if (payload.data && typeof payload.data === 'object') return singerExistsInPayload(payload.data, name);
    return false;
  }

  async function singerQueryByName(name, signal) {
    refreshMusicAuth();
    const query = encodeURIComponent(name);
    let response;
    try {
      response = await fetch(`${MUSIC_API_BASE}/music-admin/meiktvSinger/getByName?name=${query}`, {
        method: 'GET', credentials: 'include', headers: { Accept: 'application/json, text/plain, */*', token: musicAuth.token }, signal
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new MusicApiError(`查询歌手失败：${error.message || '无法连接接口'}`);
    }
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
    if (response.redirected || (typeof payload === 'string' && /<html[\s>]|<!doctype/i.test(payload))) throw new MusicApiError('登录已过期，请重新登录后重试', { auth: true });
    if (response.status === 401 || response.status === 403) throw new MusicApiError('登录已过期或没有接口权限', { auth: true, status: response.status });
    if (!response.ok) throw new MusicApiError(`查询接口返回 HTTP ${response.status}`, { status: response.status, payload });
    const code = payload && typeof payload === 'object' ? Number(payload.code ?? payload.statusCode) : NaN;
    if (code >= 400 || (payload && payload.success === false)) throw new MusicApiError(payload.message || payload.msg || '查询歌手失败', { status: code, payload });
    return singerExistsInPayload(payload, name);
  }

  function updateSingerView() {
    const summary = document.getElementById(SINGER_SUMMARY_ID);
    const progress = document.getElementById(SINGER_PROGRESS_ID);
    const current = document.getElementById(SINGER_CURRENT_ID);
    if (summary) summary.textContent = `待处理 ${singerState.items.length} 个，已存在 ${singerState.skipped.length}，成功 ${singerState.success.length}，失败 ${singerState.failed.length}`;
    if (progress) { progress.max = Math.max(singerState.items.length, 1); progress.value = singerState.index; }
    if (current) current.textContent = singerState.items[singerState.index]?.name ? `处理中：${singerState.items[singerState.index].name}` : '尚未开始';
  }

  async function runSingerBatch(items) {
    if (singerState.running) return;
    singerState.running = true; singerState.paused = false; singerState.phase = 'query'; singerState.items = items; singerState.index = 0; singerState.success = []; singerState.skipped = []; singerState.failed = [];
    const delay = Math.max(100, Number(document.getElementById(SINGER_DELAY_ID)?.value || 300));
    const start = document.getElementById('meiktv-singer-start');
    const pause = document.getElementById('meiktv-singer-pause');
    if (start) start.disabled = true;
    if (pause) { pause.disabled = false; pause.textContent = '暂停'; }
    setSingerStatus('第一步：正在检测已有歌手…');
    const pending = [];
    for (const item of items) {
      while (singerState.paused && singerState.running) await waitMusic(200);
      if (!singerState.running) break;
      singerState.items = items; singerState.index = items.indexOf(item); updateSingerView();
      try {
        if (await singerQueryByName(item.name)) singerState.skipped.push({ ...item, reason: '歌手已存在' });
        else pending.push(item);
      } catch (error) {
        singerState.failed.push({ ...item, reason: `查询失败：${musicErrorMessage(error)}` });
        if (error.auth) { singerState.paused = true; setSingerStatus('登录已过期，请重新登录后点击继续。', 'error'); }
      }
      await waitMusic(delay);
    }
    if (!singerState.running) return;
    singerState.items = pending; singerState.index = 0; singerState.phase = 'add';
    setSingerStatus(`第二步：检测完成，已存在 ${singerState.skipped.length} 个，准备添加 ${pending.length} 个…`);
    for (; singerState.index < singerState.items.length; singerState.index += 1) {
      while (singerState.paused && singerState.running) await waitMusic(200);
      if (!singerState.running) break;
      const item = singerState.items[singerState.index];
      updateSingerView();
      try { await singerRequest(item); singerState.success.push(item); }
      catch (error) {
        if (error.name === 'AbortError') break;
        singerState.failed.push({ ...item, reason: musicErrorMessage(error) });
        if (error.auth) { singerState.paused = true; setSingerStatus('登录已过期，请重新登录后点击继续。', 'error'); }
      }
      updateSingerView();
      await waitMusic(delay);
    }
    singerState.running = false;
    if (start) start.disabled = false;
    if (pause) { pause.disabled = true; pause.textContent = '暂停'; }
    setSingerStatus(singerState.failed.length ? `完成，已存在 ${singerState.skipped.length}，成功 ${singerState.success.length}，失败 ${singerState.failed.length}` : `全部完成，已存在 ${singerState.skipped.length}，新增 ${singerState.success.length}`, singerState.failed.length ? 'error' : 'success');
    updateSingerView();
  }

  function setSingerStatus(message, type) {
    const node = document.getElementById(SINGER_STATUS_ID);
    if (node) { node.className = `meiktv-batch-store-status meiktv-music-status ${type ? `is-${type}` : ''}`; node.textContent = message; }
  }

  function createSingerPanel() {
    if (document.getElementById(SINGER_PANEL_ID)) { document.getElementById(SINGER_TEXTAREA_ID)?.focus(); return; }
    const panel = document.createElement('div');
    panel.id = SINGER_PANEL_ID; panel.className = `${MUSIC_PANEL_CLASS} meiktv-batch-store-panel`;
    panel.innerHTML = `<div class="meiktv-batch-store-panel__card meiktv-music-panel__card">
      <div class="meiktv-batch-store-panel__header"><strong>批量添加歌手</strong><button type="button" class="meiktv-batch-store-panel__close">×</button></div>
      <label class="meiktv-batch-store-panel__label" for="${SINGER_TEXTAREA_ID}">歌手列表</label>
      <textarea id="${SINGER_TEXTAREA_ID}" class="meiktv-batch-store-panel__textarea" placeholder="每行：歌手名,简拼,全拼\n例如：蒋菲菲,JFF,JIANGFEIFEI"></textarea>
      <div class="meiktv-batch-store-panel__hint">提交前会先按歌手名查询，已存在的歌手会从待添加列表移除。也支持 JSON：[{"name":"蒋菲菲","pinyin":"JFF","fullPinyin":"JIANGFEIFEI"}]</div>
      <label class="meiktv-music-material-field">请求间隔(ms)<input id="${SINGER_DELAY_ID}" type="number" min="100" value="300"></label>
      <div id="${SINGER_SUMMARY_ID}" class="meiktv-music-summary">尚未预览</div>
      <div class="meiktv-music-actions"><button id="meiktv-singer-preview" type="button" class="meiktv-batch-store-action meiktv-batch-store-action--select">预览</button><button id="meiktv-singer-start" type="button" class="meiktv-batch-store-action meiktv-batch-store-action--select">开始添加</button><button id="meiktv-singer-pause" type="button" class="meiktv-batch-store-action meiktv-batch-store-action--unselect" disabled>暂停</button></div>
      <progress id="${SINGER_PROGRESS_ID}" max="1" value="0"></progress><div id="${SINGER_CURRENT_ID}" class="meiktv-music-current">尚未开始</div><div id="${SINGER_STATUS_ID}" class="meiktv-batch-store-status meiktv-music-status"></div>
    </div>`;
    panel.querySelector('.meiktv-batch-store-panel__close').addEventListener('click', () => panel.remove());
    panel.querySelector('#meiktv-singer-preview').addEventListener('click', () => { const parsed = parseSingerItems(document.getElementById(SINGER_TEXTAREA_ID).value); document.getElementById(SINGER_SUMMARY_ID).textContent = parsed.error || `解析 ${parsed.items.length} 个歌手，重复项已去除`; setSingerStatus(parsed.error || '预览完成', parsed.error ? 'error' : 'success'); });
    panel.querySelector('#meiktv-singer-start').addEventListener('click', () => { const parsed = parseSingerItems(document.getElementById(SINGER_TEXTAREA_ID).value); if (parsed.error) return setSingerStatus(parsed.error, 'error'); runSingerBatch(parsed.items); });
    panel.querySelector('#meiktv-singer-pause').addEventListener('click', () => { singerState.paused = !singerState.paused; panel.querySelector('#meiktv-singer-pause').textContent = singerState.paused ? '继续' : '暂停'; setSingerStatus(singerState.paused ? '已暂停' : '继续添加…'); });
    document.body.appendChild(panel); document.getElementById(SINGER_TEXTAREA_ID).focus();
  }

  function containsMaterialId(value, materialId, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) return value.some(item => containsMaterialId(item, materialId, seen));
    if (Object.prototype.hasOwnProperty.call(value, 'materialId') && String(value.materialId) === String(materialId)) return true;
    return Object.values(value).some(item => containsMaterialId(item, materialId, seen));
  }

  function musicErrorMessage(error) {
    if (error instanceof MusicApiError) return error.message;
    return error && error.message ? error.message : '未知错误';
  }

  function waitMusic(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function updateMusicProgress() {
    const progress = musicPanelElement('meiktv-music-progress');
    const current = musicPanelElement('meiktv-music-current');
    const retry = musicPanelElement(MUSIC_RETRY_ID);
    if (progress) {
      progress.max = Math.max(musicState.total, 1);
      progress.value = musicState.processed;
    }
    if (current) {
      current.textContent = musicState.current
        ? `处理中：${musicState.current}`
        : `已处理 ${musicState.processed}/${musicState.total}`;
    }
    if (retry) retry.disabled = musicState.running || musicState.failed.length === 0;
    updateMusicSummary();
  }

  async function runMusicBatch(ids, options = {}) {
    if (musicState.running) return;
    const materialIdText = String(options.materialId ?? musicPanelElement(MUSIC_MATERIAL_ID)?.value ?? '').trim();
    if (!/^\d+$/.test(materialIdText) || Number(materialIdText) < 1) {
      setMusicStatus('请输入有效的素材 ID。', 'error');
      return;
    }
    const materialId = Number(materialIdText);
    musicState.running = true;
    musicState.paused = false;
    musicState.total = ids.length;
    musicState.processed = 0;
    musicState.current = '';
    musicState.materialId = materialId;
    musicState.delayMs = Math.max(100, Number(options.delayMs || musicPanelElement(MUSIC_DELAY_ID)?.value || 300));
    musicState.queryExisting = Boolean(options.queryExisting ?? musicPanelElement(MUSIC_QUERY_EXISTING_ID)?.checked);
    if (!options.retry) {
      musicState.success = [];
      musicState.skipped = [];
      musicState.failed = [];
    } else {
      musicState.failed = [];
    }

    const startButton = musicPanelElement('meiktv-music-start');
    const pauseButton = musicPanelElement('meiktv-music-pause');
    if (startButton) startButton.disabled = true;
    if (pauseButton) {
      pauseButton.disabled = false;
      pauseButton.textContent = '暂停';
    }
    musicState.abortController = new AbortController();
    setMusicStatus(options.retry ? '正在重试失败项…' : '正在提交…');
    updateMusicProgress();

    for (const storeId of ids) {
      while (musicState.paused && musicState.running) await waitMusic(200);
      if (!musicState.running) break;
      musicState.current = storeId;
      updateMusicProgress();
      try {
        if (musicState.queryExisting) {
          const existingPayload = await musicRequest('/music-admin/meiktvSongPlayList/page', {
            storeId: String(storeId), pageNum: 1, pageSize: 1000
          }, musicState.abortController.signal);
          if (containsMaterialId(existingPayload, musicState.materialId)) {
            musicState.skipped.push({ storeId, reason: '门店已有指定素材' });
            musicState.processed += 1;
            updateMusicProgress();
            await waitMusic(musicState.delayMs);
            continue;
          }
          await waitMusic(musicState.delayMs);
        }

        await musicRequest('/music-admin/meiktvSongPlayList/save', {
          storeIds: String(storeId), materialId: musicState.materialId,
          showType: 0, showRuleType: 0, showRule: 0, weight: 0
        }, musicState.abortController.signal);
        musicState.success.push({ storeId, materialId: musicState.materialId });
      } catch (error) {
        if (error.name === 'AbortError' && musicState.paused) break;
        musicState.failed.push({ storeId, reason: musicErrorMessage(error) });
        if (error.auth) {
          musicState.paused = true;
          const pauseButton = musicPanelElement('meiktv-music-pause');
          if (pauseButton) pauseButton.textContent = '继续';
          setMusicStatus('登录已过期或没有权限，已暂停。重新登录后点击继续。', 'error');
        }
      }
      musicState.processed += 1;
      updateMusicProgress();
      await waitMusic(musicState.delayMs);
    }

    musicState.current = '';
    musicState.running = false;
    const finalMessage = musicState.paused && musicState.failed.length
      ? '任务已暂停，请处理登录或权限问题后点击继续。'
      : `处理完成：成功 ${musicState.success.length}，跳过 ${musicState.skipped.length}，失败 ${musicState.failed.length}`;
    setMusicStatus(finalMessage, musicState.failed.length ? 'error' : 'success');
    if (startButton) startButton.disabled = false;
    if (pauseButton) {
      pauseButton.disabled = true;
      pauseButton.textContent = '暂停';
    }
    updateMusicProgress();
  }

  function toggleMusicPause() {
    if (!musicState.running) return;
    musicState.paused = !musicState.paused;
    const button = musicPanelElement('meiktv-music-pause');
    if (button) button.textContent = musicState.paused ? '继续' : '暂停';
    setMusicStatus(musicState.paused ? '已暂停，点击“继续”恢复。' : '继续提交中…');
  }

  function downloadMusicCsv(kind) {
    const rows = kind === 'success' ? musicState.success : musicState.failed;
    const header = kind === 'success' ? ['store_id', 'material_id'] : ['store_id', 'reason'];
    const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [header, ...rows.map(row => kind === 'success'
      ? [row.storeId, row.materialId]
      : [row.storeId, row.reason])].map(row => row.map(escape).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `music-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function createMusicPanel() {
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) {
      existingPanel.querySelector(`#${MUSIC_STORE_TEXTAREA_ID}`)?.focus();
      return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = `${MUSIC_PANEL_CLASS} meiktv-batch-store-panel`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      <div class="meiktv-batch-store-panel__card meiktv-music-panel__card">
        <div class="meiktv-batch-store-panel__header">
          <strong>批量添加播放列表</strong>
          <button type="button" class="meiktv-batch-store-panel__close" aria-label="关闭">×</button>
        </div>
        <label class="meiktv-batch-store-panel__label" for="${MUSIC_STORE_TEXTAREA_ID}">store_id（多个数字用逗号分隔）</label>
        <textarea id="${MUSIC_STORE_TEXTAREA_ID}" class="meiktv-batch-store-panel__textarea meiktv-music-store-textarea" spellcheck="false" placeholder="127,128,129"></textarea>
        <div class="meiktv-music-fields">
          <label class="meiktv-music-material-field">素材 ID
            <input id="${MUSIC_MATERIAL_ID}" type="number" min="1" value="" placeholder="请输入素材页面 ID">
            <small>注意：这里填写素材页面的 ID，不是歌曲 ID</small>
          </label>
          <label>间隔(ms) <input id="${MUSIC_DELAY_ID}" type="number" min="100" step="100" value="300"></label>
        </div>
        <label class="meiktv-music-checkbox"><input id="${MUSIC_QUERY_EXISTING_ID}" type="checkbox" checked> 先查询，已有素材的门店跳过</label>
        <div id="${MUSIC_SUMMARY_ID}" class="meiktv-music-summary">请先预览列表</div>
        <div class="meiktv-music-actions">
          <button type="button" id="meiktv-music-preview" class="meiktv-batch-store-action meiktv-batch-store-action--select">预览去重结果</button>
          <button type="button" id="meiktv-music-start" class="meiktv-batch-store-action meiktv-batch-store-action--select">开始提交</button>
          <button type="button" id="meiktv-music-pause" class="meiktv-batch-store-action meiktv-batch-store-action--unselect" disabled>暂停</button>
        </div>
        <progress id="meiktv-music-progress" max="1" value="0"></progress>
        <div id="meiktv-music-current" class="meiktv-music-current">尚未开始</div>
        <div id="${MUSIC_STATUS_ID}" class="meiktv-batch-store-status meiktv-music-status" role="status"></div>
        <div class="meiktv-music-export-actions">
          <button type="button" id="${MUSIC_RETRY_ID}" class="meiktv-music-small-button" disabled>重试失败项</button>
          <button type="button" id="meiktv-music-export-success" class="meiktv-music-small-button">导出成功列表</button>
          <button type="button" id="meiktv-music-export-failed" class="meiktv-music-small-button">导出失败列表</button>
        </div>
      </div>
    `;

    panel.querySelector('.meiktv-batch-store-panel__close').addEventListener('click', closePanel);
    panel.querySelector('#meiktv-music-preview').addEventListener('click', () => {
      const parsed = updateMusicSummary();
      setMusicStatus(parsed.error || `已准备 ${parsed.ids.length} 家门店`, parsed.error ? 'error' : 'success');
    });
    panel.querySelector('#meiktv-music-start').addEventListener('click', () => {
      const parsed = updateMusicSummary();
      if (parsed.error) return setMusicStatus(parsed.error, 'error');
      runMusicBatch(parsed.ids);
    });
    panel.querySelector('#meiktv-music-pause').addEventListener('click', toggleMusicPause);
    panel.querySelector(`#${MUSIC_RETRY_ID}`).addEventListener('click', () => {
      const ids = musicState.failed.map(item => item.storeId);
      if (ids.length) runMusicBatch(ids, { retry: true });
    });
    panel.querySelector('#meiktv-music-export-success').addEventListener('click', () => downloadMusicCsv('success'));
    panel.querySelector('#meiktv-music-export-failed').addEventListener('click', () => downloadMusicCsv('failed'));
    panel.addEventListener('click', event => {
      if (event.target === panel) closePanel();
    });

    document.body.appendChild(panel);
    panel.querySelector(`#${MUSIC_STORE_TEXTAREA_ID}`).focus();
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function createPanel() {
    const existingPanel = document.getElementById(PANEL_ID);
    if (existingPanel) {
      existingPanel.querySelector(`#${TEXTAREA_ID}`)?.focus();
      return;
    }

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'meiktv-batch-store-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = `
      <div class="meiktv-batch-store-panel__card">
        <div class="meiktv-batch-store-panel__header">
          <strong>批量选中门店</strong>
          <button type="button" class="meiktv-batch-store-panel__close" aria-label="关闭">×</button>
        </div>
        <label class="meiktv-batch-store-panel__label" for="${TEXTAREA_ID}">
          门店名称数组
        </label>
        <textarea id="${TEXTAREA_ID}" class="meiktv-batch-store-panel__textarea" spellcheck="false" placeholder='["门店A", "门店B"]'></textarea>
        <div class="meiktv-batch-store-panel__hint">名称请使用门店标签中去掉“A-”或“B-”前缀后的文字。</div>
        <div id="${STATUS_ID}" class="meiktv-batch-store-status" role="status"></div>
        <div class="meiktv-batch-store-panel__actions">
          <button type="button" class="meiktv-batch-store-action meiktv-batch-store-action--select">选中门店</button>
          <button type="button" class="meiktv-batch-store-action meiktv-batch-store-action--unselect">取消选中</button>
        </div>
      </div>
    `;

    panel.querySelector('.meiktv-batch-store-panel__close').addEventListener('click', closePanel);
    panel.querySelector('.meiktv-batch-store-action--select').addEventListener('click', () => applyStoreSelection(true));
    panel.querySelector('.meiktv-batch-store-action--unselect').addEventListener('click', () => applyStoreSelection(false));
    panel.addEventListener('click', event => {
      if (event.target === panel) closePanel();
    });

    document.body.appendChild(panel);
    panel.querySelector(`#${TEXTAREA_ID}`).focus();
  }

  function findMusicAddButton() {
    return Array.from(document.querySelectorAll('button.el-button.el-button--primary.el-button--medium'))
      .find(button => button !== document.getElementById(BUTTON_ID) && button.textContent.trim().includes('添加')) || null;
  }

  function findSingerMergeButton() {
    return Array.from(document.querySelectorAll('button.el-button.el-button--primary.el-button--medium'))
      .find(button => button !== document.getElementById(BUTTON_ID) && button.textContent.trim().includes('歌手合并')) || null;
  }

  function placeMusicButton(button) {
    if (!button) return;
    const anchor = isMusicPage() ? findMusicAddButton() : (isSingerPage() ? findSingerMergeButton() : null);
    if (anchor && anchor.parentNode && (isSingerPage() ? anchor.previousElementSibling !== button : anchor.nextElementSibling !== button)) {
      if (isSingerPage()) anchor.insertAdjacentElement('beforebegin', button);
      else anchor.insertAdjacentElement('afterend', button);
    }
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    const musicPage = isMusicPage();
    const singerPage = isSingerPage();
    button.className = musicPage || singerPage
      ? `${musicPage ? 'meiktv-music-add-button' : 'meiktv-singer-add-button'} el-button el-button--primary el-button--medium`
      : 'meiktv-batch-store-button';
    if (musicPage) {
      button.innerHTML = '<span><i class="el-icon-circle-plus-outline mg-r5"></i>批量添加播放列表</span>';
      button.title = '批量添加播放列表';
      button.setAttribute('aria-label', '批量添加播放列表');
    } else if (singerPage) {
      button.innerHTML = '<span>批量添加歌手</span>';
      button.title = '批量添加歌手';
      button.setAttribute('aria-label', '批量添加歌手');
    } else {
      button.textContent = '批量选中门店';
      button.title = '批量选择或取消门店';
      button.setAttribute('aria-label', '批量选中门店');
    }
    button.addEventListener('click', () => {
      if (isMusicPage()) {
        createMusicPanel();
        return;
      }
      if (isSingerPage()) {
        createSingerPanel();
        return;
      }
      activateStoreSelectionMode();
      const radio = findSpecifiedStoreRadio();
      const trigger = radio || findDirectStoreHeading();
      const label = getSpecifiedStoreLabel(radio);
      (label || trigger)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      createPanel();
    });
    document.body.appendChild(button);
    placeMusicButton(button);
    console.info(DEBUG_PREFIX, `已显示“${musicPage ? '批量添加播放列表' : (singerPage ? '批量添加歌手' : '批量选中门店')}”按钮`);
    return button;
  }

  function syncButton() {
    const target = findButtonTrigger();
    const button = document.getElementById(BUTTON_ID);

    console.debug(DEBUG_PREFIX, '检测页面元素', {
      url: location.href,
      triggerFound: Boolean(target),
      customStoreTypeFound: Boolean(document.querySelector('input[name="row[store_type]"][value="3"]') || document.getElementById('row[store_type]-3')),
      directStoreHeadingFound: Boolean(findDirectStoreHeading()),
      musicPage: isMusicPage(),
      musicAddButtonFound: Boolean(isMusicPage() && findMusicAddButton()),
      singerPage: isSingerPage(),
      singerMergeButtonFound: Boolean(isSingerPage() && findSingerMergeButton()),
      storeCheckboxCount: getStoreCheckboxes().length
    });

    if (target && !button) {
      createButton();
    } else if (target && button && (isMusicPage() || isSingerPage())) {
      placeMusicButton(button);
    } else if (!target && button) {
      button.remove();
      closePanel();
    }
  }

  function start() {
    console.info(DEBUG_PREFIX, 'content script 已加载');
    if (isMusicPage() || isSingerPage()) refreshMusicAuth();
    syncButton();

    const observer = new MutationObserver(() => {
      window.clearTimeout(start.syncTimer);
      start.syncTimer = window.setTimeout(syncButton, 100);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
