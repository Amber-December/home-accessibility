/* Left column: conversation with cards, and the natural-language input (read by intent.js, echoed before running). */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};

  function create(el, onSend) {
    el.innerHTML = `<div class="chat-log" role="log" aria-live="polite"></div>
      <form class="chat-in"><input aria-label="说说谁来住、想做什么、预算多少" placeholder="例如：我坐手动轮椅，想看看能不能自己上厕所" disabled>
      <button disabled>发送</button></form>`;
    const log = el.querySelector('.chat-log'), form = el.querySelector('form'), input = form.querySelector('input');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim(); if (!text) return;
      input.value = ''; onSend(text);
    });
    const chat = {
      // card: { title, body (html), buttons: [{label, act, arg, primary, disabled, title}] }
      say(role, html, card) {
        const m = document.createElement('div');
        m.className = 'msg ' + role;
        const btn = b => `<button class="small ${b.primary ? 'primary' : ''}" data-act="${b.act}" data-arg="${b.arg ?? ''}"${b.disabled ? ' disabled' : ''}${b.title ? ` title="${b.title}"` : ''}>${b.label}</button>`;
        m.innerHTML = (html ? `<p>${html}</p>` : '') + (card ? `<div class="mcard">${card.title ? `<b>${card.title}</b>` : ''}${card.body || ''}
          ${card.buttons && card.buttons.length ? `<div class="btns">${card.buttons.map(btn).join('')}</div>` : ''}</div>` : '');
        log.appendChild(m); log.scrollTop = log.scrollHeight;
        return m;
      },
      enable() { input.disabled = form.querySelector('button').disabled = false; },
      clear() { log.innerHTML = ''; },
    };
    return chat;
  }

  HA.chat = { create };
})();
