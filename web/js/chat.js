/* Left column: conversation with cards. Input is a placeholder until A's intent parsing is wired in. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};

  function create(el) {
    el.innerHTML = `<div class="chat-log"></div>
      <form class="chat-in"><input placeholder="例如：我坐手动轮椅，想看看能不能自己上厕所" disabled title="自然语言输入在线上段接入">
      <button disabled>发送</button></form>`;
    const log = el.querySelector('.chat-log');
    const chat = {
      // card: { title, body (html), buttons: [{label, act, arg, primary}] }
      say(role, html, card) {
        const m = document.createElement('div');
        m.className = 'msg ' + role;
        m.innerHTML = (html ? `<p>${html}</p>` : '') + (card ? `<div class="mcard">${card.title ? `<b>${card.title}</b>` : ''}${card.body || ''}
          <div class="btns">${(card.buttons || []).map(b => `<button class="small ${b.primary ? 'primary' : ''}" data-act="${b.act}" data-arg="${b.arg ?? ''}">${b.label}</button>`).join('')}</div></div>` : '');
        log.appendChild(m); log.scrollTop = log.scrollHeight;
        return m;
      },
      clear() { log.innerHTML = ''; },
    };
    return chat;
  }

  HA.chat = { create };
})();
