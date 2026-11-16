// 禅道测试单列表（world: MAIN）：zentao.js 一次加载全部分页时会替换表格行，新行上的“概况”等 a.iframe
// 没有禅道原生弹窗的绑定。这里用禅道自己的 zui modalTrigger 重新绑定（参数与原生一致：type iframe），
// 这样点“概况”或双击行（zentao.js 会去点“概况”）弹出的就是禅道原生概况弹窗。
(function () {
  'use strict';
  if (!document.body || !document.body.classList.contains('m-testtask-browse')) return;

  function bind() {
    const $ = window.jQuery;
    if (!$ || !$.fn || !$.fn.modalTrigger) return;
    document.querySelectorAll('#taskList a.iframe').forEach(a => {
      if (!$(a).data('zui.modaltrigger')) $(a).modalTrigger({ type: 'iframe' });
    });
  }

  const table = document.getElementById('taskList');
  if (!table) return;
  bind();
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(bind, 50);
  }).observe(table, { childList: true, subtree: true });
})();
