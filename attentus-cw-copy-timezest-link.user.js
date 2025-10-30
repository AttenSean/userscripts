// ==UserScript==
// @name         attentus-cw-copy-timezest-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.4.1
// @description  Left-click: Help Desk Team (30m). Right-click: Personal (30m). Shift-click: Settings. Copies true HTML (“Schedule a time”) with plaintext fallback. Shows on Ticket pages (header actions) and stand-alone Time Entry windows (next to clipboard bar or Notes timestamp). SPA-safe.
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
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js
// ==/UserScript==

/* ==Shared Core (inline for reuse)== */
const AttentusCW = (() => {
  const DEBUG = !!localStorage.getItem("attentus-debug");

  function debugLog(...a) { if (DEBUG) console.log("[AttentusCW]", ...a); }

  function isTicketOrTimeEntryPage() {
    const href = (location.href || "").toLowerCase();
    const path = (location.pathname || "").toLowerCase();
    const search = location.search || "";

    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;

    if (/connectwise\.aspx/.test(path)) {
      if (/\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;
      if (/\?\?[^#]*timeentry/i.test(href)) return true;
    }

    if (document.querySelector('.pod_ticketHeaderActions, .pod_ticketSummary')) return true;
    if ([...document.querySelectorAll('.cw_CwLabel,.gwt-Label')]
          .some(el => /service\s*ticket\s*#/i.test(el.textContent || ''))) return true;

    if (document.querySelector('.pod_timeEntryDetails, input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"]')) return true;

    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return false;

    return false;
  }

  function getSpaRoot() {
    return (
      document.querySelector("#cwContent") ||
      document.querySelector(".cw-WorkspaceView") ||
      document.body
    );
  }

  function observeSpa(callback) {
    const root = getSpaRoot();
    if (!root) return;
    const obs = new MutationObserver(() => callback());
    obs.observe(root, { childList: true, subtree: true });
    window.addEventListener("popstate", callback, { passive: true });
    window.addEventListener("hashchange", callback, { passive: true });
    return obs;
  }

  function ensureMounted(testFn, mountFn, opts = {}) {
    const { attempts = 24, delay = 250 } = opts;
    let tries = 0;
    const loop = () => {
      try { if (testFn()) return void mountFn(); }
      catch (e) { debugLog("ensureMounted error:", e); }
      if (++tries < attempts) setTimeout(loop, delay);
    };
    loop();
  }

  return { debugLog, isTicketOrTimeEntryPage, observeSpa, ensureMounted, getSpaRoot };
})();

/* ==Script: Copy TimeZest Link== */
(function () {
  "use strict";

  // ---------- Constants ----------
  const BTN_ID = 'cw-copy-timezest-btn';
  const FLY_ID = 'cw-timezest-flyout';
  const CSS_ID = 'cw-timezest-styles';

  // Our Clipboard Bar group id (if present)
  const CLIPBOARD_GROUP_ID = 'cw-notes-inline-copy-group';

  // TimeZest URLs
  const BASE          = 'https://attentus.timezest.com/';
  const TEAM_PATH     = 'help-desk-team/phone-call-30'; // left-click
  const PERSONAL_PATH = 'phone-call-30';                // right-click

  // Storage keys
  const K_FIRST      = 'tz_firstname';
  const K_LAST       = 'tz_lastname';
  const K_ONBOARDED  = 'tz_onboarded_v2';

  // ---------- Tiny helpers ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function addStyles() {
    if (document.getElementById(CSS_ID)) return;
    const css = document.createElement('style');
    css.id = CSS_ID;
    css.textContent = `
      @keyframes tzPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .tz-flash { animation: tzPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset; border-radius: 6px; }

      /* --- Normalized spacing on ticket header --- */
      #cw-clear-contact-btn,
      #cw-copy-ticket-link-btn,
      #${CSS.escape(BTN_ID)} { margin: 0 !important; }

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



      /* Inline button look (Time Entry / clipboard bar) */
      #${CSS.escape(BTN_ID)}.att-inline.mm_button {
        display: inline-block !important;
        pointer-events: auto !important;
        opacity: 1 !important;
        cursor: pointer !important;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid rgba(0,0,0,.2);
        background: #2563eb;
        color: #fff;
        line-height: 1.2;
        white-space: nowrap;
      }

      /* flyout */
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
      #${FLY_ID} input {
        width: 100%; padding: 6px 8px; border-radius: 8px; color: #111827;
        border: 1px solid rgba(255,255,255,.3); outline: none;
      }
      #${FLY_ID} .actions { display:flex; gap: 8px; justify-content:flex-end; margin-top:10px; }
      #${FLY_ID} button {
        padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.22);
        background:#2563eb; color:#fff; cursor:pointer;
      }
      #${FLY_ID} .secondary { background:#111827; }
      #${FLY_ID} .explainer { color:#cbd5e1; font-size:12px; margin-top:6px; line-height:1.35; }
    `;
    document.head.appendChild(css);
  }

  function findHorizontalPanel() {
  return document.querySelector('.cw_CwHorizontalPanel');
}

  function makeSpacer(px = 8) {
  const s = document.createElement('span');
  s.className = 'att-action-spacer';
  s.style.display = 'inline-block';
  s.style.width = px + 'px';
  s.style.height = '1px';
  return s;
}


function findAgeTable(panel) {
  if (!panel) return null;
  const ageDiv = panel.querySelector('.cw_CwHTML, .gwt-HTML.mm_label');
  if (ageDiv && /(^|\b)age:\s*/i.test((ageDiv.textContent||'').trim())) {
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
    return (age.compareDocumentPosition(nativeLast) & Node.DOCUMENT_POSITION_FOLLOWING) ? nativeLast : age;
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

  // Clipboard helpers (kept as-is)
  async function copyRich(html, text) {
    let used = false;
    try {
      if (typeof GM_setClipboard === "function") { GM_setClipboard(html, "html"); used = true; }
      if (typeof GM === "object" && GM?.setClipboard) {
        try { GM.setClipboard(html, { type: "text/html" }); used = true; } catch {}
        try { GM.setClipboard(text, { type: "text/plain" }); used = true; } catch {}
      }
    } catch {}
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const data = { "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) };
        await navigator.clipboard.write([new ClipboardItem(data)]);
        used = true;
      } catch {}
    } else if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(text); used = true; } catch {}
    }
    return used;
  }

  // Storage wrappers
  async function getVal(k, d='') {
    if (typeof GM !== 'undefined' && GM?.getValue) return GM.getValue(k, d);
    if (typeof GM_getValue === 'function') return GM_getValue(k, d);
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  }
  async function setVal(k, v) {
    if (typeof GM !== 'undefined' && GM?.setValue) return GM.setValue(k, v);
    if (typeof GM_setValue === 'function') return GM_setValue(k, v);
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  }

  // ---------- Context helpers ----------
  function isTimesheetContext() {
    if (document.getElementById('mytimesheetdaygrid-listview-scroller')) return true;
    const crumbs = Array.from(document.querySelectorAll('.cw-main-banner .navigationEntry, .cw-main-banner .cw_CwLabel'))
      .map(e => (e.textContent || '').trim().toLowerCase());
    return crumbs.some(t => t.includes('open time sheets') || t === 'time sheet');
  }
  function isTicketContext() {
    const search = location.search || '';
    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;
    if (document.querySelector('.pod_ticketSummary, .pod_ticketHeaderActions')) return true;
    if ([...document.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label')]
          .some(el => /service\s*ticket\s*#/i.test((el.textContent || '')))) return true;
    return false;
  }
  function isStandaloneTimeEntryContext() {
    if (isTimesheetContext()) return false;
    if (isTicketContext()) return false;
    return !!document.querySelector('.pod_timeEntryDetails, input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"]');
  }

  // ---------- Ticket ID discovery ----------
  function parseTicketId(s) { const m = String(s||'').match(/(?:^|#|\b)(\d{3,})\b/); return m ? m[1] : null; }
  function getTicketIdFromBanner() {
    const labels = $$('.cw_CwLabel,.gwt-Label').map(el => (el.textContent||'').trim());
    const line = labels.find(t => /service\s*ticket\s*#/i.test(t));
    const m = line && line.match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }
  function getTicketIdFromChargeToOnce() {
    const sel = 'input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"], input.GKV5JQ3DMVF.cw_ChargeToTextBox';
    const inp = document.querySelector(sel);
    if (!inp) return null;

    let id = parseTicketId(inp.value);
    if (id) return id;

    const scope = inp.closest('td,div') || document;
    const hid = scope.querySelector('input[type="hidden"][value], input[type="hidden"][name*="ChargeTo"]');
    id = parseTicketId(hid && hid.value);
    if (id) return id;

    const activeId = inp.getAttribute('aria-activedescendant');
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
    const fromBanner = getTicketIdFromBanner();
    if (fromBanner) return fromBanner;

    const u = new URL(location.href);
    const idFromUrl =
      u.searchParams.get('service_recid') ||
      u.searchParams.get('recid') ||
      u.searchParams.get('serviceTicketId');
    if (idFromUrl) return idFromUrl;

    return await getTicketIdFromChargeToWait();
  }

  // ---------- URL builders ----------
  const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  function teamUrl(tid) { return `${BASE}${TEAM_PATH}/ticket/${tid}`; }
  function personalUrl(tid, first, last) {
    const s = `${slug(first)}-${slug(last)}`;
    return `${BASE}${s}/${PERSONAL_PATH}/ticket/${tid}`;
  }

  // ---------- Settings flyout ----------
  function openFlyout() {
    addStyles();
    const existing = $('#'+FLY_ID);
    if (existing) existing.remove();

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
        <div>Shift-click this button to re-open settings anytime.</div>
      </div>
      <div class="actions">
        <button class="secondary" id="${FLY_ID}-cancel">Close</button>
        <button id="${FLY_ID}-save">Save</button>
      </div>
    `;
    document.body.appendChild(el);

    (async () => {
      $('#'+FLY_ID+'-first').value = (await getVal(K_FIRST, '')) || '';
      $('#'+FLY_ID+'-last').value  = (await getVal(K_LAST,  '')) || '';
    })();

    $('#'+FLY_ID+'-close').addEventListener('click', (e) => { e.preventDefault(); el.remove(); });
    $('#'+FLY_ID+'-cancel').addEventListener('click', (e) => { e.preventDefault(); el.remove(); });
    $('#'+FLY_ID+'-save').addEventListener('click', async (e) => {
      e.preventDefault();
      const first = $('#'+FLY_ID+'-first').value.trim();
      const last  = $('#'+FLY_ID+'-last').value.trim();
      await setVal(K_FIRST, first);
      await setVal(K_LAST, last);
      await setVal(K_ONBOARDED, '1');
      el.remove();
      showToast('Saved');
    });
  }

  // ---------- Build buttons ----------
  function makeActionButton() {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    outer.setAttribute('data-origin', 'attentus');
      // NEW: force spacing even inside cw_CwHorizontalPanel
  outer.style.marginLeft = '6px';

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Copy TimeZest Link');
    btn.title = 'Click: Help Desk Team (30m). Right-click: Personal (30m). Shift-click: Settings.';

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = 'Copy TimeZest';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    wireHandlers(outer, btn, label);
    return outer;
  }

  function makeInlineButton() {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = BTN_ID;
    b.className = 'mm_button';
    b.classList.add('att-inline');
    b.setAttribute('data-origin', 'attentus');
    b.setAttribute('aria-label', 'Copy TimeZest Link');
    b.title = 'Click: Help Desk Team (30m). Right-click: Personal (30m). Shift-click: Settings.';
    b.textContent = 'Copy TimeZest';
    return b;
  }

  // ---------- Wire handlers ----------
  function wireHandlers(clickTarget, pulseTarget, labelEl) {
    clickTarget.addEventListener('click', async (e) => {
      e.preventDefault();
      if (e.shiftKey) { openFlyout(); return; }

      const onboarded = await getVal(K_ONBOARDED, '');
      if (!onboarded) { openFlyout(); return; }

      const tid = await getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }

      const url = teamUrl(tid);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(pulseTarget, labelEl, 'Copied'); else showToast('Copy failed');
    });

    clickTarget.addEventListener('contextmenu', async (e) => {
      e.preventDefault();

      const tid = await getTicketId();
      if (!tid) { showToast('Ticket # not found'); return; }

      const first = await getVal(K_FIRST, '');
      const last  = await getVal(K_LAST, '');
      if (!first || !last) { openFlyout(); return; }

      const url = personalUrl(tid, first, last);
      const ok = await copyRich(htmlLink(url, 'Schedule a time'), url);
      if (ok) flashCopied(pulseTarget, labelEl, 'Copied'); else showToast('Copy failed');
    });

    clickTarget.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickTarget.click(); }
    });
  }

  function htmlLink(href, text) { return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // ---------- Anchors & Placement ----------
  function findTicketActionContainer() {
    const pod = document.querySelector('.pod_ticketHeaderActions');
    if (pod) {
      const btn = pod.querySelector('.cw_CwActionButton');
      if (btn && btn.parentElement) return btn.parentElement;
      return pod;
    }
    const anyBtn = document.querySelector('.cw_CwActionButton');
    if (anyBtn && anyBtn.parentElement) return anyBtn.parentElement;
    return null;
  }

  function findNotesTimestampButton() {
    const stamps = document.querySelectorAll('.cw_ToolbarButton_TimeStamp');
    for (const st of stamps) {
      const row = st.closest('tr');
      const label = row && row.querySelector('.gwt-Label, .mm_label, .cw_CwLabel');
      if (label && /notes$/i.test((label.textContent || '').trim())) return st;
    }
    return null;
  }

  function validAnchor(el) {
    if (!el) return false;
    if (el.closest && el.closest('.cw-gxt-wnd')) return false;
    return true;
  }

// Ordered mount helper: Clear Contact → Copy Ticket → Copy TimeZest (this)
// Uses a spacer node to guarantee visual gaps even when margins are zeroed by CW CSS.
function mountIntoOrdered(container, node) {
  if (!container || !node) return;

  const clearBtn = document.getElementById('cw-clear-contact-btn');
  const copyBtn  = document.getElementById('cw-copy-ticket-link-btn');

  const afterAnchor = pickAfterAnchor(container);
  if (afterAnchor) insertAfterWithSpacer(afterAnchor, node);
  else container.appendChild(node);

  // after Copy Ticket if present
  if (copyBtn && copyBtn.parentElement === container) {
    insertAfterWithSpacer(copyBtn, node);
    return;
  }
  // else after Clear Contact if present
  if (clearBtn && clearBtn.parentElement === container) {
    insertAfterWithSpacer(clearBtn, node);
  }
}


  // Robust waiter for anchors within SPA (unchanged)
  function waitForAnchors({ timeoutMs = 20000 } = {}) {
    return new Promise(resolve => {
      if (isTicketContext()) {
        const container = findTicketActionContainer();
        if (container) return resolve({ kind: 'ticket', node: container });
      } else if (isStandaloneTimeEntryContext()) {
        const group = document.getElementById(CLIPBOARD_GROUP_ID);
        if (group) return resolve({ kind: 'timeentry-group', node: group });
        const stamp = findNotesTimestampButton();
        if (stamp) return resolve({ kind: 'timeentry-stamp', node: stamp });
      }

      const root = AttentusCW.getSpaRoot();
      if (!root) return resolve(null);

      const t = setTimeout(() => { obs.disconnect(); resolve(null); }, timeoutMs);
      const obs = new MutationObserver(() => {
        if (isTicketContext()) {
          const container = findTicketActionContainer();
          if (container) { clearTimeout(t); obs.disconnect(); return resolve({ kind: 'ticket', node: container }); }
        } else if (isStandaloneTimeEntryContext()) {
          const group = document.getElementById(CLIPBOARD_GROUP_ID);
          if (group) { clearTimeout(t); obs.disconnect(); return resolve({ kind: 'timeentry-group', node: group }); }
          const stamp = findNotesTimestampButton();
          if (stamp) { clearTimeout(t); obs.disconnect(); return resolve({ kind: 'timeentry-stamp', node: stamp }); }
        }
      });
      obs.observe(root, { childList: true, subtree: true });
    });
  }

  function placeButtonNow() {
    if (document.getElementById(BTN_ID)) return true;
    if (!AttentusCW.isTicketOrTimeEntryPage()) return false;
    if (isTimesheetContext()) return false;

    // On Ticket pages → mount in header actions with deterministic order
    if (isTicketContext()) {
      const container = findTicketActionContainer();
      if (validAnchor(container)) {
        const node = makeActionButton();
        mountIntoOrdered(container, node);
        return true;
      }
      return false;
    }

    // On stand-alone Time Entry → unchanged (inline)
    if (isStandaloneTimeEntryContext()) {
const group = document.getElementById(CLIPBOARD_GROUP_ID);
if (validAnchor(group)) {
  const b = makeInlineButton();
  wireHandlers(b, b, b);

  const parent = group.parentElement;
  if (parent) {
    // Insert a physical spacer between the group and our button
    const spacer = makeSpacer(8);
    parent.insertBefore(spacer, group.nextSibling);
    parent.insertBefore(b, spacer.nextSibling);
    return true;
  }
}




      const stamp = findNotesTimestampButton();
      if (stamp && validAnchor(stamp)) {
        const td = stamp.closest('td'); if (td) td.style.whiteSpace = 'nowrap';
        const inline = makeInlineButton();
        wireHandlers(inline, inline, inline);
        stamp.style.display = 'inline-block';
        stamp.insertAdjacentElement('afterend', inline);
        inline.style.marginLeft = '8px';
        return true;
      }
    }

    return false;
  }

  // ---------- Init / SPA ----------
  let runId = 0;

  async function ensure() {
    const my = ++runId;

    if (!AttentusCW.isTicketOrTimeEntryPage()) return;
    if (isTimesheetContext()) return;
    if (document.getElementById(BTN_ID)) return;

    if (placeButtonNow()) return;

    const target = await waitForAnchors({ timeoutMs: 20000 });
    if (my !== runId || !target) return;

    placeButtonNow();
  }

  addStyles();
  ensure();

  const spaRoot = AttentusCW.getSpaRoot();
  if (spaRoot) {
    const mo = new MutationObserver(() => ensure());
    mo.observe(spaRoot, { childList: true, subtree: true });
  }
  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);
  window.addEventListener('hashchange', ensure);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensure(); });

  // Gentle retries for slow pages
  setTimeout(ensure, 0);
  setTimeout(ensure, 250);
  setTimeout(ensure, 750);
  setTimeout(ensure, 1500);
  setTimeout(ensure, 3000);
  setTimeout(ensure, 6000);

  /* ---------------------------------------------
     Selectors QA — TimeZest (Ticket / Stand-alone Time Entry)
     ---------------------------------------------
     ## Gating
     - Page test(s): URL (?service_recid|recid|serviceTicketId) OR DOM pods (.pod_ticketHeaderActions / .pod_timeEntryDetails / ChargeTo inputs)
     - Must-not-fire on: Time Sheet (#mytimesheetdaygrid-listview-scroller), Modals (.cw-gxt-wnd)

     ## Anchors
     - Ticket pages: header actions container (parent of .cw_CwActionButton) — never mount in thread pods
     - Stand-alone Time Entry: prefer #cw-notes-inline-copy-group; else after .cw_ToolbarButton_TimeStamp for “Notes”

     ## Placement
     - Ticket (locked): Clear Contact → Copy Ticket → Copy TimeZest
     - Stand-alone Time Entry: append to clipboard bar group; otherwise insert after Notes timestamp with small left margin
  ---------------------------------------------- */
})();
