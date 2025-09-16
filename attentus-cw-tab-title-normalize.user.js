// ==UserScript==
// @name         attentus-cw-tab-title-normalize
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.1.0
// @description  Ticket tabs: “#123456 - Summary - Company” (company toggleable). Service Board tabs: set to the active View name (toggleable). Time Entry tabs: “#123456 - Time Entry” when possible. More reliable in background tabs; listens to the View combobox; responds to Open-Views event.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js
// ==/UserScript==

(() => {
  'use strict';

  // -------------------- storage helpers --------------------
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

  // -------------------- settings --------------------
  const K_COMPANY   = 'att_tab_title_add_company';
  const K_SB_RENAME = 'att_tab_title_rename_serviceboard';
  const K_TE_TICKET = 'att_tab_title_timeentry_ticket';

  const DEFAULTS = { [K_COMPANY]: true, [K_SB_RENAME]: true, [K_TE_TICKET]: true };
  const SETTINGS = { ...DEFAULTS };
  let settingsReady = (async () => {
    SETTINGS[K_COMPANY]   = !!(await gmGet(K_COMPANY,   DEFAULTS[K_COMPANY]));
    SETTINGS[K_SB_RENAME] = !!(await gmGet(K_SB_RENAME, DEFAULTS[K_SB_RENAME]));
    SETTINGS[K_TE_TICKET] = !!(await gmGet(K_TE_TICKET, DEFAULTS[K_TE_TICKET]));
  })();

  // -------------------- tiny utils --------------------
  const ORIGINAL_TITLE = document.title;
  const isVisible = (el) => !!el && el.nodeType === 1 && el.offsetParent !== null;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const MIN_TICKET_DIGITS = 5;

  function titleParts(id, summary, company, includeCompany) {
    const parts = [];
    if (id) parts.push(`#${id}`);
    if (summary) parts.push(summary);
    if (includeCompany && company) parts.push(company);
    return parts.join(' - ').trim();
  }

  // -------------------- page kind detection --------------------
  function isServiceBoardList() {
    return !!document.querySelector('table.srboard-grid tr.cw-ml-row');
  }
  function isTimeEntryPage() {
    const href = location.href.toLowerCase();
    if (/\btime[_-]?entry\b/.test(href) || /timeentry/.test(href)) return true;
    const labels = document.querySelectorAll('.GMDB3DUBBPG, .GMDB3DUBORG, .gwt-Label.mm_label, [id$="-label"]');
    for (const el of labels) {
      const t = norm(el.textContent);
      if (t && t.toLowerCase().includes('time entry')) return true;
    }
    if (document.querySelector('input.cw_timeStart') || document.querySelector('input.cw_timeEnd')) return true;
    return false;
  }

  // -------------------- ticket fields --------------------
  function ticketIdFromUrl() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('service_recid');
      if (q && /^\d+$/.test(q) && q.length >= MIN_TICKET_DIGITS) return q;
      const pm = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d+)(?:$|[/?#])/i);
      if (pm && pm[1] && pm[1].length >= MIN_TICKET_DIGITS) return pm[1];
    } catch {}
    return '';
  }
  function ticketIdFromDom() {
    const cands = document.querySelectorAll(
      '[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBNLI, .GMDB3DUBLHH, .GMDB3DUBIHH, .GMDB3DUBORG, .GMDB3DUBBPG'
    );
    for (const el of cands) {
      if (!isVisible(el)) continue;
      const m = norm(el.textContent).match(/ticket\s*#\s*(\d+)/i);
      if (m && m[1] && m[1].length >= MIN_TICKET_DIGITS) return m[1];
    }
    return '';
  }
  function getTicketId() { return ticketIdFromUrl() || ticketIdFromDom() || ''; }

  function getSummary() {
    const input =
      document.querySelector('input.cw_PsaSummaryHeader') ||
      document.querySelector('input.cw_summary') ||
      document.querySelector('input[placeholder*="summary" i]');
    if (input && input.value) return norm(input.value);
    const lbls = document.querySelectorAll('[id$="-label"], .GMDB3DUBORG, .gwt-Label, .mm_label');
    for (const el of lbls) {
      if (!isVisible(el)) continue;
      const m1 = norm(el.textContent).match(/^summary:\s*(.+)$/i);
      if (m1) return norm(m1[1]);
    }
    return '';
  }
  function getCompany() {
    const labels = document.querySelectorAll('[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBORG, .GMDB3DUBBPG');
    for (const el of labels) {
      if (!isVisible(el)) continue;
      const m = norm(el.textContent).match(/^\s*company:\s*(.+)$/i);
      if (m) return norm(m[1]);
    }
    const inp = document.querySelector('input.cw_company') || document.querySelector('input[placeholder*="company" i]');
    if (inp && inp.value) return norm(inp.value);
    return '';
  }

  // ----- Time Entry: resolve ticket from Charge To -----
  function parseTicketId(raw) { const m = String(raw || '').match(/(\d{5,})/); return m ? m[1] : null; }
  function getTicketIdFromChargeToOnce() {
    const sel = 'input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"], input.GKV5JQ3DMVF.cw_ChargeToTextBox';
    const inp = document.querySelector(sel);
    if (!inp) return null;
    let id = parseTicketId(inp.value); if (id) return id;
    const scope = inp.closest('td,div') || document;
    const hid = scope.querySelector('input[type="hidden"][value], input[type="hidden"][name*="ChargeTo"]');
    id = parseTicketId(hid && hid.value); if (id) return id;
    const activeId = inp.getAttribute('aria-activedescendant');
    if (activeId) {
      const activeEl = document.getElementById(activeId);
      id = parseTicketId(activeEl && activeEl.textContent);
      if (id) return id;
    }
    return null;
  }

  // -------------------- Service Board View name --------------------
  function getServiceBoardViewName() {
    const root = document.querySelector('.cw-toolbar-view-dropdown') || document;
    const inp = root.querySelector('input.cw_CwComboBox') || root.querySelector('input[placeholder*="view" i]');
    const v = (inp && (inp.value || inp.getAttribute('value'))) || '';
    return norm(v);
  }

  // -------------------- scheduler (background-safe) --------------------
  const schedule = (() => {
    let pending = false, lastRun = 0;
    const MIN_MS = 120;

    const run = () => {
      pending = false;
      const now = Date.now();
      if (now - lastRun < MIN_MS) {
        pending = true;
        setTimeout(run, MIN_MS);
        return;
      }
      lastRun = now;
      updateTitle();
    };

    return () => {
      if (pending) return;
      pending = true;

      // Hidden tabs: rIC/rAF stall — use setTimeout
      if (document.hidden) { setTimeout(run, 0); return; }

      if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 400 });
      else if ('requestAnimationFrame' in window) requestAnimationFrame(run);
      else setTimeout(run, 0);
    };
  })();

  // Background poller to catch CW rehydration while hidden
  let hiddenPoller = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!hiddenPoller) hiddenPoller = setInterval(() => updateTitle(), 1500);
    } else {
      if (hiddenPoller) { clearInterval(hiddenPoller); hiddenPoller = null; }
      schedule();
    }
  }, { passive: true });

  // Open-Views integration: refresh title immediately after a view is applied
  window.addEventListener('att:openviews-applied', () => schedule(), { passive: true });

  const sig = (o) => Object.values(o).map(v => String(v ?? '')).join('|');

  function pageSnapshot() {
    const ticketId = getTicketId();
    if (ticketId) {
      return { kind: 'ticket', id: ticketId, summary: getSummary(), company: getCompany(), url: location.pathname + location.search };
    }
    if (isTimeEntryPage()) {
      const tid = getTicketIdFromChargeToOnce() || ticketIdFromUrl() || '';
      return { kind: 'time', id: tid, url: location.pathname + location.search };
    }
    if (isServiceBoardList()) {
      return { kind: 'board', view: getServiceBoardViewName(), url: location.pathname + location.search };
    }
    return { kind: 'other', url: location.pathname + location.search };
  }

  let lastSnapshotSig = '';

  // -------------------- title update engine --------------------
  async function updateTitle() {
    const snap = pageSnapshot();
    const snapSig = sig(snap);
    if (snapSig === lastSnapshotSig) return;
    lastSnapshotSig = snapSig;

    await settingsReady;

    if (snap.kind === 'ticket') {
      const next = titleParts(snap.id, snap.summary, snap.company, !!SETTINGS[K_COMPANY]);
      if (next && document.title !== next) document.title = next;
      return;
    }

    if (snap.kind === 'time') {
      let title = 'Time Entry';
      if (SETTINGS[K_TE_TICKET] && snap.id) title = `#${snap.id} - Time Entry`;
      if (document.title !== title) document.title = title;
      return;
    }

    if (snap.kind === 'board') {
      if (SETTINGS[K_SB_RENAME]) {
        const view = snap.view && snap.view.trim();
        if (view && document.title !== view) document.title = view;
        return;
      }
    }

    // Unknown: restore original if necessary
    if (!isServiceBoardList()) {
      if (document.title !== ORIGINAL_TITLE && !document.title) {
        document.title = ORIGINAL_TITLE;
      }
    }
  }

  function attachFieldListeners() {
    const sels = [
      'input.cw_PsaSummaryHeader',
      'input.cw_summary',
      'input.cw_company',
      'input[placeholder*="summary" i]',
      'input[placeholder*="company" i]',
      // Listen to the Service Board View combobox directly
      '.cw-toolbar-view-dropdown input.cw_CwComboBox, .cw-toolbar-view-dropdown input[type="text"]'
    ];
    document.querySelectorAll(sels.join(',')).forEach(el => {
      ['input','change','keyup','keydown','blur'].forEach(ev => {
        el.removeEventListener(ev, schedule);
        el.addEventListener(ev, schedule, { passive: true });
      });
    });
  }

  // -------------------- Settings UI + placement (unchanged) --------------------
  const BTN_ID = 'cw-tabtitle-settings-btn';
  const TD_ID  = 'cw-tabtitle-settings-td';

  function buildSettingsButton() {
    const b = document.createElement('button');
    b.id = BTN_ID; b.type = 'button'; b.title = 'Tab Title Settings'; b.textContent = '⚙︎';
    Object.assign(b.style, {
      padding: '3px 7px', borderRadius: '6px', border: '1px solid rgba(0,0,0,.2)', background: '#fff',
      cursor: 'pointer', height: '26px', lineHeight: '18px',
      font: '14px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif', userSelect: 'none', whiteSpace: 'nowrap'
    });
    b.addEventListener('click', openSettings);
    return b;
  }

  async function openSettings() {
    await settingsReady;
    const addCompany  = !!SETTINGS[K_COMPANY];
    const sbRename    = !!SETTINGS[K_SB_RENAME];
    const teUseTicket = !!SETTINGS[K_TE_TICKET];

    const overlay = document.createElement('div');
    Object.assign(overlay.style, { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 2147483646 });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      position: 'absolute', top: '12%', left: '50%', transform: 'translateX(-50%)',
      width: 'min(420px, 92vw)', background: '#fff', color: '#111',
      borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      padding: '14px', font: '13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif'
    });
    modal.innerHTML = `
      <div style="font-weight:600; font-size:14px; margin-bottom:8px;">Tab Title Settings</div>
      <label style="display:flex; align-items:center; gap:8px; margin:6px 0;">
        <input type="checkbox" id="att_cc" ${addCompany ? 'checked' : ''}>
        <span>Append company to ticket tabs</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin:6px 0;">
        <input type="checkbox" id="att_sb" ${sbRename ? 'checked' : ''}>
        <span>Rename Service Board tabs to the active View</span>
      </label>
      <label style="display:flex; align-items:center; gap:8px; margin:6px 0;">
        <input type="checkbox" id="att_te" ${teUseTicket ? 'checked' : ''}>
        <span>Add ticket# to Time entry tabs and windows</span>
      </label>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
        <button id="att_cancel" style="padding:6px 10px; border:1px solid #ddd; border-radius:6px; background:#fff; cursor:pointer;">Close</button>
        <button id="att_save"   style="padding:6px 10px; border:1px solid rgba(0,0,0,.2); border-radius:6px; background:#2563eb; color:#fff; cursor:pointer;">Save</button>
      </div>
    `;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector('#att_cancel').onclick = () => overlay.remove();
    modal.querySelector('#att_save').onclick = async () => {
      const newAddCompany  = !!modal.querySelector('#att_cc').checked;
      const newSbRename    = !!modal.querySelector('#att_sb').checked;
      const newTeUseTicket = !!modal.querySelector('#att_te').checked;

      await gmSet(K_COMPANY,   newAddCompany);
      await gmSet(K_SB_RENAME, newSbRename);
      await gmSet(K_TE_TICKET, newTeUseTicket);

      SETTINGS[K_COMPANY]   = newAddCompany;
      SETTINGS[K_SB_RENAME] = newSbRename;
      SETTINGS[K_TE_TICKET] = newTeUseTicket;
      settingsReady = Promise.resolve();

      overlay.remove();
      schedule();
    };
  }

  function ensureSettingsPlaced() {
    if (document.getElementById(BTN_ID)) return true;

    const quickNavInput = document.getElementById('cw-ticket-input');
    if (quickNavInput) {
      const qTd = quickNavInput.closest('td');
      const qTr = qTd && qTd.closest('tr');
      if (qTd && qTr) {
        const newTd = document.createElement('td');
        newTd.id = TD_ID; newTd.align = 'left'; newTd.style.verticalAlign = 'middle'; newTd.style.paddingLeft = '8px';
        newTd.appendChild(buildSettingsButton());
        qTr.insertBefore(newTd, qTd);
        return true;
      }
    }

    let ticketsLabel = Array.from(document.querySelectorAll('.GMDB3DUBORG, [class*="ORG"]'))
      .find(el => norm(el.textContent).toLowerCase() === 'tickets');
    if (!ticketsLabel) ticketsLabel = document.querySelector('.cw_CwTextMenuButton .GMDB3DUBORG');

    const tTd = ticketsLabel && ticketsLabel.closest('td');
    const tTr = tTd && tTd.closest('tr');
    if (tTd && tTr) {
      const newTd = document.createElement('td');
      newTd.id = TD_ID; newTd.align = 'left'; newTd.style.verticalAlign = 'middle'; newTd.style.paddingLeft = '8px';
      newTd.appendChild(buildSettingsButton());
      tTr.insertBefore(newTd, tTd);
      return true;
    }

    return false;
  }

  // -------------------- observers / SPA hooks --------------------
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        attachFieldListeners();
        ensureSettingsPlaced();
        schedule();
        return;
      }
      if (m.type === 'attributes') {
        const name = m.attributeName || '';
        if (name === 'value' || name === 'placeholder' || name === 'title' || name === 'aria-activedescendant') {
          attachFieldListeners();
          ensureSettingsPlaced();
          schedule();
          return;
        }
      }
    }
  });
  mo.observe(document.body || document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['value', 'placeholder', 'title', 'aria-activedescendant']
  });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(() => { attachFieldListeners(); ensureSettingsPlaced(); schedule(); });
      return r;
    };
  });
  window.addEventListener('popstate', () => { attachFieldListeners(); ensureSettingsPlaced(); schedule(); });
  window.addEventListener('focus', () => schedule(), { passive: true });

  // -------------------- kick off --------------------
  (async () => { await settingsReady; attachFieldListeners(); ensureSettingsPlaced(); schedule(); })();
})();
