// ==UserScript==
// @name         attentus-cw-copy-ticket-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.4.0
// @description  Copy ticket link. Left-click = quick link. Right-click = detailed (newline: Company — Contact). No Insight pod dependency.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-link.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-link.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'cw-copy-ticket-link-btn';

  // ------- utils -------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function ensureFlashStyles() {
    if (document.getElementById('cw-copy-flash-styles')) return;
    const css = document.createElement('style');
    css.id = 'cw-copy-flash-styles';
    css.textContent = `
      @keyframes cwFlashPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .cw-flash-pulse { animation: cwFlashPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset; border-radius: 6px; }
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
    setTimeout(() => n.remove(), 1200);
  }
  function flashCopied(btnRoot, labelEl) {
    if (!labelEl) return;
    const original = labelEl.textContent;
    labelEl.textContent = 'Copied';
    btnRoot.classList.add('cw-flash-pulse');
    btnRoot.setAttribute('aria-live', 'polite');
    setTimeout(() => { labelEl.textContent = original; btnRoot.classList.remove('cw-flash-pulse'); }, 900);
  }

  // ------- ticket basics -------
  function getBannerLine() {
    return $$('.cw_CwLabel,.gwt-Label').map(txt)
      .find(t => /service\s*ticket\s*#\s*\d+/i.test(t || '')) || '';
  }
  function getTicketIdFromBanner() {
    const m = getBannerLine().match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }
  function getSummaryFromBannerFull() {
    const m = getBannerLine().match(/#\s*\d+\s*-\s*(.+)$/);
    return m ? m[1].trim() : '';
  }
  function getLabelFromTitle() {
    let t = (document.title || '').trim();
    if (!t) return '';
    t = t.replace(/\s*[|\-–—]\s*ConnectWise.*$/i, '').trim();
    if (/^#\d+/.test(t)) return t;
    const m = t.match(/#\s*(\d{3,})\s*-\s*(.+)$/);
    if (m) return `#${m[1]} - ${m[2].trim()}`;
    return '';
  }
  function getNeedByTag() {
    const rows = $$('.gwt-Label, .mm_label, .detailLabel, .cw_CwLabel');
    for (const el of rows) {
      const t = txt(el).toLowerCase();
      if (!t) continue;
      if (t.includes('need by') || t.includes('required date') || t.includes('due date')) {
        const container = el.closest('tr,div,td') || el.parentElement;
        const val = container && txt(container.querySelector('.GMDB3DUBCPD, .GMDB3DUBBPD, .GMDB3DUBCEI, .cw_CwTextField, .gwt-HTML, .gwt-Label, span, div:last-child'));
        if (!val) continue;
        const m = val.match(/(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?/);
        if (m) return `<Need by ${+m[1]}/${+m[2]}>`;
      }
    }
    return '';
  }
  function buildBaseLabel() {
    const id   = getTicketIdFromBanner() || '????';
    const need = getNeedByTag();
    const fullFromBanner = getSummaryFromBannerFull();
    const base = fullFromBanner ? `#${id} - ${fullFromBanner}` : (getLabelFromTitle() || `#${id}`);
    return need ? `${base} ${need}` : base;
  }

  // ------- Company / Contact -------
  function getContactName() {
    const valOf = (sel) => $(sel)?.value?.trim() || '';
    return (
      valOf('input.cw_contact') ||
      valOf('[data-cwid="contact"] input[readonly]') ||
      valOf('[data-cwid="contact"] input') ||
      ''
    );
  }
  function getCompanyName() {
    const valOf = (sel) => $(sel)?.value?.trim() || '';
    let v =
      valOf('input.cw_company') ||
      valOf('[data-cwid="company"] input[readonly]') ||
      valOf('[data-cwid="company"] input');
    if (v) return v;

    // label/link fallback
    const label = $$('td,div,span').find(n => /(^|\s)company[:\s]*$/i.test(txt(n)));
    if (label) {
      const container = label.closest('tr,div,td') || label.parentElement;
      const linkish = container && (container.querySelector('a, .gwt-Label, .gwt-HTML, span:last-child'));
      v = txt(linkish);
    }
    return v || '';
  }

  // ------- clipboard -------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }
  async function copyRich(html, text) {
    try {
      if (navigator.clipboard?.write && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        return { ok: true, via: 'ClipboardItem' };
      }
    } catch {}
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.setClipboard === 'function') {
        try { GM.setClipboard(html, 'html'); return { ok: true, via: "GM.setClipboard('html')" }; } catch {}
        try { GM.setClipboard(html, { type: 'html' }); return { ok: true, via: 'GM.setClipboard({type:html})' }; } catch {}
      }
    } catch {}
    try {
      if (typeof GM_setClipboard === 'function') {
        try { GM_setClipboard(html, 'html'); return { ok: true, via: "GM_setClipboard('html')" }; } catch {}
      }
    } catch {}
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, via: 'navigator.clipboard(text)' };
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      ta.value = text;
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return { ok: true, via: 'execCommand' };
    } catch {}
    return { ok: false, via: 'manual' };
  }

  // ------- copy modes -------
  function buildTailParts() {
    const company = getCompanyName();
    const contact = getContactName();
    const parts = [];
    if (company) parts.push(company);
    if (contact) parts.push(contact);
    return parts;
  }

  async function copySimple(btn, labelEl) {
    const href = location.href;
    const base = buildBaseLabel();

    const html = `<a href="${href}">${escapeHtml(base)}</a>`;
    const text = base;

    const res = await copyRich(html, text);
    if (res.ok) flashCopied(btn, labelEl); else showToast('Copy failed, manual paste');
  }

  async function copyDetailed(btn, labelEl) {
    const href = location.href;
    const base = buildBaseLabel();

    const parts = buildTailParts(); // Company — Contact
    const tailText = parts.length ? `\n${parts.join(' — ')}` : '';
    const tailHTML = parts.length ? `<br>${escapeHtml(parts.join(' — '))}` : '';

    const html = `<a href="${href}">${escapeHtml(base)}</a>${tailHTML}`;
    const text = `${base}${tailText}`;

    const res = await copyRich(html, text);
    if (res.ok) flashCopied(btn, labelEl); else showToast('Copy failed, manual paste');
  }

  // ------- UI + placement -------
  function makeButton() {
    ensureFlashStyles();

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
    label.textContent = 'Copy Ticket';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    outer.title = 'Left-click: quick link · Right-click: detailed (newline: Company — Contact)';
    outer.addEventListener('click', (e) => { e.preventDefault(); copySimple(btn, label); });
    outer.addEventListener('contextmenu', (e) => { e.preventDefault(); copyDetailed(btn, label); });
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); copySimple(btn, label); }
      if (e.key === ' ')     { e.preventDefault(); copyDetailed(btn, label); }
    });
    // Optional: Shift+Click to force detailed with mouse
    outer.addEventListener('mousedown', (e) => {
      if (e.button === 0 && e.shiftKey) { e.preventDefault(); copyDetailed(btn, label); }
    });

    return outer;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;

    // Primary: after Clear Contact (if present from our other script)
    const clearBtn = document.getElementById('cw-clear-contact-btn');
    if (clearBtn) { clearBtn.insertAdjacentElement('afterend', makeButton()); return true; }

    // Secondary: after a “Follow” action by accessible name (class-agnostic)
    const findToolbarButtonByName = (name) => {
      name = String(name).trim().toLowerCase();
      const candidates = $$('.cw_CwActionButton, [role="button"], .mm_button, .gwt-Button');
      for (const c of candidates) {
        const text = txt(c).toLowerCase();
        if (text === name || text.split(/\s+/)[0] === name) return c.closest('.cw_CwActionButton') || c;
        const al = (c.getAttribute('aria-label') || '').toLowerCase();
        if (al === name) return c.closest('.cw_CwActionButton') || c;
      }
      return null;
    };
    const followBtn = findToolbarButtonByName('follow');
    if (followBtn) { (followBtn.closest('.cw_CwActionButton') || followBtn).insertAdjacentElement('afterend', makeButton()); return true; }

    // Tertiary: append to any action toolbar container
    const anyAction = $('.cw_CwActionButton');
    if (anyAction && anyAction.parentElement) { anyAction.parentElement.appendChild(makeButton()); return true; }

    return false;
  }

  // SPA-safe ensure
  let ensureTick = 0;
  function ensure() { if (++ensureTick > 200) return; try { placeButton(); } catch {} }

  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);

  setTimeout(ensure, 0);
  setTimeout(ensure, 250);
  setTimeout(ensure, 750);
  setTimeout(ensure, 1500);
  ensure();
})();
