// ==UserScript==
// @name         attentus-cw-copy-timezest-link
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.3.0
// @description  One button: left-click copies Help Desk Team (30-min) TimeZest link; right-click copies Personal (30-min). Shift-click opens settings flyout. Copies true HTML (“Schedule a time”) with plaintext URL fallback. Ticket/Time Entry pages only. SPA-safe via shared core.
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

  function debugLog(...a) {
    if (DEBUG) console.log("[AttentusCW]", ...a);
  }

function isTicketOrTimeEntryPage() {
  // 1) URL heuristic — covers classic and SPA/hash routes
  const href = (location.href || "").toLowerCase();
  const path = (location.pathname || "").toLowerCase();
  const search = location.search || "";

  // Ticket detail usually exposes an id param somewhere:
  if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;

  // CW SPA-style routes often sit under connectwise.aspx??ServiceTicket/TimeEntry, etc.
  if (/connectwise\.aspx/.test(path)) {
    if (/\?\?[^#]*ticket|service.?ticket/i.test(href)) return true;
    if (/\?\?[^#]*timeentry/i.test(href)) return true;
  }

  // 2) DOM heuristics — reliable pods/labels
  // Ticket view: look for “Service Ticket #” label or a ticket header/actions pod.
  if (document.querySelector('.pod_ticketHeaderActions, .pod_ticketSummary')) return true;
  if ([...document.querySelectorAll('.cw_CwLabel,.gwt-Label')]
        .some(el => /service\s*ticket\s*#/i.test(el.textContent || ''))) return true;

  // Time Entry view: presence of “Charge To” field / time entry details pod
  if (document.querySelector('.pod_timeEntryDetails, input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"]')) return true;

  // 3) Negative gate: explicitly exclude Time Sheet grid if somehow matched above
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
      try {
        if (testFn()) return void mountFn();
      } catch (e) {
        debugLog("ensureMounted error:", e);
      }
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

  // Preferred inline group if our clipboard bar exists
  const CLIPBOARD_GROUP_ID = 'cw-notes-inline-copy-group';

  // TimeZest URL building (preserve existing behavior)
  const BASE          = 'https://attentus.timezest.com/';
  const TEAM_PATH     = 'help-desk-team/phone-call-30'; // left-click
  const PERSONAL_PATH = 'phone-call-30';                // right-click

  // Storage keys (preserve existing keys for smooth upgrade)
  const K_FIRST      = 'tz_firstname';
  const K_LAST       = 'tz_lastname';
  const K_ONBOARDED  = 'tz_onboarded_v2';

  // ---------- Tiny helpers ----------
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const txt = el => (el && el.textContent || '').trim();

  function addStyles() {
    if ($('#' + CSS_ID)) return;
    const css = document.createElement('style');
    css.id = CSS_ID;
    css.textContent = `
      @keyframes tzPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .tz-flash { animation: tzPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset; border-radius: 6px; }

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

  // Clipboard helpers
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
        const data = {
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" })
        };
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

  // ---------- Ticket ID discovery ----------
  function parseTicketId(s) {
    if (!s) return null;
    const m = String(s).match(/(?:^|#|\b)(\d{3,})\b/);
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
    // Time Entry "Charge To" field
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
    // 1) Ticket view banner fast path
    const fromBanner = getTicketIdFromBanner();
    if (fromBanner) return fromBanner;

    // 2) URL params
    const u = new URL(location.href);
    const idFromUrl =
      u.searchParams.get('service_recid') ||
      u.searchParams.get('recid') ||
      u.searchParams.get('serviceTicketId');
    if (idFromUrl) return idFromUrl;

    // 3) Time Entry charge-to wait path
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
        <div>Need a different duration or multiple contacts? Use the TimeZest pod and advanced options in ConnectWise.</div>
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

    // actions
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

  // ---------- Button rendering ----------
  function makeActionButton() {
    // Match CW action button structure; fully keyboard-accessible
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    outer.setAttribute('data-origin', 'attentus');

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
    // Compact inline variant for clipboard bar
    const b = document.createElement('button');
    b.type = 'button';
    b.id = BTN_ID;
    b.className = 'mm_button';
    b.setAttribute('data-origin', 'attentus');
    b.setAttribute('aria-label', 'Copy TimeZest Link');
    b.title = 'Click: Help Desk Team (30m). Right-click: Personal (30m). Shift-click: Settings.';
    b.textContent = 'Copy TimeZest';
    return b;
  }

  // ---------- Wiring ----------
  function wireHandlers(clickTarget, pulseTarget, labelEl) {
    // Left-click: Team link (or Shift-click to open settings)
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

    // Right-click: Personal link
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

    // Keyboard support: Enter/Space = click handler
    clickTarget.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickTarget.click();
      }
    });
  }

  function htmlLink(href, text) {
    return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // ---------- Placement ----------
  function validAnchor(el) {
    if (!el) return false;
    // Never inject inside CW modal/flyout windows
    if (el.closest && el.closest('.cw-gxt-wnd')) return false;
    return true;
  }

  function findAnchor() {
    // 1) If the clipboard bar group exists, prefer it (compact inline)
    const group = document.getElementById(CLIPBOARD_GROUP_ID);
    if (validAnchor(group)) return group;

    // 2) Ticket header action bar (preferred)
    const actions = document.querySelector('.pod_ticketHeaderActions, .cw-CwActionBar');
    if (validAnchor(actions)) return actions;

    // 3) Else, the parent of a CW action button (Follow/Unfollow etc.)
    const anyBtn = document.querySelector('[aria-label="Follow"], [aria-label="Unfollow"], .cw_CwActionButton');
    const container = anyBtn && anyBtn.parentElement;
    if (validAnchor(container)) return container;

    return null;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;

    // Respect gating up-front
    if (!AttentusCW.isTicketOrTimeEntryPage()) return false;

    // 1) Inline clipboard bar
    const group = document.getElementById(CLIPBOARD_GROUP_ID);
    if (validAnchor(group)) {
      const b = makeInlineButton();
      wireHandlers(b, b, b); // inline variant uses itself as label/pulse target
      group.appendChild(b);
      return true;
    }

    // 2) Standard CW action toolbar
    const anchor = findAnchor();
    if (!anchor) return false;

    const actionBtn = makeActionButton();
    anchor.appendChild(actionBtn);
    return true;
  }

  function tryMount() {
    if (!AttentusCW.isTicketOrTimeEntryPage()) return;
    AttentusCW.ensureMounted(
      () => !!findAnchor(),
      () => { addStyles(); placeButton(); }
    );
  }

  // ---------- Init / SPA ----------
  addStyles();
  tryMount();
  AttentusCW.observeSpa(tryMount);

  /* ---------------------------------------------
     Selectors QA — Ticket / Time Entry
     ---------------------------------------------
     ## Gating
     - Page test(s): URL includes /Service/Tickets/Detail.aspx or /Tickets/Detail.aspx, or DOM has .pod_ticketSummary / .pod_timeEntryDetails
     - Must-not-fire on: .cw-gxt-wnd (modal windows), Time Sheet grid

     ## Anchor Region
     - Primary inline: #cw-notes-inline-copy-group (clipboard bar)
     - Header/start: .pod_ticketHeaderActions (preferred), .cw-CwActionBar (fallback)
     - Region end: toolbar/action container
     - Observer root: #cwContent (fallback .cw-WorkspaceView, body)
     - Ignore: .cw-gxt-wnd, #attentus-*

     ## Key Rows → Values
     - Ticket ID: banner “Service Ticket #” label, URL params (?service_recid|recid|serviceTicketId), or Time Entry “Charge To”
     - Personal link name: GM values tz_firstname / tz_lastname (onboarding flyout)

     ## Modal/Flyout
     - Settings flyout id: #${FLY_ID}
     - Fields: #${FLY_ID}-first, #${FLY_ID}-last
     - Close: [id="${FLY_ID}-close"], [id="${FLY_ID}-cancel"]

     ## Placement
     - Prefer inline group when present, else mount as CW action button in header actions
  ---------------------------------------------- */
})();
