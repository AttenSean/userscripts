// ==UserScript==
// @name         attentus-cw-time-entry-clipboard-bar
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.9.0
// @description  Clipboard buttons by the Notes timestamp (Signature, Review+Signature) with settings. Also mounts under Thread: Auto time entries (pod 16) on ticket pages. Disables on Time Sheet screens; prevents duplicate toolbars.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- constants ----------
  const DEFAULTS = {
    name: 'Sean Dill',
    headline: 'Your 5-star review has a big impact!',
    prefix: 'Please take a moment to ',
    linkText: 'leave a quick Google review.',
    suffix: '',
    closing: 'Mentioning my name helps me get recognized for the work I do, and it truly means a lot.',
    randomizeLocation: true,
    defaultLocation: 'bellevue',
  };
  const KEYS = {
    name:    'att_cw_agent_name',
    headline:'att_cw_review_headline',
    prefix:  'att_cw_review_prefix',
    link:    'att_cw_review_linktext',
    suffix:  'att_cw_review_suffix',
    closing: 'att_cw_review_closing',
    random:  'att_cw_randomize_location',
    defloc:  'att_cw_default_location',
  };
  const REVIEW_URLS = {
    bellevue: 'https://www.attentus.tech/bellevue_reviews',
    seattle:  'https://www.attentus.tech/seattle_reviews',
    tacoma:   'https://www.attentus.tech/tacoma_reviews',
    renton:   'https://www.attentus.tech/renton_reviews',
  };
  const LOCATIONS = Object.keys(REVIEW_URLS);

  // ---------- tiny utils ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // ---------- storage helpers ----------
  async function gmGet(key, defVal) {
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(key, defVal); } catch {}
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }
  async function gmSet(key, value) {
    try { if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(key, value); } catch {}
    try { if (typeof GM_setValue === 'function') return GM_setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  // ---------- clipboard ----------
  async function copyRich(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobTxt  = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobTxt })]);
        return { ok: true };
      }
    } catch {}
    try {
      if (typeof GM !== 'undefined' && GM?.setClipboard) {
        try { GM.setClipboard(html, 'html'); return { ok: true }; } catch {}
        try { GM.setClipboard(html, { type: 'html' }); return { ok: true }; } catch {}
      }
    } catch {}
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(html, 'html'); return { ok: true }; } } catch {}
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return { ok: true }; } } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.style.position = 'fixed'; ta.style.top = '-2000px';
      ta.value = text; document.body.appendChild(ta);
      ta.focus(); ta.select(); const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return { ok: true };
    } catch {}
    return { ok: false };
  }

  // ---------- view detection ----------
  function isTimesheetContext() {
    // Timesheet breadcrumb / containers (keeps toolbar off Daily/Weekly Time sheets)
    const crumbs = Array.from(document.querySelectorAll('.cw-main-banner .navigationEntry, .cw-main-banner .cw_CwLabel'))
      .map(e => (e.textContent || '').trim().toLowerCase());
    if (crumbs.some(t => t.includes('open time sheets') || t === 'time sheet')) return true;
    if (document.querySelector('.mytimesheetlist, .TimeSheet')) return true;
    return false;
  }

  // ---------- locate anchors ----------
  // A) Classic Notes timestamp button on legacy time-entry form
  function findNotesTimestampButton() {
    const stamps = document.querySelectorAll('.cw_ToolbarButton_TimeStamp');
    for (const st of stamps) {
      const row = st.closest('tr');
      const label = row && row.querySelector('.gwt-Label, .mm_label, .cw_CwLabel');
      if (label && /notes$/i.test((label.textContent || '').trim())) return st;
    }
    return null;
  }

  // B) Thread: Auto time entries pod (pod 16) — mount just below header (host page, not inside iframe)
  function findThreadTimepadHeader() {
    // stable CW hosted pod header for Thread: Auto time entries
    return document.querySelector('.mm_podHeader.pod_hosted_16_header');
  }
  function threadTimepadMountTarget() {
    const header = findThreadTimepadHeader();
    if (!header) return null;

    // Prefer a slim inline mount just after the header’s built-in toolbar region if present,
    // otherwise insert a small strip immediately after the header block.
    // We avoid the cross-origin iframe entirely.
    const toolbar = header.querySelector('.mm_toolbar') || header; // best-effort
    return toolbar;
  }

  // ---------- content builders ----------
  function signatureHTML(name, { spacedThankYou = false } = {}) {
    const n = esc(name);
    return [
      `<div style="margin:0;line-height:1.35">`,
      `<div style="margin:0">Thank you,</div>`,
      spacedThankYou ? `<div style="margin:0"><br></div>` : ``,
      `<div style="margin:0"><strong>${n}</strong></div>`,
      `<div style="margin:0">Attentus Technologies</div>`,
      `<div style="margin:0"><strong>Support:</strong> (253) 218-6015 x1</div>`,
      `<div style="margin:0"><strong>Call</strong> or <strong>Text Us:</strong> (253) 218-6015</div>`,
      `</div>`
    ].join('');
  }
  function signatureText(name, { spacedThankYou = false } = {}) {
    const lines = [
      'Thank you,',
      spacedThankYou ? '' : null,
      name,
      'Attentus Technologies',
      'Support: (253) 218-6015 x1',
      'Call or Text Us: (253) 218-6015'
    ].filter(v => v !== null);
    return lines.join('\n');
  }

  async function getReviewMsg() {
    const headline = await gmGet(KEYS.headline, DEFAULTS.headline);
    const prefix   = await gmGet(KEYS.prefix,   DEFAULTS.prefix);
    const linkText = await gmGet(KEYS.link,     DEFAULTS.linkText);
    const suffix   = await gmGet(KEYS.suffix,   DEFAULTS.suffix);
    const closing  = await gmGet(KEYS.closing,  DEFAULTS.closing);
    return { headline, prefix, linkText, suffix, closing };
  }

  function reviewHTMLParts(url, { headline, prefix, linkText, suffix, closing }) {
    const safe = (s) => esc(String(s||''));
    return [
      `<div style="margin:0"><strong>${safe(headline)}</strong></div>`,
      `<div style="margin:0">${safe(prefix)}<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${safe(linkText)}</a>${safe(suffix)}</div>`,
      `<div style="margin:0">${safe(closing)}</div>`
    ].join('');
  }
  function reviewTextParts(url, { headline, prefix, linkText, suffix, closing }) {
    const lines = [
      headline,
      `${prefix}${linkText} ${url}${suffix ? ' ' + suffix : ''}`,
      closing
    ].filter(Boolean);
    return lines.join('\n');
  }

  // ---------- inline UI (single instance) ----------
  const GROUP_ID = 'cw-notes-inline-copy-group';

  function mkBtn(label, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    Object.assign(b.style, {
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,.2)',
      background: 'rgb(37,99,235)',
      color: '#fff',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap'
    });
    b.addEventListener('click', handler);
    return b;
  }
  function mkIconBtn(label, title, handler) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      padding: '0 6px',
      height: '26px',
      lineHeight: '26px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,.2)',
      background: '#fff',
      color: '#111',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      cursor: 'pointer',
      userSelect: 'none',
      whiteSpace: 'nowrap'
    });
    b.addEventListener('click', handler);
    return b;
  }

  function getReviewUrlFrom(sel) {
    return REVIEW_URLS[sel.value] || REVIEW_URLS.bellevue;
  }

  async function buildGroupChildren(intoWrap) {
    // location dropdown
    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="bellevue">Bellevue</option>
      <option value="seattle">Seattle</option>
      <option value="tacoma">Tacoma</option>
      <option value="renton">Renton</option>
    `;
    Object.assign(sel.style, {
      height: '26px', padding: '0 6px',
      border: '1px solid rgba(0,0,0,.2)', borderRadius: '6px',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });

    // choose initial value (settings)
    const randomOn = await gmGet(KEYS.random, DEFAULTS.randomizeLocation);
    const defloc   = await gmGet(KEYS.defloc, DEFAULTS.defaultLocation);
    sel.value = randomOn ? rand(LOCATIONS) : (LOCATIONS.includes(defloc) ? defloc : DEFAULTS.defaultLocation);

    const settingsBtn = mkIconBtn('⚙︎', 'Set name, review message, and default location', showSettings);
    const sigBtn  = mkBtn('Copy signature', async () => {
      const name = await gmGet(KEYS.name, DEFAULTS.name);
      const html = signatureHTML(name, { spacedThankYou: true });
      const text = signatureText(name,  { spacedThankYou: true });
      const res  = await copyRich(html, text);
      toast(res.ok ? 'Copied signature' : 'Copy failed');
    });
    const bothBtn = mkBtn('Copy review + signature', async () => {
      const name   = await gmGet(KEYS.name, DEFAULTS.name);
      const parts  = await getReviewMsg();
      const url    = getReviewUrlFrom(sel);
      const revH   = reviewHTMLParts(url, parts);
      const revT   = reviewTextParts(url, parts);
      const sigH   = signatureHTML(name, { spacedThankYou: false });
      const sigT   = signatureText(name,  { spacedThankYou: false });
      const html   = `<div style="margin:0;line-height:1.35">${revH}<div style="margin:0"><br></div>${sigH}</div>`;
      const text   = [revT, '', sigT].join('\n');
      const res    = await copyRich(html, text);
      toast(res.ok ? 'Copied review + signature' : 'Copy failed');
    });

    intoWrap.append(sel, settingsBtn, sigBtn, bothBtn);
  }

  // Build wrapper next to a button (legacy timestamp)
  async function mountGroupAfterButton(nextToStamp) {
    // If an existing group isn't adjacent to this stamp, move it.
    const existing = document.getElementById(GROUP_ID);
    if (existing) {
      if (existing.previousElementSibling === nextToStamp) return true;
      existing.remove();
    }

    const wrap = document.createElement('span');
    wrap.id = GROUP_ID;
    Object.assign(wrap.style, {
      display: 'inline-flex', gap: '6px', marginLeft: '8px',
      verticalAlign: 'middle', alignItems: 'center', whiteSpace: 'nowrap'
    });

    // ensure timestamp TD doesn’t wrap
    const td = nextToStamp.closest('td'); if (td) td.style.whiteSpace = 'nowrap';
    nextToStamp.style.display = 'inline-block';
    nextToStamp.insertAdjacentElement('afterend', wrap);

    await buildGroupChildren(wrap);
    return true;
  }

  // Build wrapper under/after a pod header (Thread pod 16)
  async function mountGroupUnderHeader(headerOrToolbar) {
    const existing = document.getElementById(GROUP_ID);
    if (existing) {
      // If we already sit right after this header/toolbar, keep it
      if (existing.previousElementSibling === headerOrToolbar) return true;
      existing.remove();
    }

    const strip = document.createElement('div');
    strip.id = GROUP_ID;
    Object.assign(strip.style, {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '6px 8px', marginTop: '6px',
      background: 'rgba(17,24,39,.04)', border: '1px solid rgba(0,0,0,.08)',
      borderRadius: '8px'
    });

    headerOrToolbar.insertAdjacentElement('afterend', strip);
    await buildGroupChildren(strip);
    return true;
  }

  // ---------- settings panel ----------
  function closeModal(el) { el?.remove(); }
  function toast(msg, ms = 1100) {
    const n = document.createElement('div');
    n.textContent = msg;
    Object.assign(n.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483646,
      background: '#111827', color: '#fff', padding: '8px 10px',
      borderRadius: '8px', border: '1px solid rgba(255,255,255,.25)',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  async function showSettings() {
    const name     = await gmGet(KEYS.name,     DEFAULTS.name);
    const headline = await gmGet(KEYS.headline, DEFAULTS.headline);
    const prefix   = await gmGet(KEYS.prefix,   DEFAULTS.prefix);
    const linkText = await gmGet(KEYS.link,     DEFAULTS.linkText);
    const suffix   = await gmGet(KEYS.suffix,   DEFAULTS.suffix);
    const closing  = await gmGet(KEYS.closing,  DEFAULTS.closing);
    const randomOn = await gmGet(KEYS.random,   DEFAULTS.randomizeLocation);
    const defloc   = await gmGet(KEYS.defloc,   DEFAULTS.defaultLocation);

    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 2147483646 });
    const modal = document.createElement('div');
    Object.assign(modal.style, {
      position: 'fixed', left: '50%', top: '14%', transform: 'translateX(-50%)',
      minWidth: '320px', maxWidth: '460px', background: '#0b1220', color: '#fff',
      borderRadius: '12px', padding: '12px', border: '1px solid rgba(255,255,255,.18)',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)', font: '13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    modal.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Clipboard Bar Settings</div>
      <label style="display:block;margin:6px 0">Name<br><input id="att_name" style="width:100%" value="${esc(name)}"></label>
      <label style="display:block;margin:6px 0">Headline<br><input id="att_headline" style="width:100%" value="${esc(headline)}"></label>
      <label style="display:block;margin:6px 0">Prefix<br><input id="att_prefix" style="width:100%" value="${esc(prefix)}"></label>
      <label style="display:block;margin:6px 0">Link text<br><input id="att_linktext" style="width:100%" value="${esc(linkText)}"></label>
      <label style="display:block;margin:6px 0">Suffix (optional)<br><input id="att_suffix" style="width:100%" value="${esc(suffix)}"></label>
      <label style="display:block;margin:6px 0">Closing<br><input id="att_closing" style="width:100%" value="${esc(closing)}"></label>
      <label style="display:flex;align-items:center;gap:8px;margin:8px 0">
        <input id="att_random" type="checkbox" ${randomOn ? 'checked' : ''}> Randomize location
      </label>
      <label id="att_defloc_label" style="display:block;margin:6px 0">Default location
        <select id="att_defloc" style="width:100%">
          <option value="bellevue">Bellevue</option>
          <option value="seattle">Seattle</option>
          <option value="tacoma">Tacoma</option>
          <option value="renton">Renton</option>
        </select>
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
        <button id="att_reset">Reset</button>
        <button id="att_cancel">Cancel</button>
        <button id="att_save" style="background:#2563eb;color:#fff;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:4px 10px">Save</button>
      </div>
    `;
    const defSel = modal.querySelector('#att_defloc');
    const defLabel = modal.querySelector('#att_defloc_label');
    const randomCb = modal.querySelector('#att_random');
    defSel.value   = defloc;
    randomCb.checked = !!randomOn;

    function syncDefLocVisibility() {
      const on = randomCb.checked;
      defSel.disabled = on;
      defSel.style.opacity = on ? '0.5' : '1';
      defLabel.style.opacity = on ? '0.5' : '1';
    }
    randomCb.addEventListener('change', syncDefLocVisibility);
    syncDefLocVisibility();

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('#att_cancel').onclick = () => closeModal(overlay);
    modal.querySelector('#att_reset').onclick  = async () => {
      for (const [k, v] of Object.entries({
        [KEYS.name]: DEFAULTS.name,
        [KEYS.headline]: DEFAULTS.headline,
        [KEYS.prefix]: DEFAULTS.prefix,
        [KEYS.link]: DEFAULTS.linkText,
        [KEYS.suffix]: DEFAULTS.suffix,
        [KEYS.closing]: DEFAULTS.closing,
        [KEYS.random]: DEFAULTS.randomizeLocation,
        [KEYS.defloc]: DEFAULTS.defaultLocation,
      })) await gmSet(k, v);
      toast('Defaults restored');
      closeModal(overlay);
    };
    modal.querySelector('#att_save').onclick   = async () => {
      const v = id => modal.querySelector(id).value;
      await gmSet(KEYS.name,     (v('#att_name')     || '').trim()      || DEFAULTS.name);
      await gmSet(KEYS.headline, (v('#att_headline') || '').trim()      || DEFAULTS.headline);
      await gmSet(KEYS.prefix,    v('#att_prefix')   ?? DEFAULTS.prefix);
      await gmSet(KEYS.link,     (v('#att_linktext') || '').trim()      || DEFAULTS.linkText);
      await gmSet(KEYS.suffix,    v('#att_suffix')   ?? '');
      await gmSet(KEYS.closing,  (v('#att_closing')  || '').trim()      || DEFAULTS.closing);
      await gmSet(KEYS.random,   !!randomCb.checked);
      await gmSet(KEYS.defloc,   defSel.value || DEFAULTS.defaultLocation);
      toast('Settings saved');
      closeModal(overlay);
    };
  }

  // ---------- orchestrate ----------
  function removeGroupIfAny() {
    const ex = document.getElementById(GROUP_ID);
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
  }

  async function ensure() {
    // Do NOT show on timesheet-derived screens
    if (isTimesheetContext()) { removeGroupIfAny(); return; } // gating preserved

    // Primary anchor: legacy Notes timestamp
    const stamp = findNotesTimestampButton();
    if (stamp) { await mountGroupAfterButton(stamp); return; }

    // Fallback: Thread Auto time entries pod (pod 16) on ticket pages
    const tpHeader = threadTimepadMountTarget();
    if (tpHeader) { await mountGroupUnderHeader(tpHeader); return; }

    // Otherwise, remove if present
    removeGroupIfAny();
  }

  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ensure();
})();
