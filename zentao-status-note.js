// 禅道测试单：开始 / 关闭 / 阻塞 时备注必填（m=testtask&f=start|close|block，概况弹窗里、列表操作列里点开的都是这几个页面）。
// 备注框是 KindEditor：编辑内容在 .ke-edit-iframe 里，提交时才同步回 textarea，所以两边都看。
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const ACTIONS = { start: '开始', close: '关闭', block: '阻塞' };
  if (params.get('m') !== 'testtask' || !ACTIONS[params.get('f')]) return;
  const actionName = ACTIONS[params.get('f')];

  function commentText() {
    const iframe = document.querySelector('.ke-edit-iframe');
    const body = iframe && iframe.contentDocument && iframe.contentDocument.body;
    if (body) {
      if (body.querySelector('img')) return '[图片]';
      const text = (body.innerText || body.textContent || '').replace(/ /g, ' ').trim();
      if (text) return text;
    }
    const textarea = document.querySelector('textarea[name="comment"]');
    const div = document.createElement('div');
    div.innerHTML = textarea ? textarea.value : '';
    return (div.textContent || '').replace(/ /g, ' ').trim();
  }

  function showError() {
    let tip = document.getElementById('mkz-note-required');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'mkz-note-required';
      tip.style.cssText = 'margin-top:6px;color:#e5484d;font-size:13px;font-weight:bold';
      const editor = document.querySelector('.ke-container') || document.querySelector('textarea[name="comment"]');
      if (editor) editor.insertAdjacentElement('afterend', tip);
      else document.body.prepend(tip);
    }
    tip.textContent = `${actionName}测试单必须填写备注，请写明原因或进展后再保存。`;
    const iframe = document.querySelector('.ke-edit-iframe');
    try { iframe?.contentWindow?.focus(); iframe?.contentDocument?.body?.focus(); } catch (_) { /* ignore */ }
  }

  function guard(e) {
    const form = document.querySelector('textarea[name="comment"]')?.form;
    if (!form) return;
    const isSubmitClick = e.type === 'click' && e.target.closest && e.target.closest('#submit, button[type="submit"], input[type="submit"]');
    const isFormSubmit = e.type === 'submit' && e.target === form;
    if (!isSubmitClick && !isFormSubmit) return;
    if (commentText()) {
      document.getElementById('mkz-note-required')?.remove();
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    showError();
  }

  // 捕获阶段拦截，先于禅道自己的提交处理
  window.addEventListener('click', guard, true);
  window.addEventListener('submit', guard, true);

  // 备注标题上标“必填”
  function markRequired() {
    const textarea = document.querySelector('textarea[name="comment"]');
    const th = textarea?.closest('tr')?.querySelector('th');
    if (th && !th.querySelector('.mkz-required')) {
      const star = document.createElement('span');
      star.className = 'mkz-required';
      star.textContent = '*';
      star.title = '必填';
      star.style.cssText = 'color:#e5484d;margin-right:2px';
      th.prepend(star);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', markRequired);
  else markRequired();
})();
