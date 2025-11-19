// ==UserScript==
// @name         attentus-cw-copy-ticket-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.7.4
// @description  Click = formatted label link. Shift+Click = URL-only (as hyperlink in HTML). Right-click/Space = formatted + newline "Company, Contact". SPA-safe, mounts with other action buttons; never on Time Entry / Time Sheets / modals. Uses Rails ticket URL.
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
  const INLINE_GROUP_ID = 'cw-notes-inline-copy-group'; // guard: do not mount inside this

  /* ---------- styles (normalized spacing) ---------- */
  (function ensureCopyTicketStyles() {
    if (document.getElementById('att-copy-ticket-style')) return;
    const s = document.createElement('style');
    s.id = 'att-copy-ticket-style';
    s.textContent = `
      /* Remove ad-hoc margins on our 3 action buttons so a single sibling rule rules them all */
      #cw-copy-ticket-link-btn,
      #cw-clear-contact-btn,
      #cw-copy-timezest-btn { margin: 0 !important; }

      /* Consistent spacing between CW action buttons no matter which pod/bar renders them */
      .pod_ticketHeaderActions .cw_CwActionButton + .cw_CwActionButton,
      .cw-CwActionButtons     .cw_CwActionButton + .cw_CwActionButton,
      .cw-CwActionBar         .cw_CwActionButton + .cw_CwActionButton,
      .mm_toolbar             .cw_CwActionButton + .cw_CwActionButton {
        margin-left: 6px !important;
      }

      /* Stronger spacing for the HorizontalPanel action bar */
      .cw_CwHorizontalPanel > .cw_CwActionButton { margin-left: 6px !important; }
      .cw_CwHorizontalPanel > .cw_CwActionButton:first-of-type { margin-left: 0 !important; }

      /* Physical spacer used when CW nukes margins in cw_CwHorizontalPanel */
      .att-action-spacer { display:inline-block; width:6px; height:1px; }
    `;
    document.head.appendChild(s);
  })();

  /* ---------- toolbar anchor helpers ---------- */

  function findHorizontalPanel() {
    return document.querySelector('.cw_CwHorizontalPanel');
  }

  function findAgeTable(panel) {
    if (!panel) return null;
    const ageDiv = panel.querySelector('.cw_CwHTML, .gwt-HTML.mm_label');
    if (ageDiv && /(^|\b)age:\s*/i.test((ageDiv.textContent || '').trim())) {
      return ageDiv.closest('table');
    }
    return null;
  }

  function lastNativeButton(panel) {
    if (!panel) return null;
    const natives = Array.from(panel.querySelectorAll('.cw_CwActionButton:not([data-origin="attentus"])'));
    return natives.length ? natives[natives.length - 1] : null;
  }

  function pickAfterAnchor(container) {
    const panel = findHorizontalPanel() || container;
    if (!panel) return null;

    const age = findAgeTable(panel);
    const nativeLast = lastNativeButton(panel);

    if (age && nativeLast) {
      // choose whichever is further to the right in DOM order
      return (age.compareDocumentPosition(nativeLast) & Node.DOCUMENT_POSITION_FOLLOWING)
        ? nativeLast
        : age;
    }
    return nativeLast || age || null;
  }

  // spacer utilities
  const isBtn = el => el && el.classList && el.classList.contains('cw_CwActionButton');
  function makeSpacer() { const s = document.createElement('span'); s.className = 'att-action-spacer'; return s; }
  function insertAfterWithSpacer(afterEl, node) {
    const parent = afterEl?.parentElement; if (!parent) return;
    let spacer = afterEl.nextSibling;
    if (!(spacer && spacer.nodeType === 1 && spacer.classList.contains('att-action-spacer'))) {
      spacer = makeSpacer();
      parent.insertBefore(spacer, afterEl.nextSibling);
    }
    parent.insertBefore(node, spacer.nextSibling);
  }

  /* ---------- copy flash styles ---------- */

  function ensureFlashStyles() {
    if (document.getElementById('cw-copy-flash-styles')) return;
    const css = document.createElement('style');
    css.id = 'cw-copy-flash-styles';
    css.textContent = `
      @keyframes cwFlashPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .cw-flash-pulse { animation: cwFlashPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,0.25) inset; border-radius: 6px; }
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

  /* ---------- gating (ticket pages only) ---------- */

  function isTimeSheet() {
    // classic timesheet grids
    if (
      document.getElementById('mytimesheetdaygrid-listview-scroller') ||
      document.querySelector('.mytimesheetlist, .TimeSheet')
    ) {
      return true;
    }

    // NEW: Daily Time Entries page, which can still have srRecID in URL
    const navLabels = Array.from(
      document.querySelectorAll(
        '.navigationEntry.cw_CwLabel, .navigationEntry, .cw-main-banner .gwt-Label, .cw-main-banner .cw_CwLabel'
      )
    );
    if (navLabels.some(el => /daily\s+time\s+entries/i.test((el.textContent || '').trim()))) {
      return true;
    }

    return false;
  }

  function isTimeEntryPage() {
    if (document.querySelector('.pod_timeEntryDetails')) return true;
    if (document.querySelector('.cw_ToolbarButton_TimeStamp')) return true; // Notes timestamp buttons
    if (document.querySelector('input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"]')) return true;
    return false;
  }

  function isTicketPage() {
    if (!isCanonicalServiceTicketPage()) return false;
    if (isTimeSheet() || isTimeEntryPage()) return false;

    const href  = (location.href || '').toLowerCase();
    const path  = (location.pathname || '').toLowerCase();
    const qs    = location.search || '';

    // URL level hints
    if (/[?&](service_recid|recid|serviceticketid|srrecid)=\d+/i.test(qs)) return true;
    if (/connectwise\.aspx/.test(path) && /\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;

    // Ticket pods present
    if (document.querySelector('.pod_ticketHeaderActions, .pod_ticketSummary')) return true;

    // Banner text
    if ([...document.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label')]
      .some(el => /service\s*ticket\s*#/i.test((el.textContent || '')))) return true;

    return false;
  }

  function hasServiceTicketNavLabel() {
  const nodes = document.querySelectorAll(
    '.navigationEntry.cw_CwLabel, .navigationEntry.mm_label, .navigationEntry.gwt-Label'
  );
  return Array.from(nodes).some(el => /service\s+ticket/i.test((el.textContent || '').trim()));
}

function hasAgeLabel() {
  const nodes = document.querySelectorAll('.cw_CwHTML.mm_label, .gwt-HTML.mm_label.cw_CwHTML');
  return Array.from(nodes).some(el => /age\s*:/i.test((el.textContent || '').trim()));
}

function isCanonicalServiceTicketPage() {
  return hasServiceTicketNavLabel() && hasAgeLabel();
}

  /* ---------- DOM utils ---------- */

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function getSpaRoot() {
    return document.querySelector('#cwContent') ||
           document.querySelector('.cw-WorkspaceView') ||
           document.body;
  }

  function findActionContainer() {
    const anyBtn = document.querySelector('.cw_CwActionButton');
    if (anyBtn && anyBtn.parentElement) return anyBtn.parentElement;

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

  /* ---------- ticket meta ---------- */

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
    // strip " | ConnectWise" and similar
    t = t.replace(/\s*[|\-]\s*ConnectWise.*$/i, '').trim();
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

  /* ---------- Rails base + URL ---------- */

  function cwVersionBase() {
    const m = (location.pathname || '').match(/\/v\d+_\d+[^/]*?/);
    const ver = m ? m[0] : '/v4_6_release';
    return `${location.origin}${ver}`;
  }

  function buildTicketUrl(id) {
    if (!id) return location.href;
    return `${cwVersionBase()}/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}`;
  }

  function getContactName() {
    const val = sel => document.querySelector(sel)?.value?.trim() || '';
    return (
      val('input.cw_contact') ||
      val('[data-cwid="contact"] input[readonly]') ||
      val('[data-cwid="contact"] input') ||
      (document.querySelector('.pod_ticketHeader [aria-label="Contact"] .mm_value')?.textContent || '').trim() ||
      ''
    );
  }

  function getCompanyName() {
    const val = sel => document.querySelector(sel)?.value?.trim() || '';
    return (
      val('input.cw_company') ||
      val('[data-cwid="company"] input[readonly]') ||
      val('[data-cwid="company"] input') ||
      (document.querySelector('.pod_ticketHeader [aria-label="Company"] .mm_value')?.textContent || '').trim() ||
      ''
    );
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;'
    }[c]));
  }

  /* ---------- robust rich copy ---------- */

  async function copyBoth(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
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

    try {
      if (typeof GM === 'object' && GM?.setClipboard) {
        try { GM.setClipboard(html, { type: 'text/html' }); } catch {}
        try { GM.setClipboard(text, { type: 'text/plain' }); } catch {}
        return true;
      }
    } catch {}

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(html, 'html');
        return true;
      }
    } catch {}

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}

    return false;
  }

  /* ---------- copy modes ---------- */

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

    const tailText = parts.length ? `\n${parts.join(', ')}` : '';
    const tailHTML = parts.length ? `<br>${escapeHtml(parts.join(', '))}` : '';

    const html = `<a href="${href}">${escapeHtml(base)}</a>${tailHTML}`;
    const text = `${base}${tailText}`;

    const ok = await copyBoth(html, text);
    flashCopied(btn, label, ok ? 'Copied' : 'Copy failed');
  }

  /* ---------- button & events ---------- */

  function makeButton() {
    ensureFlashStyles();

    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    outer.setAttribute('data-origin', 'attentus');
    outer.tabIndex = 0;
    outer.setAttribute('aria-label', 'Copy Ticket');
    // force spacing even inside cw_CwHorizontalPanel
    outer.style.marginLeft = '6px';

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

  /* ---------- ordered mounting helper (position lock) ---------- */

  function mountIntoOrdered(container, node) {
    if (!container || !node) return;

    const clearBtn = document.getElementById('cw-clear-contact-btn');
    const timezest = document.getElementById('cw-copy-timezest-btn');

    // 1) Ensure we start the Attentus block after Age/native
    const afterAnchor = pickAfterAnchor(container);
    if (afterAnchor) insertAfterWithSpacer(afterAnchor, node);
    else container.appendChild(node);

    // 2) Now enforce Attentus internal order around this node
    // after Clear Contact
    if (clearBtn && clearBtn.parentElement === container) {
      insertAfterWithSpacer(clearBtn, node);
    }
    // before TimeZest
    if (timezest && timezest.parentElement === container) {
      // place our node before TimeZest by inserting a spacer before TimeZest and then before that spacer
      let spacer = timezest.previousSibling;
      if (!(spacer && spacer.nodeType === 1 && spacer.classList.contains('att-action-spacer'))) {
        spacer = makeSpacer();
        container.insertBefore(spacer, timezest);
      }
      container.insertBefore(node, spacer);
    }
  }

  /* ---------- placement (ticket toolbar only) ---------- */

  function placeButtonNow() {
    if (document.getElementById(BTN_ID)) return true;
    if (!isTicketPage()) return false;
    if (document.querySelector('.cw-gxt-wnd')) return false; // no modals

    const container = findActionContainer();
    if (!container) return false;

    // Guard, do not append to the clipboard bar span (Time Entry UI)
    if (container.id === INLINE_GROUP_ID) return false;

    // Create once, then mount with deterministic ordering
    const node = makeButton();
    mountIntoOrdered(container, node);
    return true;
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
    if (!isTicketPage()) return;
    if (document.querySelector('.cw-gxt-wnd')) return;
    if (document.getElementById(BTN_ID)) return;

    if (placeButtonNow()) return;

    retryUntil(
      () => !!findActionContainer(),
      () => placeButtonNow(),
      { attempts: 80, delay: 150 }
    );
  }

  /* ---------- SPA hooks ---------- */

  const spaRoot = getSpaRoot();
  const mo = new MutationObserver(() => ensureOnce());
  if (spaRoot) mo.observe(spaRoot, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(ensureOnce);
      return r;
    };
  });
  window.addEventListener('popstate', ensureOnce);
  window.addEventListener('hashchange', ensureOnce);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureOnce(); });

  // initial passes
  setTimeout(ensureOnce, 0);
  setTimeout(ensureOnce, 250);
  setTimeout(ensureOnce, 750);
  setTimeout(ensureOnce, 1500);
  setTimeout(ensureOnce, 3000);
  setTimeout(ensureOnce, 6000);
})();

/* -------------------------------------------------
 * Selectors QA, Copy Ticket button, Ticket vs Time views
 * -------------------------------------------------
 *
 * Page scope / gating
 * - Ticket only: isTicketPage()
 *   - Early exit if isTimeSheet() or isTimeEntryPage() are true.
 *
 * isTimeSheet()
 * - Classic timesheet:
 *   - #mytimesheetdaygrid-listview-scroller
 *   - .mytimesheetlist, .TimeSheet
 * - Daily Time Entries:
 *   - .navigationEntry.cw_CwLabel / .navigationEntry / .cw-main-banner .gwt-Label / .cw-main-banner .cw_CwLabel
 *   - textContent matches /daily\s+time\s+entries/i
 *
 * isTimeEntryPage()
 * - Detail time entry / inline:
 *   - .pod_timeEntryDetails
 *   - .cw_ToolbarButton_TimeStamp
 *   - input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"]
 *
 * Ticket detection
 * - URL:
 *   - ?service_recid=, ?recid=, ?serviceticketid=, ?srrecid=
 *   - ConnectWise.aspx with encoded query containing ticket/service ticket.
 * - DOM:
 *   - .pod_ticketHeaderActions, .pod_ticketSummary
 *   - Any .cw_CwLabel/.gwt-Label/.mm_label with /service\s*ticket\s*#/
 *
 * Toolbar anchor
 * - Observer root: #cwContent or .cw-WorkspaceView or document.body
 * - Action containers:
 *   - .pod_ticketHeaderActions
 *   - .cw-CwActionBar
 *   - .cw-CwActionButtons
 *   - .mm_toolbar
 * - Anchor inside cw_CwHorizontalPanel:
 *   - Prefer Age table (Age: x) or last native .cw_CwActionButton as reference.
 *
 * Must not mount
 * - Any context where isTimeSheet() or isTimeEntryPage() returns true, including Daily Time Entries.
 * - Any modal (.cw-gxt-wnd).
 * - Clipboard bar span (INLINE_GROUP_ID = cw-notes-inline-copy-group).
 */
