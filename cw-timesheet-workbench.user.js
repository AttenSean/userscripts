// ==UserScript==
// @name         CW Timesheet Workbench
// @namespace    https://github.com/AttentusTechnologies/userscripts
// @version      0.1.0
// @description  Read-only ConnectWise Manage Daily Time Entries gap finder and JSON preview. Does not save, copy, submit, delete, or modify ConnectWise data.
// @match        https://*.myconnectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttentusTechnologies/userscripts/main/cw-timesheet-workbench.user.js
// @updateURL    https://raw.githubusercontent.com/AttentusTechnologies/userscripts/main/cw-timesheet-workbench.user.js
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'cw-timesheet-workbench';
  const BUTTON_ID = `${APP}-button`;
  const MODAL_ID = `${APP}-modal`;
  const STYLE_ID = `${APP}-style`;
  const SETTINGS_KEY = `${APP}:settings:v1`;
  const DEFAULT_SETTINGS = { minGapMinutes: 3, debug: false };
  const SAFE_ACTION_TEXT = new Set(['save', 'save and close', 'copy', 'new', 'submit', 'ok', 'delete']);

  const state = { observer: null, injectTimer: 0 };

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      minGapMinutes: clampNumber(settings.minGapMinutes, 1, 240, DEFAULT_SETTINGS.minGapMinutes),
      debug: !!settings.debug
    }));
  }

  function log(...args) {
    if (loadSettings().debug) console.log('[CW Timesheet Workbench]', ...args);
  }

  function textOf(el) {
    return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').trim();
  }

  function normalize(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function isDailyTimeEntriesPage() {
    const bodyText = textOf(document.body);
    return bodyText.includes('Daily Time Entries') && bodyText.includes('Open Calendar View');
  }

  function findOpenCalendarButton() {
    return Array.from(document.querySelectorAll('button, div, span, a'))
      .find(el => textOf(el) === 'Open Calendar View' && isVisible(el));
  }

  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID}{margin-left:8px;padding:5px 10px;border:1px solid #2271b1;border-radius:4px;background:#f0f6fc;color:#135e96;font:12px/1.2 Arial,sans-serif;cursor:pointer;z-index:9999}
      #${BUTTON_ID}:hover{background:#dbeffd}
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.35);font:13px/1.4 Arial,sans-serif;color:#1f2933}
      #${MODAL_ID} .cwtw-dialog{box-sizing:border-box;width:min(900px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;margin:16px auto;background:#fff;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px}
      #${MODAL_ID} h2{margin:0 0 8px;font-size:18px} #${MODAL_ID} h3{margin:16px 0 6px;font-size:14px}
      #${MODAL_ID} .cwtw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
      #${MODAL_ID} input[type=number]{width:70px} #${MODAL_ID} textarea{width:100%;min-height:120px;box-sizing:border-box;font-family:Consolas,monospace;font-size:12px}
      #${MODAL_ID} table{width:100%;border-collapse:collapse;margin:6px 0} #${MODAL_ID} th,#${MODAL_ID} td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
      #${MODAL_ID} th{background:#f6f8fa} #${MODAL_ID} .cwtw-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;position:sticky;bottom:0;background:#fff;padding-top:8px}
      #${MODAL_ID} button{padding:5px 10px;cursor:pointer} #${MODAL_ID} .cwtw-status{padding:8px;border-radius:4px;background:#f6f8fa;border:1px solid #d0d7de}.cwtw-error{background:#fff5f5!important;border-color:#f2a6a6!important;color:#8a1f11}.cwtw-note{color:#57606a;font-size:12px}`;
    document.head.appendChild(style);
  }

  function injectButton() {
    if (!isDailyTimeEntriesPage() || document.getElementById(BUTTON_ID)) return;
    const anchor = findOpenCalendarButton();
    if (!anchor) return log('Open Calendar View anchor not found.');
    ensureStyles();
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Timesheet Workbench';
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showWorkbench(); });
    anchor.insertAdjacentElement('afterend', button);
    log('Injected workbench button.');
  }

  function scheduleInject() {
    clearTimeout(state.injectTimer);
    state.injectTimer = setTimeout(injectButton, 250);
  }

  function startObserver() {
    scheduleInject();
    state.observer = new MutationObserver(scheduleInject);
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function isExcludedFromGridParsing(el) {
    return !!el.closest(`#${MODAL_ID}, #${BUTTON_ID}, [role="dialog"], [aria-modal="true"], .modal, .popup, .popover, .dropdown-menu, .sidebar, .side-bar, .toolbar, [role="toolbar"], nav, header, footer`);
  }

  function isGridCellLike(el) {
    if (!isVisible(el) || isExcludedFromGridParsing(el)) return false;
    const text = textOf(el);
    if (!text) return false;
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const className = String(el.className || '').toLowerCase();
    return tag === 'td' || tag === 'th' || role === 'gridcell' || role === 'columnheader' ||
      el.hasAttribute('cellindex') || el.hasAttribute('aria-colindex') || el.hasAttribute('__gwt_cell') ||
      /(^|\s)(x-grid-cell|x-grid3-cell|grid-cell|cell|cw-ml-clickable-cell)(\s|$)/.test(className);
  }

  function discoverGrid() {
    const required = ['Company Name', 'Description', 'Date', 'Start Time', 'End Time', 'Hours'];
    const selectors = [
      'table', '[role="grid"]', '[role="table"]', '[class*="mm_grid"]', '[class*="grid"]', '[class*="Grid"]',
      '[class*="x-grid"]', '[class*="gwt"]', '[class*="data-grid"]', '[class*="datatable"]'
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')))
      .filter(el => isVisible(el) && !isExcludedFromGridParsing(el))
      .map(el => {
        const text = textOf(el);
        const rect = el.getBoundingClientRect();
        const headerScore = required.reduce((score, header) => score + (text.includes(header) ? 1 : 0), 0);
        const cellScore = el.querySelectorAll('tr, td[cellindex], td[aria-colindex], [role="row"], [role="gridcell"], [cellindex], .cw-ml-clickable-cell').length;
        return { el, text, headerScore, cellScore, area: rect.width * rect.height };
      })
      .filter(item => item.headerScore >= required.length - 1 && item.cellScore > 0)
      .sort((a, b) => b.headerScore - a.headerScore || b.cellScore - a.cellScore || a.area - b.area);
    const chosen = candidates[0]?.el || null;
    log('Chosen grid element:', chosen, candidates.map(item => ({ tag: item.el.tagName, className: item.el.className, headerScore: item.headerScore, cellScore: item.cellScore })));
    return chosen;
  }

  function detectColumns(grid) {
    const headerNames = ['Company Name', 'Description', 'Date', 'Start Time', 'End Time', 'Hours', 'Billable', 'Work Type', 'Work Role', 'Status', 'Agreement', 'Agreement Type', 'Invoice #'];
    const cells = Array.from(grid.querySelectorAll('th, td, [role="columnheader"], [role="gridcell"], [cellindex], [aria-colindex], div, span'))
      .filter(el => isVisible(el) && !isExcludedFromGridParsing(el));
    const found = [];
    for (const name of headerNames) {
      const cell = cells.find(el => textOf(el) === name);
      if (cell) {
        const rect = cell.getBoundingClientRect();
        const explicitIndex = Number(cell.getAttribute('cellindex') || cell.getAttribute('aria-colindex'));
        found.push({ name, left: rect.left, top: rect.top, index: Number.isFinite(explicitIndex) ? explicitIndex : null });
      }
    }
    found.sort((a, b) => (a.index ?? a.left) - (b.index ?? b.left));
    const columns = {};
    found.forEach((h, index) => { columns[h.name] = h.index != null ? h.index : index; });
    log('Detected headers:', found, columns);
    return { headers: found, columns };
  }

  function extractRows(grid, columns) {
    const headerLabels = new Set(Object.keys(columns));
    const tableRows = Array.from(grid.querySelectorAll('tr')).filter(row => isVisible(row) && !isExcludedFromGridParsing(row));
    const dataTableRows = tableRows
      .map(row => Array.from(row.querySelectorAll('td, th')).filter(isVisible).map(textOf))
      .filter(cells => cells.length && !cells.some(cell => headerLabels.has(cell)));
    if (dataTableRows.length) {
      log('Extracted raw rows:', dataTableRows);
      return dataTableRows;
    }

    const rowElements = Array.from(grid.querySelectorAll('[role="row"]')).filter(row => isVisible(row) && !isExcludedFromGridParsing(row));
    const roleRows = rowElements.map(row => Array.from(row.querySelectorAll('[role="gridcell"], td, [cellindex], [aria-colindex]')).filter(isGridCellLike));
    const normalizedRoleRows = roleRows.map(rowCells => normalizeCells(rowCells)).filter(cells => cells.length && !cells.some(cell => headerLabels.has(cell)));
    if (normalizedRoleRows.length) {
      log('Extracted raw rows:', normalizedRoleRows);
      return normalizedRoleRows;
    }

    const cellLike = Array.from(grid.querySelectorAll('td[cellindex], td[aria-colindex], td, [role="gridcell"], [cellindex], [aria-colindex], [__gwt_cell], .x-grid-cell, .x-grid3-cell, .grid-cell, .cw-ml-clickable-cell'))
      .filter(isGridCellLike)
      .filter(cell => !headerLabels.has(textOf(cell)));
    const rowMap = new Map();
    cellLike.forEach(cell => {
      const rect = cell.getBoundingClientRect();
      const key = Math.round(rect.top / 4) * 4;
      if (!rowMap.has(key)) rowMap.set(key, []);
      rowMap.get(key).push(cell);
    });
    const rows = Array.from(rowMap.values()).map(normalizeCells).filter(cells => cells.length);
    log('Extracted raw rows:', rows);
    return rows;
  }

  function normalizeCells(cellElements) {
    const maxExplicitIndex = cellElements.reduce((max, cell) => {
      const value = Number(cell.getAttribute('cellindex') || cell.getAttribute('aria-colindex'));
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, -1);
    if (maxExplicitIndex >= 0) {
      const cells = [];
      cellElements.forEach(cell => {
        const explicitIndex = Number(cell.getAttribute('cellindex') || cell.getAttribute('aria-colindex'));
        if (Number.isFinite(explicitIndex)) cells[explicitIndex] = textOf(cell);
      });
      return cells.map(value => value || '');
    }
    return cellElements
      .map(cell => ({ left: cell.getBoundingClientRect().left, text: textOf(cell) }))
      .sort((a, b) => a.left - b.left)
      .map(cell => cell.text);
  }

  function parseTimeToMinutes(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const meridian = match[3].toUpperCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (meridian === 'AM' && hour === 12) hour = 0;
    if (meridian === 'PM' && hour !== 12) hour += 12;
    return hour * 60 + minute;
  }

  function formatMinutes(total) {
    const minutes = ((Math.round(total) % 1440) + 1440) % 1440;
    let hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const meridian = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return `${hour}:${String(minute).padStart(2, '0')} ${meridian}`;
  }

  function getIntervals() {
    const grid = discoverGrid();
    if (!grid) return { intervals: [], error: 'Could not find a visible Daily Time Entries grid with the expected headers.' };
    const { columns } = detectColumns(grid);
    if (columns['Start Time'] == null || columns['End Time'] == null) return { intervals: [], error: 'Could not detect Start Time and End Time columns.' };
    const rows = extractRows(grid, columns);
    const candidates = rows.map((cells, rowIndex) => {
      const startText = cells[columns['Start Time']];
      const endText = cells[columns['End Time']];
      const start = parseTimeToMinutes(startText);
      const end = parseTimeToMinutes(endText);
      return { rowIndex: rowIndex + 1, startText, endText, start, end };
    });
    log('Candidate Start/End values per row:', candidates);
    const intervals = candidates.filter(item => item.start != null && item.end != null && item.end > item.start);
    return { intervals, error: intervals.length ? '' : 'No valid Start Time / End Time intervals were detected in visible rows.' };
  }

  function mergeIntervals(intervals) {
    const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    sorted.forEach(item => {
      const last = merged[merged.length - 1];
      if (!last || item.start > last.end) merged.push({ start: item.start, end: item.end });
      else last.end = Math.max(last.end, item.end);
    });
    return merged;
  }

  function calculateGaps(merged, minGapMinutes) {
    const gaps = [];
    for (let i = 0; i < merged.length - 1; i += 1) {
      const gap = { start: merged[i].end, end: merged[i + 1].start };
      if (gap.end - gap.start >= minGapMinutes) gaps.push(gap);
    }
    return gaps;
  }

  function sumMinutes(items) {
    return items.reduce((total, item) => total + Math.max(0, item.end - item.start), 0);
  }

  function minutesLabel(minutes) {
    return `${(minutes / 60).toFixed(2)} hrs (${minutes} min)`;
  }

  function gapJson(gaps) {
    return JSON.stringify(gaps.map(g => ({ start: formatMinutes(g.start), end: formatMinutes(g.end) })), null, 2);
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') return GM_setClipboard(text, 'text');
    if (typeof GM !== 'undefined' && GM.setClipboard) return GM.setClipboard(text, 'text');
    return navigator.clipboard.writeText(text);
  }

  function showWorkbench() {
    ensureStyles();
    const settings = loadSettings();
    const { intervals, error } = getIntervals();
    const merged = mergeIntervals(intervals);
    const gaps = calculateGaps(merged, settings.minGapMinutes);
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Timesheet Workbench">
        <h2>Timesheet Workbench <span class="cwtw-note">read-only v0.1</span></h2>
        <div class="cwtw-status ${error ? 'cwtw-error' : ''}">${escapeHtml(error || `Detected ${intervals.length} valid visible interval(s), merged into ${merged.length} block(s).`)}</div>
        <div class="cwtw-row"><label>Minimum gap minutes <input id="cwtw-min-gap" type="number" min="1" max="240" step="1" value="${settings.minGapMinutes}"></label><label><input id="cwtw-debug" type="checkbox" ${settings.debug ? 'checked' : ''}> Debug logging</label><button id="cwtw-refresh" type="button">Refresh Preview</button></div>
        <div class="cwtw-note">Milestone 2 write actions would hook in after a user selects one of these gaps from an open Time Entry window. This v0.1 script never clicks ConnectWise Save, Copy, New, Submit, OK, Delete, or other action buttons.</div>
        <h3>Summary</h3><table><tbody><tr><th>Total logged from merged intervals</th><td>${minutesLabel(sumMinutes(merged))}</td></tr><tr><th>Total detected gap time</th><td>${minutesLabel(sumMinutes(gaps))}</td></tr></tbody></table>
        <h3>Existing intervals</h3>${renderIntervalTable(merged)}
        <h3>Detected gaps</h3>${renderIntervalTable(gaps)}
        <h3>Copyable gap JSON</h3><textarea id="cwtw-json" readonly>${escapeHtml(gapJson(gaps))}</textarea>
        <div class="cwtw-actions"><span id="cwtw-copy-status" class="cwtw-note"></span><button id="cwtw-copy-json" type="button">Copy JSON</button><button id="cwtw-close" type="button">Close</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cwtw-refresh').addEventListener('click', () => {
      saveSettings({ minGapMinutes: modal.querySelector('#cwtw-min-gap').value, debug: modal.querySelector('#cwtw-debug').checked });
      showWorkbench();
    });
    modal.querySelector('#cwtw-copy-json').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-copy-status');
      try { await copyText(modal.querySelector('#cwtw-json').value); status.textContent = 'Copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
  }

  function renderIntervalTable(items) {
    if (!items.length) return '<div class="cwtw-status">None detected.</div>';
    return `<table><thead><tr><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>${items.map(item => `<tr><td>${formatMinutes(item.start)}</td><td>${formatMinutes(item.end)}</td><td>${item.end - item.start} min</td></tr>`).join('')}</tbody></table>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // Safety guard for v0.1: this script only reads the grid and writes its own UI/localStorage.
  // Milestone 2 can add explicitly confirmed field updates near .cw_startTime/.cw_endTime here,
  // but must remain separate from all ConnectWise toolbar/action buttons listed below.
  document.addEventListener('click', event => {
    const label = normalize(textOf(event.target));
    if (SAFE_ACTION_TEXT.has(label)) log('Observed ConnectWise action label; v0.1 did not initiate it:', label);
  }, true);

  startObserver();
})();
