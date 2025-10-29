// ==UserScript==
// @name         attentus-cw-copy-ticket-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.6.0
// @description  Click = formatted label link. Shift+Click = URL-only (as hyperlink in HTML). Right-click/Space = formatted + newline “Company — Contact”. SPA-safe, mounts with other action buttons; never on Time Sheets or modals.
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

  // ---------- spacing like other buttons ----------
  (function ensureCopyTicketStyles(){
    if (document.getElementById('att-copy-ticket-style')) return;
    const s = document.createElement('style');
    s.id = 'att-copy-ticket-style';
    s.textContent = `#${CSS.escape(BTN_ID)}{margin-left:6px}`;
    document.head.appendChild(s);
  })();

  // ---------- feedback pulse ----------
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
  function flashCopied(btnRoot, labelEl, msg) {
    if (!labelEl) return;
    const old = labelEl.textContent;
    labelEl.textContent = msg || 'Copied';
    btnRoot.classList.add('cw-flash-pulse');
    setTimeout(() => { labelEl.textContent = old; btnRoot.classList.remove('cw-flash-pulse'); }, 900);
  }

  // ---------- gating ----------
  function isTicketOrTimeEntryPage() {
    const href = (location.href || '').toLowerCase();
    const path = (location.pathname || '').toLowerCase();
    const qs   = location.search || '';
    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(qs)) return true;
    if (/connectwise\.aspx/.test(path)) {
      if (/\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;
      if (/\?\?[^#]*timeentry/i.test(href)) return true;
    }
    if (document.querySelector('.pod_ticketHeaderActions, .pod_ticketSummary, .pod_timeEntryDetails')) return true;
    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return false; // explicit off on Time Sheet
    return false;
  }

  // ---------- DOM utils ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function getSpaRoot() {
    return document.querySelector('#cwContent') ||
           document.querySelector('.cw-WorkspaceView') ||
           document.body;
  }

  // Find a stable container that holds action buttons
  function findActionContainer() {
    // Preferred: ticket header actions pod container
    const pod = document.querySelector('.pod_ticketHeaderActions');
    if (pod) {
      const btn = pod.querySelector('.cw_CwActionButton');
      if (btn && btn.parentElement) return btn.parentElement;
      return pod;
    }
    // Fallback: generic action bar wrapper
    const anyBtn = document.querySelector('.cw_CwActionButton');
    if (anyBtn && anyBtn.parentElement) return anyBtn.parentElement;
    return null;
  }

  function waitForActionContainer({ timeoutMs = 20000 } = {}) {
    return new Promise(resolve => {
      const container = findActionContainer();
      if (container) return resolve(container);

      const root = getSpaRoot();
      if (!root) return resolve(null);

      const t = setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
      const obs = new MutationObserver(() => {
        const c = findActionContainer();
        if (c) {
          clearTimeout(t);
          obs.disconnect();
          resolve(c);
        }
      });
      obs.observe(root, { childList: true, subtree: true });
    });
  }

  // ---------- ticket meta ----------
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
  function buildBaseLabel() {
    const id   = getTicketIdFromBanner() || '????';
    const full = getSummaryFromBannerFull();
    return full ? `#${id} - ${full}` : (getLabelFromTitle() || `#${id}`);
  }
  function guessTicketDetailPath() {
    const p = (location.pathname||'').toLowerCase();
    if (p.includes('/service/tickets/detail')) return '/Service/Tickets/Detail.aspx';
    if (p.includes('/tickets/detail')) return '/Tickets/Detail.aspx';
    return '/Service/Tickets/Detail.aspx';
  }
  function buildTicketUrl(id) {
    const base = location.origin;
    return id ? `${base}${guessTicketDetailPath()}?service_recid=${encodeURIComponent(id)}` : location.href;
  }
  function getContactName() {
    const val = sel => document.querySelector(sel)?.value?.trim() || '';
    return (
      val('input.cw_contact') ||
      val('[data-cwid="contact"] input[readonly]') ||
      val('[data-cwid="contact"] input') ||
      (document.querySelector('.pod_ticketHeader [aria-label="Contact"] .mm_value')?.textContent||'').trim() ||
      ''
    );
  }
  function getCompanyName() {
    const val = sel => document.querySelector(sel)?.value?.trim() || '';
    return (
      val('input.cw_company') ||
      val('[data-cwid="company"] input[readonly]') ||
      val('[data-cwid="company"] input') ||
      (document.querySelector('.pod_ticketHeader [aria-label="Company"] .mm_value')?.textContent||'').trim() ||
      ''
    );
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  // ---------- robust rich copy (HTML + plain) ----------
  async function copyBoth(html, text) {
    // 1) Async Clipboard with multiple types
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type:'text/html' }),
          'text/plain': new Blob([text], { type:'text/plain' })
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch {}

    // 2) Programmatic 'copy' with clipboardData override (most reliable)
    try {
      const onCopy = (e) => {
        try {
          e.clipboardData.setData('text/html', html);
          e.clipboardData.setData('text/plain', text);
          e.preventDefault();
        } catch {}
      };
      document.addEventListener('copy', onCopy, true);

      // Select a hidden contenteditable so the command is allowed
      const host = document.createElement('div');
      host.contentEditable = 'true';
      host.style.position = 'fixed';
      host.style.opacity = '0';
      host.style.pointerEvents = 'none';
      host.style.zIndex = '-1';
      host.innerHTML = html;
      document.body.appendChild(host);

      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(host);
      sel.removeAllRanges();
      sel.addRange(range);

      const ok = document.execCommand && document.execCommand('copy');

      sel.removeAllRanges();
      document.removeEventListener('copy', onCopy, true);
      document.body.removeChild(host);

      if (ok) return true;
    } catch {}

    // 3) GM APIs (best-effort)
    try { if (typeof GM === 'object' && GM?.setClipboard) { try { GM.setClipboard(html, { type:'text/html' }); } catch {} try { GM.setClipboard(text, { type:'text/plain' }); } catch {} return true; } } catch {}
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(html, 'html'); return true; } } catch {}

    // 4) Plain text fallbacks
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}

    return false;
  }

  // ---------- copy modes ----------
  async function copyFormattedBase(btn, label) {
    const id   = getTicketIdFromBanner();
    const href = buildTicketUrl(id);
    const base = buildBaseLabel();
    const html = `<a href="${href}">${escapeHtml(base)}</a>`;
    const text = base;
    const ok = await copyBoth(html, text);
    flashCopied(btn, label, ok ? 'Copied' : 'Copy failed');
  }
  async function copyUrlOnly(btn, label) {
    const id   = getTicketIdFromBanner();
    const href = buildTicketUrl(id);
    const html = `<a href="${href}">${escapeHtml(href)}</a>`; // hyperlink with URL text
    const text = href;
    const ok = await copyBoth(html, text);
    flashCopied(btn, label, ok ? 'Copied URL' : 'Copy failed');
  }
  async function copyFormattedWithCompanyContact(btn, label) {
    const id   = getTicketIdFromBanner();
    const href = buildTicketUrl(id);
    const base = buildBaseLabel();

    const parts = [];
    const company = getCompanyName();
    const contact = getContactName();
    if (company) parts.push(company);
    if (contact) parts.push(contact);

    const tailText = parts.length ? `\n${parts.join(' — ')}` : '';
    const tailHTML = parts.length ? `<br>${escapeHtml(parts.join(' — '))}` : '';

    const html = `<a href="${href}">${escapeHtml(base)}</a>${tailHTML}`;
    const text = `${base}${tailText}`;

    const ok = await copyBoth(html, text);
    flashCopied(btn, label, ok ? 'Copied' : 'Copy failed');
  }

  // ---------- button & events ----------
  function makeButton() {
    ensureFlashStyles();

    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    outer.setAttribute('data-origin','attentus');
    outer.tabIndex = 0;
    outer.setAttribute('aria-label','Copy Ticket');

    const btn   = document.createElement('div');  btn.className = 'GMDB3DUBIOG mm_button';
    const inner = document.createElement('div');  inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';
    const label = document.createElement('div');  label.className = 'GMDB3DUBBPG'; label.textContent = 'Copy Ticket';
    inner.appendChild(label); btn.appendChild(inner); outer.appendChild(btn);

    // pointerup-only mapping (trusted activation):
    // Right-click = formatted + company/contact
    // Shift+Left  = URL-only
    // Left-click  = formatted label
    outer.addEventListener('pointerup', (e) => {
      if (e.button === 2) { e.preventDefault(); e.stopPropagation(); return copyFormattedWithCompanyContact(btn, label); }
      if (e.shiftKey)     { e.preventDefault(); e.stopPropagation(); return copyUrlOnly(btn, label); }
      e.preventDefault(); e.stopPropagation(); return copyFormattedBase(btn, label);
    }, true);

    // prevent OS context menu (we already handle right-click)
    outer.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, true);

    // Keyboard: Enter = formatted, Space = detailed
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); copyFormattedBase(btn, label); }
      if (e.key === ' ')     { e.preventDefault(); copyFormattedWithCompanyContact(btn, label); }
    });

    return outer;
  }

  // ---------- placement (anchor-aware) ----------
  function placeButtonNow() {
    if (document.getElementById(BTN_ID)) return true;
    if (!isTicketOrTimeEntryPage()) return false;
    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return false;
    if (document.querySelector('.cw-gxt-wnd')) return false;

    // Prefer colocating with our buttons
    const before =
      document.getElementById('cw-copy-timezest-btn') ||
      document.getElementById('cw-clear-contact-btn');

    if (before && before.parentElement) {
      before.parentElement.insertBefore(makeButton(), before.nextSibling);
      return true;
    }

    // Else anchor to the action container
    const container = findActionContainer();
    if (container) {
      container.appendChild(makeButton());
      return true;
    }
    return false;
  }

  // ---------- SPA ensure with waiter ----------
  let ensureRunId = 0;

  async function ensure() {
    const runId = ++ensureRunId;

    // Gating
    if (!isTicketOrTimeEntryPage()) return;
    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return;
    if (document.querySelector('.cw-gxt-wnd')) return;

    // If already mounted, done
    if (document.getElementById(BTN_ID)) return;

    // Try immediate mount
    if (placeButtonNow()) return;

    // Wait specifically for action container to appear
    const anchor = await waitForActionContainer({ timeoutMs: 20000 });
    if (runId !== ensureRunId) return; // route changed while waiting
    if (!anchor) return;               // gave up quietly

    // Anchor is present now, mount
    placeButtonNow();
  }

  const spaRoot = getSpaRoot();
  const mo = new MutationObserver(() => ensure());
  if (spaRoot) mo.observe(spaRoot, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);
  window.addEventListener('hashchange', ensure);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensure(); });

  // Gentle staggered attempts for slow pages
  setTimeout(ensure, 0);
  setTimeout(ensure, 250);
  setTimeout(ensure, 750);
  setTimeout(ensure, 1500);
  setTimeout(ensure, 3000);
  setTimeout(ensure, 6000);
  ensure();

  /* ---------------------------------------------
     Selectors QA — Copy Ticket (Ticket / Time Entry)
     ---------------------------------------------
     ## Gating
     - Page test(s): URL params (?service_recid|recid|serviceTicketId) OR DOM pods (.pod_ticketHeaderActions / .pod_ticketSummary / .pod_timeEntryDetails)
     - Must-not-fire on: Time Sheet (#mytimesheetdaygrid-listview-scroller), Modals (.cw-gxt-wnd)

     ## Anchor Region
     - Preferred container: .pod_ticketHeaderActions (append to parent of .cw_CwActionButton)
     - Fallback: parent of any .cw_CwActionButton
     - Observer root: #cwContent | .cw-WorkspaceView | body

     ## Key Values
     - Ticket ID/label: banner/title; normalized URL /Service/Tickets/Detail.aspx?service_recid=ID
     - Company/Contact: inputs (input.cw_company/input.cw_contact) or header mm_value by aria-label

     ## Placement
     - Prefer colocating after our own buttons (#cw-copy-timezest-btn / #cw-clear-contact-btn), else append to action container
  ---------------------------------------------- */
})();
