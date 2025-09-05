// ==UserScript==
// @name         attentus-cw-time-entry-clipboard-bar
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.7.0
// @description  Inline clipboard buttons by the Notes timestamp: copy Signature, Signature+Review, or Review; settings flyout (name, text, random/default location) with GM storage.
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

  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
    return [
      `<div style="margin:0;line-height:1.35">`,
      `<div style="margin:0">—</div>`,
      `<div style="margin:0"><strong>${esc(headline)}</strong></div>`,
      `<div style="margin:0">${esc(prefix)}<a href="${url}">${esc(linkText)}</a>${esc(suffix)}</div>`,
      `<div style="margin:0">${esc(closing)}</div>`,
      `</div>`
    ].join('');
  }
  function reviewTextParts(_url, { headline, prefix, linkText, suffix, closing }) {
    return ['—', headline, `${prefix}${linkText}${suffix}`, closing].join('\n');
  }

  // ---------- toasts ----------
  function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
      zIndex: 2147483646, background: '#111827', color: '#fff',
      padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,.2)',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; setTimeout(() => t.remove(), 250); }, 1100);
  }

  // ---------- locate timestamp button ----------
  function findNotesTimestampButton() {
    const stamps = document.querySelectorAll('.cw_ToolbarButton_TimeStamp');
    for (const st of stamps) {
      const row = st.closest('tr');
      const label = row && row.querySelector('.gwt-Label, .mm_label, .cw_CwLabel');
      if (label && /notes$/i.test((label.textContent || '').trim())) return st;
    }
    return null;
  }
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  // ---------- settings panel ----------
  function closeModal(el) { el?.remove(); }
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
      position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
      width: 'min(560px, 92vw)', background: '#fff', color: '#111',
      borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,.2)',
      padding: '16px', font: '13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    modal.innerHTML = `
      <div style="font-weight:600; font-size:14px; margin-bottom:10px;">Clipboard Bar Settings</div>
      <div style="display:grid; grid-template-columns:180px 1fr; gap:8px; align-items:center;">
        <label>Name</label>
        <input type="text" id="att_name" value="${esc(name)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <div style="grid-column:1/-1; height:1px; background:#eee; margin:6px 0;"></div>

        <label>Headline</label>
        <input type="text" id="att_headline" value="${esc(headline)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <label>Prefix</label>
        <input type="text" id="att_prefix" value="${esc(prefix)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <label>Link text</label>
        <input type="text" id="att_linktext" value="${esc(linkText)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <label>Suffix</label>
        <input type="text" id="att_suffix" value="${esc(suffix)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <label>Closing</label>
        <input type="text" id="att_closing" value="${esc(closing)}" style="padding:6px; border:1px solid #ccc; border-radius:6px;">

        <div style="grid-column:1/-1; height:1px; background:#eee; margin:6px 0;"></div>

        <label>Randomize location on open</label>
        <label style="display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="att_random" ${randomOn ? 'checked' : ''}>
          <span style="color:#555;">Pick a random location each time the toolbar appears</span>
        </label>

        <label id="att_defloc_label">Default location</label>
        <select id="att_defloc" style="height:30px; padding:0 6px; border:1px solid #ccc; border-radius:6px;">
          <option value="bellevue">Bellevue</option>
          <option value="seattle">Seattle</option>
          <option value="tacoma">Tacoma</option>
          <option value="renton">Renton</option>
        </select>
      </div>
      <div style="font-size:12px; color:#555; margin-top:8px;">
        Middle line renders as: <code>Prefix</code> + <code>&lt;a href="LOCATION_URL"&gt;Link text&lt;/a&gt;</code> + <code>Suffix</code>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
        <button id="att_reset" style="padding:6px 10px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:pointer;">Reset defaults</button>
        <button id="att_cancel" style="padding:6px 10px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:pointer;">Cancel</button>
        <button id="att_save"   style="padding:6px 10px; border:1px solid rgba(0,0,0,.2); border-radius:6px; background:#2563eb; color:#fff; cursor:pointer;">Save</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const defSel   = modal.querySelector('#att_defloc');
    const defLabel = modal.querySelector('#att_defloc_label');
    defSel.value   = defloc;

    const randomCb = modal.querySelector('#att_random');
    function syncDefLocVisibility() {
      const on = randomCb.checked;
      defSel.disabled = on;
      defSel.style.opacity = on ? '0.5' : '1';
      defLabel.style.opacity = on ? '0.5' : '1';
    }
    randomCb.addEventListener('change', syncDefLocVisibility);
    syncDefLocVisibility();

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
      const v = id => modal.querySelector(id);
      await gmSet(KEYS.name,     v('#att_name').value.trim()      || DEFAULTS.name);
      await gmSet(KEYS.headline, v('#att_headline').value.trim()  || DEFAULTS.headline);
      await gmSet(KEYS.prefix,   v('#att_prefix').value.trim()    || DEFAULTS.prefix);
      await gmSet(KEYS.link,     v('#att_linktext').value.trim()  || DEFAULTS.linkText);
      await gmSet(KEYS.suffix,   v('#att_suffix').value.trim());
      await gmSet(KEYS.closing,  v('#att_closing').value.trim()   || DEFAULTS.closing);
      await gmSet(KEYS.random,   !!v('#att_random').checked);
      await gmSet(KEYS.defloc,   defSel.value || DEFAULTS.defaultLocation);
      toast('Settings saved');
      closeModal(overlay);
    };
  }

  // ---------- inline UI next to Notes timestamp ----------
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

  async function buildGroupElements() {
    const wrap = document.createElement('span');
    wrap.id = GROUP_ID;
    Object.assign(wrap.style, {
      display: 'inline-flex', gap: '6px', marginLeft: '8px',
      verticalAlign: 'middle', alignItems: 'center', whiteSpace: 'nowrap'
    });

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

    // choose initial value
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

    wrap.append(sel, settingsBtn, sigBtn, bothBtn);
    return wrap;
  }

  function placeGroup() {
    if (document.getElementById(GROUP_ID)) return true;
    const stamp = findNotesTimestampButton();
    if (!stamp) return false;
    const td = stamp.closest('td'); if (td) td.style.whiteSpace = 'nowrap';
    stamp.style.display = 'inline-block';
    buildGroupElements().then(el => stamp.insertAdjacentElement('afterend', el));
    return true;
  }

  function ensure() { placeGroup(); }
  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });
  ensure();
})();
