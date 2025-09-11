// ==UserScript==
// @name         attentus-cw-tab-title-normalize
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.9.0
// @description  Ticket tabs: “#123456 - Summary - Company” (company toggleable). Service Board tabs: set to the active View name (toggleable). Time Entry tabs: “#123456 - Time Entry” when possible.
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

  // -------------------- storage helpers (VM/TM + fallback) --------------------
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
  const K_COMPANY   = 'att_tab_title_add_company';        // boolean
  const K_SB_RENAME = 'att_tab_title_rename_serviceboard';// boolean
  const K_TE_TICKET = 'att_tab_title_timeentry_ticket';   // boolean

  const DEFAULTS = { [K_COMPANY]: true, [K_SB_RENAME]: true, [K_TE_TICKET]: true };

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
    // presence of the grid is the most reliable indicator
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
  function getTicketId() {
    return ticketIdFromUrl() || ticketIdFromDom() || '';
  }

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

  // ----- Time Entry: resolve ticket from Charge To (matches our other scripts) -----
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
    // Look for the dropdown container, then the input with the current value (placeholder often "(No View)")
    const root = document.querySelector('.cw-toolbar-view-dropdown') || document;
    const inp = root.querySelector('input.cw_CwComboBox') || root.querySelector('input[placeholder*="view" i]');
    const v = (inp && (inp.value || inp.getAttribute('value'))) || '';
    return norm(v);
  }

  // -------------------- title update engine --------------------
  let rafTick = false;
  async function updateTitle() {
    if (rafTick) return;
    rafTick = true;
    requestAnimationFrame(async () => {
      rafTick = false;

      const addCompany   = !!(await gmGet(K_COMPANY,   DEFAULTS[K_COMPANY]));
      const sbRename     = !!(await gmGet(K_SB_RENAME, DEFAULTS[K_SB_RENAME]));
      const teUseTicket  = !!(await gmGet(K_TE_TICKET, DEFAULTS[K_TE_TICKET]));

      // 1) Ticket pages
      const id = getTicketId();
      if (id) {
        const next = titleParts(id, getSummary(), getCompany(), addCompany);
        if (next && document.title !== next) document.title = next;
        return;
      }

      // 2) Time Entry pages
      if (isTimeEntryPage()) {
        let title = 'Time Entry';
        if (teUseTicket) {
          const fromCharge = getTicketIdFromChargeToOnce();
          const fallbackUrl = ticketIdFromUrl();
          const tid = fromCharge || fallbackUrl;
          if (tid) title = `#${tid} - Time Entry`;
        }
        if (document.title !== title) document.title = title;
        return;
      }

      // 3) Service Board (ticket queue) list pages
      if (isServiceBoardList()) {
        if (sbRename) {
          const view = getServiceBoardViewName();
          if (view && document.title !== view) {
            document.title = view; // set to active View name
          }
          return;
        }
      }

      // 4) Fallback: keep original for unknown pages
      if (!isServiceBoardList()) {
        if (document.title !== ORIGINAL_TITLE && !document.title) {
          document.title = ORIGINAL_TITLE;
        }
      }
    });
  }

  function attachFieldListeners() {
    const sels = [
      'input.cw_PsaSummaryHeader',
      'input.cw_summary',
      'input.cw_company',
      'input[placeholder*="summary" i]',
      'input[placeholder*="company" i]'
    ];
    document.querySelectorAll(sels.join(',')).forEach(el => {
      el.removeEventListener('input', updateTitle);
      el.removeEventListener('change', updateTitle);
      el.addEventListener('input', updateTitle, { passive: true });
      el.addEventListener('change', updateTitle, { passive: true });
    });
  }

  // -------------------- Settings UI + placement --------------------
  const BTN_ID = 'cw-tabtitle-settings-btn';
  const TD_ID  = 'cw-tabtitle-settings-td';

  function buildSettingsButton() {
    const b = document.createElement('button');
    b.id = BTN_ID;
    b.type = 'button';
    b.title = 'Tab Title Settings';
    b.textContent = '⚙︎';
    Object.assign(b.style, {
      padding: '3px 7px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,.2)',
      background: '#fff',
      cursor: 'pointer',
      height: '26px',
      lineHeight: '18px',
      font: '14px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif',
      userSelect: 'none',
      whiteSpace: 'nowrap'
    });
    b.addEventListener('click', openSettings);
    return b;
  }

  async function openSettings() {
    const addCompany  = !!(await gmGet(K_COMPANY,   DEFAULTS[K_COMPANY]));
    const sbRename    = !!(await gmGet(K_SB_RENAME, DEFAULTS[K_SB_RENAME]));
    const teUseTicket = !!(await gmGet(K_TE_TICKET, DEFAULTS[K_TE_TICKET]));

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
      await gmSet(K_COMPANY,   !!modal.querySelector('#att_cc').checked);
      await gmSet(K_SB_RENAME, !!modal.querySelector('#att_sb').checked);
      await gmSet(K_TE_TICKET, !!modal.querySelector('#att_te').checked);
      overlay.remove();
      updateTitle();
    };
  }

  function ensureSettingsPlaced() {
    if (document.getElementById(BTN_ID)) return true;

    // Prefer: immediately left of Quick-Nav ticket input (our userscript)
    const quickNavInput = document.getElementById('cw-ticket-input');
    if (quickNavInput) {
      const qTd = quickNavInput.closest('td');
      const qTr = qTd && qTd.closest('tr');
      if (qTd && qTr) {
        const newTd = document.createElement('td');
        newTd.id = TD_ID;
        newTd.align = 'left';
        newTd.style.verticalAlign = 'middle';
        newTd.style.paddingLeft = '8px';
        newTd.appendChild(buildSettingsButton());
        qTr.insertBefore(newTd, qTd); // left of Quick-Nav
        return true;
      }
    }

    // Fallback: immediately left of the native "Tickets" label/button
    let ticketsLabel = Array.from(document.querySelectorAll('.GMDB3DUBORG, [class*="ORG"]'))
      .find(el => norm(el.textContent).toLowerCase() === 'tickets');
    if (!ticketsLabel) ticketsLabel = document.querySelector('.cw_CwTextMenuButton .GMDB3DUBORG');

    const tTd = ticketsLabel && ticketsLabel.closest('td');
    const tTr = tTd && tTd.closest('tr');
    if (tTd && tTr) {
      const newTd = document.createElement('td');
      newTd.id = TD_ID;
      newTd.align = 'left';
      newTd.style.verticalAlign = 'middle';
      newTd.style.paddingLeft = '8px';
      newTd.appendChild(buildSettingsButton());
      tTr.insertBefore(newTd, tTd); // left of Tickets
      return true;
    }

    return false;
  }

  // -------------------- observers / SPA hooks --------------------
  const mo = new MutationObserver((muts) => {
    let relevant = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        relevant = true; break;
      }
      if (m.type === 'attributes' || m.type === 'characterData') {
        relevant = true; break;
      }
    }
    if (relevant) {
      attachFieldListeners();
      ensureSettingsPlaced();
      updateTitle();
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(() => { attachFieldListeners(); ensureSettingsPlaced(); updateTitle(); });
      return r;
    };
  });
  window.addEventListener('popstate', () => { attachFieldListeners(); ensureSettingsPlaced(); updateTitle(); });

  // -------------------- kick off --------------------
  attachFieldListeners();
  ensureSettingsPlaced();
  updateTitle();
})();
