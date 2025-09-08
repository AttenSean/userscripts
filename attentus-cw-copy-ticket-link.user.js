// ==UserScript==
// @name         attentus-cw-copy-ticket-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.3.0
// @description  Adds Copy Ticket button next to Clear Contact, copies rich HTML with plain text fallback (fix: full title incl. parentheses; now with 'Copied' flash)
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
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

  // -------- utils --------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  // Inject tiny CSS once for the flash effect
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
    setTimeout(() => {
      labelEl.textContent = original;
      btnRoot.classList.remove('cw-flash-pulse');
    }, 900);
  }

  // -------- data extraction --------
  function getTicketIdFromBanner() {
    const line = $$('.cw_CwLabel,.gwt-Label').map(txt)
      .find(t => /service\s*ticket\s*#\s*\d+/i.test(t || ''));
    const m = line && line.match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }

  // NEW: capture everything after "#ID - " to the end (don’t stop at parentheses)
  function getSummaryFromBannerFull() {
    const line = $$('.cw_CwLabel,.gwt-Label').map(txt)
      .find(t => /service\s*ticket\s*#\s*\d+/i.test(t || ''));
    if (!line) return '';
    const m = line.match(/#\s*\d+\s*-\s*(.+)$/);
    return m ? m[1].trim() : '';
  }

  // Fallback: derive full label from the tab title
  function getLabelFromTitle() {
    let t = (document.title || '').trim();
    if (!t) return '';

    // Strip vendor suffix like " | ConnectWise Manage" / " - ConnectWise ..."
    t = t.replace(/\s*[|\-–—]\s*ConnectWise.*$/i, '').trim();

    // If title already starts with #123..., we can use it directly
    if (/^#\d+/.test(t)) return t;

    // Or if it has "#123 - rest", rebuild in our style
    const m = t.match(/#\s*(\d{3,})\s*-\s*(.+)$/);
    if (m) return `#${m[1]} - ${m[2].trim()}`;

    return '';
  }

  // Optional: Need-by tag (unchanged)
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

  // Build label (prefer full banner; then title; else minimal)
  function buildLabel() {
    const id   = getTicketIdFromBanner() || '????';
    const need = getNeedByTag();

    const fullFromBanner = getSummaryFromBannerFull();
    if (fullFromBanner) {
      let base = `#${id} - ${fullFromBanner}`;
      if (need) base += ` ${need}`;
      return base;
    }

    const fromTitle = getLabelFromTitle();
    if (fromTitle) {
      return need ? `${fromTitle} ${need}` : fromTitle;
    }

    // Last-resort minimal
    return need ? `#${id} ${need}` : `#${id}`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  // -------- clipboard, prefers true HTML flavor --------
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

  // -------- UI --------
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

    outer.title = 'Copy formatted ticket link for Teams';
    outer.addEventListener('click', async (e) => {
      e.preventDefault();
      const href = location.href;
      const labelText = buildLabel();
      const html = `<a href="${href}">${escapeHtml(labelText)}</a>`;
      const text = labelText; // keep URL out of plain text to avoid unfurl spam
      const res = await copyRich(html, text);
      if (res.ok) {
        flashCopied(btn, label);
      } else {
        showToast('Copy failed, manual paste');
      }
    });

    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); outer.click(); }
    });

    return outer;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;

    const clearBtn = document.getElementById('cw-clear-contact-btn');
    if (clearBtn) {
      clearBtn.insertAdjacentElement('afterend', makeButton());
      return true;
    }

    const followLabel = $$('.GMDB3DUBBPG').find(el => (txt(el).toLowerCase() === 'follow'));
    const followBtn = followLabel && followLabel.closest('.cw_CwActionButton');
    if (followBtn) {
      followBtn.insertAdjacentElement('afterend', makeButton());
      return true;
    }

    return false;
  }

  function ensure() { placeButton(); }

  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);

  ensure();
})();
