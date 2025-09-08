// ==UserScript==
// @name         attentus-cw-copy-timezest-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.2.0
// @description  One button: left-click copies Help Desk Team (30-min) TimeZest link; right-click copies Personal (30-min) link. Works on Ticket & Time Entry windows (reads Charge To). First click opens settings (or Shift-click anytime). Copies true HTML (“Schedule a time”) with plaintext URL fallback.
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

  // Known toolbar group ID from the clipboard bar script
  const CLIPBOARD_GROUP_ID = 'cw-notes-inline-copy-group';

  // URL building
  const BASE          = 'https://attentus.timezest.com/';
  const TEAM_PATH     = 'help-desk-team/phone-call-30'; // left-click: 30-min help-desk-team
  const PERSONAL_PATH = 'phone-call-30';                // right-click: 30-min personal

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
    if (!labelEl) return;
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

  // ----- robust Ticket ID getters (Ticket view or Time Entry view) -----
  function parseTicketId(raw) {
    if (!raw) return null;
    const m = String(raw).match(/(\d{5,})/); // 5+ digits
    return m ? m[1] : null;
  }

  function getTicketIdFromBanner() {
    const labels = $$('.cw_CwLabel,.gwt-Label').map(el => (el.textContent||'').trim());
    const line = labels.find(t => /service\s*ticket\s*#/i.test(t));
    if (!line) return null;
    const m = line.match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }

  function getTicketIdFromChargeToOnce() {
    // Time entry "Charge To" field
    const sel = 'input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"], input.GKV5JQ3DMVF.cw_ChargeToTextBox';
    const inp = document.querySelector(sel);
    if (!inp) return null;

    let id = parseTicketId(inp.value);        // prefer live property
    if (id) return id;

    const scope = inp.closest('td,div') || document; // hidden values near the widget
    const hid = scope.querySelector('input[type="hidden"][value], input[type="hidden"][name*="ChargeTo"]');
    id = parseTicketId(hid && hid.value);
    if (id) return id;

    const activeId = inp.getAttribute('aria-activedescendant'); // sometimes holds current suggestion
    if (activeId) {
      const activeEl = document.getElementById(activeId);
      id = parseTicketId(activeEl && activeEl.textContent);
      if (id) return id;
    }

    return null;
  }

  async function getTicketIdFromChargeToWait(timeoutMs = 5000) {
    const t0 = Date.now();
    return new Promise(resolve => {
      const iv = setInterval(() => {
        const id = getTicketIdFromChargeToOnce();
        if (id || (Date.now() - t0) > timeoutMs) {
          clearInterval(iv);
          resolve(id || null);
        }
      }, 150);
    });
  }

  async function getTicketId() {
    // 1) Ticket view banner fast path
    const fromBanner = getTicketIdFromBanner();
    if (fromBanner) return fromBanner;

    // 2) Time Entry window: read Charge To (with short wait)
    const fromChargeTo = getTicketIdFromChargeToOnce() || await getTicketIdFromChargeToWait(4000);
    return fromChargeTo || null;
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
        <div><strong>Left-click</strong>: copies the <em>Help Desk Team (30-min)</em> link as “Schedule a time”.</div>
        <div><strong>Right-click</strong>: copies your <em>Personal (30-min)</em> link as “Schedule a time”.</div>
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

  // ----- two button renderers -----
  function makeInlineButton() {
    // Matches the clipboard bar button look/spacing
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.textContent = 'Copy TimeZest';
    b.title = 'Left-click: Help Desk Team (30-min) • Right-click: Personal (30-min) • Shift-click: Settings';
    Object.assign(b.style, {
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,.2)',
      background: 'rgb(37,99,235)',
      color: '#fff',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap',
      height: '26px',
      lineHeight: '18px'
    });
    return b;
  }

  function makeActionButton() {
    // Native CW action button styling
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

    // Same handlers as inline, but label el differs
    wireHandlers(outer, btn, label);
    return outer;
  }

  function wireHandlers(clickTarget, pulseTarget, labelEl) {
    // Left-click: Team link
    clickTarget.addEventListener('click', async (e) => {
      e.preventDefault();

      // Shift-click opens settings anytime
      if (e.shiftKey) { openFlyout(); return; }

      // First click → onboard
      const onboarded = await getVal(K_ONBOARDED, '');
      if (!onboarded) { openFlyout(); return; }

      const tid = await getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }

      const url = teamUrl(tid);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(pulseTarget, labelEl, 'Copied'); else showToast('Copy failed');
    });

    // Right-click: Personal link
    clickTarget.addEventListener('contextmenu', async (e) => {
      e.preventDefault();

      const tid = await getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }

      let first = await getVal(K_FIRST, '');
      let last  = await getVal(K_LAST,  '');
      if (!first || !last) { openFlyout(); return; }

      const url = personalUrl(tid, first, last);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(pulseTarget, labelEl, 'Copied'); else showToast('Copy failed');
    });
  }

  function placeButton() {
    if ($('#' + BTN_ID)) return true;

    // 1) If the clipboard bar exists, append inline to maintain spacing/feel
    const group = $('#' + CLIPBOARD_GROUP_ID);
    if (group) {
      const b = makeInlineButton();
      // wire with itself as pulse target + "label"
      wireHandlers(b, b, b);
      group.appendChild(b);
      return true;
    }

    // 2) Otherwise, place as a CW action button after Clear Contact or Follow
    const anchor =
      $('#cw-clear-contact-btn') ||
      $$('.GMDB3DUBBPG').find(el => (txt(el).toLowerCase() === 'follow'))?.closest('.cw_CwActionButton');

    if (!anchor) return false;
    anchor.insertAdjacentElement('afterend', makeActionButton());
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

  addStyles();
  ensure();
})();
