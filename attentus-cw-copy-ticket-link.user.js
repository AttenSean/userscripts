// ==UserScript==
// @name         attentus-cw-copy-ticket-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.7.0
// @description  Click = formatted label link. Shift+Click = URL-only (as hyperlink in HTML). Right-click/Space = formatted + newline “Company — Contact”. SPA-safe, mounts with other action buttons; never on Time Sheets or modals. Uses Rails ticket URL.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM.setValue
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
  const href = (location.href || "").toLowerCase();
  const path = (location.pathname || "").toLowerCase();
  const search = location.search || "";

  if (/[?&](service_recid|recid|serviceticketid|srrecid)=\d+/i.test(search)) return true;
  if (/connectwise\.aspx/.test(path)) {
    if (/\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;
    if (/\?\?[^#]*timeentry/i.test(href)) return true;
  }
  if (document.querySelector(".pod_ticketHeaderActions, .pod_ticketSummary")) return true;
  if ([...document.querySelectorAll(".cw_CwLabel,.gwt-Label")]
      .some(el => /service\s*ticket\s*#/i.test(el.textContent || ""))) return true;
  if (document.querySelector(".pod_timeEntryDetails, input.cw_ChargeToTextBox, input[id$='ChargeToTextBox']")) return true;

  // explicit off on Time Sheet
  if (document.getElementById("mytimesheetdaygrid-listview-scroller")) return false;
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
  // 1) Prefer an existing CW action button’s parent (most stable)
  const anyBtn = document.querySelector('.cw_CwActionButton');
  if (anyBtn && anyBtn.parentElement) return anyBtn.parentElement;

  // 2) Known action containers across skins/layouts
  const pods = [
    '.pod_ticketHeaderActions',
    '.cw-CwActionBar',
    '.cw-CwActionButtons',
    '.mm_toolbar'
  ];
  for (const sel of pods) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
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

  // ---------- CW Rails base + ticket URL ----------
  function cwVersionBase() {
    // Keep the /v4_6_release (or similar) prefix if present; otherwise default to v4_6_release.
    const m = (location.pathname || '').match(/\/v\d+_\d+[^/]*?/);
    const ver = m ? m[0] : '/v4_6_release';
    return `${location.origin}${ver}`;
  }
  function buildTicketUrl(id) {
    if (!id) return location.href;
    // Rails detail page used by other Attentus scripts
    //   /vX_X_release/services/system_io/Service/fv_sr100_request.rails?service_recid=<id>
    return `${cwVersionBase()}/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}`;
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

    try {
      const onCopy = (e) => {
        try {
          e.clipboardData.setData('text/html', html);
          e.clipboardData.setData('text/plain', text);
          e.preventDefault();
        } catch {}
      };
      document.addEventListener('copy', onCopy, true);

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

    try { if (typeof GM === 'object' && GM?.setClipboard) { try { GM.setClipboard(html, { type:'text/html' }); } catch {} try { GM.setClipboard(text, { type:'text/plain' }); } catch {} return true; } } catch {}
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(html, 'html'); return true; } } catch {}

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
    const html = `<a href="${href}">${escapeHtml(href)}</a>`;
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

    outer.addEventListener('pointerup', (e) => {
      if (e.button === 2) { e.preventDefault(); e.stopPropagation(); return copyFormattedWithCompanyContact(btn, label); }
      if (e.shiftKey)     { e.preventDefault(); e.stopPropagation(); return copyUrlOnly(btn, label); }
      e.preventDefault(); e.stopPropagation(); return copyFormattedBase(btn, label);
    }, true);

    outer.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); }, true);

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

    const before =
      document.getElementById('cw-copy-timezest-btn') ||
      document.getElementById('cw-clear-contact-btn');

    if (before && before.parentElement) {
      before.parentElement.insertBefore(makeButton(), before.nextSibling);
      return true;
    }

    const container = findActionContainer();
    if (container) {
      container.appendChild(makeButton());
      return true;
    }
    return false;
  }

  function retryUntil(testFn, runFn, { attempts = 80, delay = 150 } = {}) {
  let tries = 0;
  const tick = () => {
    try {
      if (testFn()) { runFn(); return; }
    } catch {}
    if (++tries < attempts) setTimeout(tick, delay);
  };
  tick();
}

  function ensureOnce() {
  if (!isTicketOrTimeEntryPage()) return;
  if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return;
  if (document.querySelector('.cw-gxt-wnd')) return; // keep your modal guard

  if (document.getElementById(BTN_ID)) return;

  // fast path
  if (placeButtonNow()) return;

  // persistent polling until an action container exists
  retryUntil(
    () => !!findActionContainer(),
    () => placeButtonNow(),
    { attempts: 80, delay: 150 } // ~12s total like Clear Contact
  );
}

// call this instead of plain `ensure()` for the initial passes
setTimeout(ensureOnce, 0);
setTimeout(ensureOnce, 250);
setTimeout(ensureOnce, 750);
setTimeout(ensureOnce, 1500);
setTimeout(ensureOnce, 3000);
setTimeout(ensureOnce, 6000);


  // ---------- SPA ensure with waiter ----------
  let ensureRunId = 0;

  async function ensure() {
    const runId = ++ensureRunId;

    if (!isTicketOrTimeEntryPage()) return;
    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return;
    if (document.querySelector('.cw-gxt-wnd')) return;

    if (document.getElementById(BTN_ID)) return;

    if (placeButtonNow()) return;

    const anchor = await waitForActionContainer({ timeoutMs: 20000 });
    if (runId !== ensureRunId) return;
    if (!anchor) return;

    placeButtonNow();
  }

  const spaRoot = getSpaRoot();
  const mo = new MutationObserver(() => ensureOnce());
  if (spaRoot) mo.observe(spaRoot, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensureOnce); return r; };
  });
  window.addEventListener('popstate', ensureOnce);
  window.addEventListener('hashchange', ensureOnce);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureOnce(); });


  /* ---------------------------------------------
     Selectors QA — Copy Ticket (Ticket / Time Entry)
     ---------------------------------------------
     ## Gating
     - Page test(s): URL params (?service_recid|recid|serviceTicketId|srRecID) OR DOM pods (.pod_ticketHeaderActions / .pod_ticketSummary / .pod_timeEntryDetails)
     - Must-not-fire on: Time Sheet (#mytimesheetdaygrid-listview-scroller), Modals (.cw-gxt-wnd)

     ## Anchor Region
     - Preferred container: .pod_ticketHeaderActions (append to parent of .cw_CwActionButton)
     - Fallback: parent of any .cw_CwActionButton
     - Observer root: #cwContent | .cw-WorkspaceView | body

     ## Key Values
     - Ticket ID/label: banner/title; URL now uses Rails:
       /vX_X_release/services/system_io/Service/fv_sr100_request.rails?service_recid=ID
     - Company/Contact: inputs (input.cw_company/input.cw_contact) or header mm_value by aria-label

     ## Placement
     - Prefer colocating after our own buttons (#cw-copy-timezest-btn / #cw-clear-contact-btn), else append to action container
  ---------------------------------------------- */
})();
