// ==UserScript==
// @name         attentus-cw-copy-timezest-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.1.1
// @description  One button: left-click copies Help Desk Team (30-min) TimeZest link; right-click copies Personal (30-min) link. First click opens settings flyout to set tech name. Copies true HTML ("Schedule a time") with plaintext URL fallback.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID   = 'cw-copy-timezest-btn';
  const FLY_ID   = 'cw-timezest-flyout';
  const CSS_ID   = 'cw-timezest-styles';

  // URL building
  const BASE          = 'https://attentus.timezest.com/';
  const TEAM_PATH     = 'help-desk-team/phone-call-30'; // left-click: keep existing help-desk-team path
  const PERSONAL_PATH = 'phone-call-30';                // right-click

  // storage keys
  const K_FIRST = 'tz_firstname';
  const K_LAST  = 'tz_lastname';
  const K_ONBOARDED = 'tz_onboarded_v2';

  // ----- tiny helpers -----
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function addStyles() {
    if ($( '#' + CSS_ID )) return;
    const css = document.createElement('style');
    css.id = CSS_ID;
    css.textContent = `
      @keyframes tzPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .tz-flash { animation: tzPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset; border-radius: 6px; }

      /* popover */
      #${FLY_ID} {
        position: fixed; top: 14%; left: 50%; transform: translateX(-50%);
        z-index: 2147483646; min-width: 320px; max-width: 420px;
        background: #0b1220; color: #fff; border: 1px solid rgba(255,255,255,.18);
        border-radius: 12px; padding: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.35);
        font: 13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
      }
      #${FLY_ID} h3 { margin: 0 0 8px 0; font-size: 14px; display:flex; justify-content:space-between; align-items:center; }
      #${FLY_ID} a { color: #93c5fd; text-decoration: none; }
      #${FLY_ID} .row { display:flex; gap:8px; margin: 6px 0; }
      #${FLY_ID} input[type="text"] {
        width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22); background:#0e1628; color:#fff;
      }
      #${FLY_ID} .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
      #${FLY_ID} button {
        padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22);
        background:#2563eb; color:#fff; cursor:pointer;
      }
      #${FLY_ID} .secondary { background:#111827; }
      #${FLY_ID} .explainer { color:#cbd5e1; font-size:12px; margin-top:6px; line-height:1.35; }
    `;
    document.head.appendChild(css);
  }

  function showToast(msg) {
    const n = document.createElement('div');
    n.textContent = msg;
    Object.assign(n.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483646,
      background: '#111827', color: '#fff', padding: '8px 10px',
      borderRadius: '8px', border: '1px solid rgba(255,255,255,.2)'
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1400);
  }

  function flashCopied(btnRoot, labelEl, customText) {
    const original = labelEl.textContent;
    labelEl.textContent = customText || 'Copied';
    btnRoot.classList.add('tz-flash');
    setTimeout(() => { labelEl.textContent = original; btnRoot.classList.remove('tz-flash'); }, 900);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // Build a safe HTML link label (rich clipboard) with plaintext fallback URL separately
  function htmlLink(url, label='Schedule a time') {
    return `<a href="${url}">${escapeHtml(label)}</a>`;
  }

  function slug(s) {
    return String(s||'').trim().toLowerCase().replace(/[^a-z]+/g,'-').replace(/^-+|-+$/g,'');
  }

  function getTicketId() {
    const line = $$('.cw_CwLabel,.gwt-Label').map(txt)
      .find(t => /service\s*ticket\s*#\s*\d+/i.test(t||''));
    const m = line && line.match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }

  // ----- storage (VM/TM + fallback) -----
  async function getVal(key, def='') {
    try {
      if (typeof GM !== 'undefined' && GM?.getValue) return await GM.getValue(key, def);
      if (typeof GM_getValue === 'function') return GM_getValue(key, def);
    } catch {}
    const v = localStorage.getItem(key);
    return v == null ? def : v;
  }
  async function setVal(key, val) {
    try {
      if (typeof GM !== 'undefined' && GM?.setValue) return await GM.setValue(key, val);
      if (typeof GM_setValue === 'function') return GM_setValue(key, val);
    } catch {}
    localStorage.setItem(key, val);
  }

  // ----- clipboard (prefer true HTML) -----
  async function copyRich(html, text) {
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch {}
    try {
      if (typeof GM !== 'undefined' && GM?.setClipboard) {
        try { GM.setClipboard(html, 'html'); return true; } catch {}
        try { GM.setClipboard(html, { type:'html' }); return true; } catch {}
      }
    } catch {}
    try {
      if (typeof GM_setClipboard === 'function') { GM_setClipboard(html, 'html'); return true; }
    } catch {}
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.style.position='fixed'; ta.style.top='-2000px'; ta.value=text;
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}
    return false;
  }

  // ----- URL builders -----
  function teamUrl(tid) { return `${BASE}${TEAM_PATH}/ticket/${tid}`; }
  function personalUrl(tid, first, last) {
    const s = `${slug(first)}-${slug(last)}`;
    return `${BASE}${s}/${PERSONAL_PATH}/ticket/${tid}`;
  }

  // ----- flyout -----
  function openFlyout() {
    addStyles();
    const existing = $('#'+FLY_ID);
    if (existing) { existing.remove(); }

    const el = document.createElement('div');
    el.id = FLY_ID;

    el.innerHTML = `
      <h3>
        TimeZest Settings
        <a href="#" id="${FLY_ID}-close" aria-label="Close">✕</a>
      </h3>
      <div class="row">
        <input id="${FLY_ID}-first" type="text" placeholder="First name">
        <input id="${FLY_ID}-last"  type="text" placeholder="Last name">
      </div>
      <div class="explainer">
        <div><strong>Left-click</strong>: copies the <em>Help Desk Team (30-min)</em> link.</div>
        <div><strong>Right-click</strong>: copies your <em>Personal (30-min)</em> link.</div>
        <div>Need a different duration? Use the TimeZest pod in ConnectWise.</div>
        <div>You can reopen this panel anytime by <strong>Shift-clicking</strong> the button.</div>
      </div>
      <div class="actions">
        <button class="secondary" id="${FLY_ID}-cancel">Close</button>
        <button id="${FLY_ID}-save">Save</button>
      </div>
    `;

    document.body.appendChild(el);

    // preload
    (async () => {
      $('#'+FLY_ID+'-first').value = (await getVal(K_FIRST, '')) || '';
      $('#'+FLY_ID+'-last').value  = (await getVal(K_LAST,  '')) || '';
    })();

    const close = () => el.remove();
    $('#'+FLY_ID+'-close').addEventListener('click', (e)=>{ e.preventDefault(); close(); });
    $('#'+FLY_ID+'-cancel').addEventListener('click', (e)=>{ e.preventDefault(); close(); });

    $('#'+FLY_ID+'-save').addEventListener('click', async (e) => {
      e.preventDefault();
      const first = $('#'+FLY_ID+'-first').value.trim();
      const last  = $('#'+FLY_ID+'-last').value.trim();
      await setVal(K_FIRST, first);
      await setVal(K_LAST,  last);
      await setVal(K_ONBOARDED, '1');
      close();
      showToast('Saved TimeZest name');
    });

    return el;
  }

  // ----- one CW-style button -----
  function makeButton() {
    addStyles();

    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = 'Copy TimeZest';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    outer.title = 'Left-click: Help Desk Team (30-min) • Right-click: Personal (30-min) • Shift-click: Settings';

    // Left-click: Team link
    outer.addEventListener('click', async (e) => {
      e.preventDefault();

      // Shift-click opens settings anytime
      if (e.shiftKey) { openFlyout(); return; }

      // First time -> force settings flyout
      const onboarded = await getVal(K_ONBOARDED, '');
      if (!onboarded) { openFlyout(); return; }

      const tid = getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }
      const url = teamUrl(tid);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(btn, label, 'Copied'); else showToast('Copy failed');
    });

    // Right-click: Personal link
    outer.addEventListener('contextmenu', async (e) => {
      e.preventDefault();

      const tid = getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }

      let first = await getVal(K_FIRST, '');
      let last  = await getVal(K_LAST,  '');
      if (!first || !last) { openFlyout(); return; }

      const url = personalUrl(tid, first, last);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(btn, label, 'Copied'); else showToast('Copy failed');
    });

    return outer;
  }

  function placeButton() {
    if ($('#' + BTN_ID)) return true;

    // Prefer after Clear Contact; else after Follow
    const anchor =
      $('#cw-clear-contact-btn') ||
      $$('.GMDB3DUBBPG').find(el => (txt(el).toLowerCase() === 'follow'))?.closest('.cw_CwActionButton');

    if (!anchor) return false;

    anchor.insertAdjacentElement('afterend', makeButton());
    return true;
  }

  function ensure() { placeButton(); }

  // SPA-safe
  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);

  ensure();
})();
