// ==UserScript==
// @name         CW Timesheet Workbench
// @namespace    https://github.com/AttentusTechnologies/userscripts
// @version      0.2.0
// @description  ConnectWise Manage Daily Time Entries gap finder with confirmed Time Entry field fill. Does not click ConnectWise Save, Copy, Submit, Delete, or modify ConnectWise data via API.
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
  const FILL_PANEL_ID = `${APP}-fill-panel`;
  const STYLE_ID = `${APP}-style`;
  const SETTINGS_KEY = `${APP}:settings:v1`;
  const TEMPLATES_KEY = `${APP}:note-templates:v1`;
  const PENDING_FILL_KEY = `${APP}:pendingFill:v1`;
  const SCROLLER_SEL = '#mytimesheetdaygrid-listview-scroller';
  const START_CELL_SEL = 'td[cellindex="4"]';
  const END_CELL_SEL = 'td[cellindex="5"]';
  const DEFAULT_SETTINGS = { minGapMinutes: 3, debug: false, useWorkdayBoundary: false, workdayStart: '7:00 AM', workdayEnd: '4:00 PM', noteTemplate: 'coverage' };
  const DEFAULT_TEMPLATES = {
    coverage: { label: 'Gap coverage', template: 'Administrative catch-up / ticket follow-up from {start} to {end} ({hours} hrs).' },
    review: { label: 'Review / follow-up', template: 'Reviewed and followed up on outstanding service items from {start} to {end} ({minutes} min).' },
    admin: { label: 'Admin time', template: 'Administrative time from {start} to {end} ({hours} hrs).' }
  };
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
      debug: !!settings.debug,
      useWorkdayBoundary: !!settings.useWorkdayBoundary,
      workdayStart: normalizeTimeSetting(settings.workdayStart, DEFAULT_SETTINGS.workdayStart),
      workdayEnd: normalizeTimeSetting(settings.workdayEnd, DEFAULT_SETTINGS.workdayEnd),
      noteTemplate: getTemplateMap()[settings.noteTemplate] ? settings.noteTemplate : DEFAULT_SETTINGS.noteTemplate
    }));
  }

  function getPendingFill() {
    try {
      const fill = JSON.parse(localStorage.getItem(PENDING_FILL_KEY) || 'null');
      if (!fill || typeof fill !== 'object' || fill.source !== 'CW Timesheet Workbench') return null;
      if (!fill.startText || !fill.endText || !fill.noteText) return null;
      return fill;
    } catch (_) {
      return null;
    }
  }

  function setPendingFill(fill) {
    localStorage.setItem(PENDING_FILL_KEY, JSON.stringify(fill));
  }

  function clearPendingFill() {
    localStorage.removeItem(PENDING_FILL_KEY);
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

  function hasDailyTimeEntriesGrid() {
    return !!document.querySelector(SCROLLER_SEL);
  }

  function isDailyTimeEntriesPage() {
    return hasDailyTimeEntriesGrid();
  }

  function isTimeEntryPage() {
    return !!(document.querySelector('.cw_startTime') && document.querySelector('.cw_endTime') && document.querySelector('.cw_hours'));
  }

  function findSingleVisible(selector, label) {
    const matches = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    if (matches.length !== 1) throw new Error(`${label}: expected exactly one visible match, found ${matches.length}.`);
    return matches[0];
  }

  function inputFromContainer(container, label) {
    if (!container) throw new Error(`${label} was not found.`);
    if (/^(input|textarea)$/i.test(container.tagName)) return container;
    const inputs = Array.from(container.querySelectorAll('input, textarea')).filter(isVisible);
    if (inputs.length !== 1) throw new Error(`${label}: expected exactly one visible input, found ${inputs.length}.`);
    return inputs[0];
  }

  function findTimeEntryFields() {
    const startContainer = findSingleVisible('.cw_startTime', 'Start Time field');
    const endContainer = findSingleVisible('.cw_endTime', 'End Time field');
    const hoursContainer = findSingleVisible('.cw_hours', 'Actual Hours field');
    const editors = Array.from(document.querySelectorAll('.public-DraftEditor-content[role="textbox"], .ManageNoteRichTextEditor-richEditor .public-DraftEditor-content[role="textbox"], .ManageNoteRichTextEditor-richEditor'))
      .filter(isVisible)
      .filter((editor, index, all) => !all.some(other => other !== editor && editor.contains(other)));
    if (editors.length !== 1) throw new Error(`Notes editor: expected exactly one visible match, found ${editors.length}.`);
    return {
      startInput: inputFromContainer(startContainer, 'Start Time field'),
      endInput: inputFromContainer(endContainer, 'End Time field'),
      hoursContainer,
      notesEditor: editors[0]
    };
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
      #${BUTTON_ID}{padding:7px 11px;border:1px solid #2271b1;border-radius:999px;background:#f0f6fc;color:#135e96;font:12px/1.2 Arial,sans-serif;cursor:pointer}
      #${BUTTON_ID}.cwtw-fixed-button{position:fixed;right:20px;bottom:20px;top:auto;z-index:2147483645;box-shadow:0 4px 14px rgba(0,0,0,.35)}
      #${BUTTON_ID}:hover{background:#dbeffd}
      #${FILL_PANEL_ID}{position:fixed;right:20px;bottom:20px;z-index:2147483645;box-sizing:border-box;width:260px;padding:10px;border:1px solid #2271b1;border-radius:8px;background:#fff;color:#1f2933;box-shadow:0 4px 14px rgba(0,0,0,.35);font:12px/1.35 Arial,sans-serif}
      #${FILL_PANEL_ID} .cwtw-panel-title{font-weight:bold;margin-bottom:5px}
      #${FILL_PANEL_ID} .cwtw-panel-note{color:#57606a;margin:5px 0}
      #${FILL_PANEL_ID} .cwtw-panel-status{margin-top:6px;padding:6px;border:1px solid #d0d7de;border-radius:4px;background:#f6f8fa;white-space:pre-wrap}
      #${FILL_PANEL_ID} button{margin:4px 4px 0 0;padding:5px 8px;cursor:pointer}
      #${MODAL_ID}{position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.35);font:13px/1.4 Arial,sans-serif;color:#1f2933}
      #${MODAL_ID} .cwtw-dialog{box-sizing:border-box;width:min(900px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;margin:16px auto;background:#fff;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:16px}
      #${MODAL_ID} h2{margin:0 0 8px;font-size:18px} #${MODAL_ID} h3{margin:16px 0 6px;font-size:14px}
      #${MODAL_ID} .cwtw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
      #${MODAL_ID} input[type=number]{width:70px} #${MODAL_ID} input[type=text]{width:90px} #${MODAL_ID} .cwtw-template-name{width:220px} #${MODAL_ID} select{padding:3px 4px} #${MODAL_ID} textarea{width:100%;min-height:120px;box-sizing:border-box;font-family:Consolas,monospace;font-size:12px}
      #${MODAL_ID} .cwtw-template-body{min-height:80px}
      #${MODAL_ID} #cwtw-generated-notes{min-height:160px;font-size:13px;border:2px solid #2271b1;background:#f8fbff}
      #${MODAL_ID} table{width:100%;border-collapse:collapse;margin:6px 0} #${MODAL_ID} th,#${MODAL_ID} td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
      #${MODAL_ID} th{background:#f6f8fa} #${MODAL_ID} .cwtw-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;position:sticky;bottom:0;background:#fff;padding-top:8px}
      #${MODAL_ID} button{padding:5px 10px;cursor:pointer} #${MODAL_ID} .cwtw-status{padding:8px;border-radius:4px;background:#f6f8fa;border:1px solid #d0d7de}.cwtw-error{background:#fff5f5!important;border-color:#f2a6a6!important;color:#8a1f11}.cwtw-success{background:#f0fff4!important;border-color:#95d5a6!important;color:#0f5132}.cwtw-note{color:#57606a;font-size:12px}`;
    document.head.appendChild(style);
  }

  function injectButton() {
    logStartupState();
    if (!isDailyTimeEntriesPage()) {
      document.getElementById(BUTTON_ID)?.remove();
    } else if (!document.getElementById(BUTTON_ID)) {
      ensureStyles();
      const button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.textContent = 'Timesheet Workbench';
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showWorkbench(); });
      button.classList.add('cwtw-fixed-button');
      button.setAttribute('aria-label', 'Open Timesheet Workbench');
      document.body.appendChild(button);
      log('Injected fixed workbench button.');
    }

    if (isTimeEntryPage()) injectTimeEntryFillPanel();
    else document.getElementById(FILL_PANEL_ID)?.remove();
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


  function getTimesheetScroller() {
    return document.querySelector(SCROLLER_SEL);
  }

  function logStartupState() {
    const scroller = document.querySelector(SCROLLER_SEL);
    const scope = scroller || document;
    const rawPairs = Array.from(scope.querySelectorAll(START_CELL_SEL)).slice(0, 5).map(startCell => {
      const row = startCell.closest('tr');
      const endCell = row?.querySelector(END_CELL_SEL);
      return { startText: textOf(startCell), endText: textOf(endCell) };
    });
    log('Startup state:', {
      url: location.href,
      scrollerFound: !!scroller,
      startCellCount: scope.querySelectorAll(START_CELL_SEL).length,
      endCellCount: scope.querySelectorAll(END_CELL_SEL).length,
      rawStartEndSamples: rawPairs
    });
  }

  function getAllIntervalsFromTimesheetGrid() {
    const scroller = getTimesheetScroller();
    const candidates = [];
    const intervals = [];

    if (!scroller) return { intervals, candidates, scrollerFound: false };

    scroller.querySelectorAll(START_CELL_SEL).forEach((startCell, rowIndex) => {
      if (!isVisible(startCell) || isExcludedFromGridParsing(startCell)) return;
      const row = startCell.closest('tr');
      if (!row || !isVisible(row) || isExcludedFromGridParsing(row)) return;
      const endCell = row.querySelector(END_CELL_SEL);
      if (!endCell || !isVisible(endCell) || isExcludedFromGridParsing(endCell)) return;

      const startText = textOf(startCell);
      const endText = textOf(endCell);
      const start = parseTimeToMinutes(startText);
      const end = parseTimeToMinutes(endText);
      const candidate = { rowIndex: rowIndex + 1, startText, endText, start, end };
      candidates.push(candidate);

      if (start == null || end == null || end <= start) return;
      intervals.push(candidate);
    });

    log('Primary cellindex Start/End candidates:', candidates);
    return { intervals, candidates, scrollerFound: true };
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
    const primary = getAllIntervalsFromTimesheetGrid();
    if (primary.intervals.length) return { intervals: primary.intervals, error: '' };
    if (!primary.scrollerFound) return { intervals: [], error: 'Open Daily Time Entries to scan for gaps.' };
    log('Primary cellindex extraction found no valid intervals; checking generic parser within the Daily Time Entries grid only.', primary);
    const grid = document.querySelector(SCROLLER_SEL);
    if (!grid) return { intervals: [], error: 'Open Daily Time Entries to scan for gaps.' };
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

  function calculateGaps(merged, minGapMinutes, boundary) {
    if (!boundary) return calculateBetweenIntervalGaps(merged, minGapMinutes);

    const bounded = mergeIntervals(applyWorkdayBoundary(merged, boundary));
    const gaps = [];

    if (!bounded.length) {
      const gap = { start: boundary.start, end: boundary.end };
      if (gap.end - gap.start >= minGapMinutes) gaps.push(gap);
      return gaps;
    }

    const leadingGap = { start: boundary.start, end: bounded[0].start };
    if (leadingGap.end - leadingGap.start >= minGapMinutes) gaps.push(leadingGap);

    gaps.push(...calculateBetweenIntervalGaps(bounded, minGapMinutes));

    const trailingGap = { start: bounded[bounded.length - 1].end, end: boundary.end };
    if (trailingGap.end - trailingGap.start >= minGapMinutes) gaps.push(trailingGap);

    return gaps;
  }

  function calculateBetweenIntervalGaps(intervals, minGapMinutes) {
    const gaps = [];
    for (let i = 0; i < intervals.length - 1; i += 1) {
      const gap = { start: intervals[i].end, end: intervals[i + 1].start };
      if (gap.end - gap.start >= minGapMinutes) gaps.push(gap);
    }
    return gaps;
  }

  function getWorkdayBoundary(settings) {
    if (!settings.useWorkdayBoundary) return null;
    const start = parseTimeToMinutes(settings.workdayStart);
    const end = parseTimeToMinutes(settings.workdayEnd);
    if (start == null || end == null || end <= start) return null;
    return { start, end };
  }

  function applyWorkdayBoundary(intervals, boundary) {
    if (!boundary) return intervals;
    return intervals
      .map(item => ({ start: Math.max(item.start, boundary.start), end: Math.min(item.end, boundary.end) }))
      .filter(item => item.end > item.start);
  }

  function normalizeTimeSetting(value, fallback) {
    return parseTimeToMinutes(value) == null ? fallback : String(value).trim().toUpperCase();
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

  function gapText(gaps) {
    if (!gaps.length) return 'No gaps selected.';
    return gaps.map(g => `${formatMinutes(g.start)} - ${formatMinutes(g.end)} (${g.end - g.start} min)`).join('\n');
  }

  function cloneDefaultTemplates() {
    return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  }

  function normalizeTemplateMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const templates = {};
    Object.entries(value).forEach(([id, template]) => {
      if (!id || !template || typeof template !== 'object') return;
      const label = String(template.label || id).trim();
      const body = String(template.template || '').trim();
      if (label && body) templates[id] = { label, template: body };
    });
    return Object.keys(templates).length ? templates : null;
  }

  function loadTemplates() {
    try {
      const saved = normalizeTemplateMap(JSON.parse(localStorage.getItem(TEMPLATES_KEY) || 'null'));
      return saved || cloneDefaultTemplates();
    } catch (_) {
      return cloneDefaultTemplates();
    }
  }

  function saveTemplates(templates) {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(normalizeTemplateMap(templates) || {}));
  }

  function getTemplateMap(modal) {
    return modal?._cwtwTemplates || loadTemplates();
  }

  function getSelectedTemplate(modal) {
    const templates = getTemplateMap(modal);
    const selectedId = modal?.querySelector('#cwtw-note-template')?.value || loadSettings().noteTemplate;
    const fallbackId = templates[selectedId] ? selectedId : Object.keys(templates)[0];
    const selected = templates[fallbackId] || DEFAULT_TEMPLATES.coverage;
    return { id: fallbackId, ...selected };
  }

  function generatedNotes(gaps, template) {
    if (!gaps.length) return 'No gaps selected.';
    return gaps.map(gap => {
      const minutes = gap.end - gap.start;
      return template.template
        .replaceAll('{start}', formatMinutes(gap.start))
        .replaceAll('{end}', formatMinutes(gap.end))
        .replaceAll('{minutes}', String(minutes))
        .replaceAll('{hours}', (minutes / 60).toFixed(2));
    }).join('\n');
  }

  function buildPendingFill(gap, template) {
    const minutes = gap.end - gap.start;
    return {
      source: 'CW Timesheet Workbench',
      createdAt: new Date().toISOString(),
      startText: formatMinutes(gap.start),
      endText: formatMinutes(gap.end),
      durationMinutes: minutes,
      durationHours: Number((minutes / 60).toFixed(2)),
      templateName: template.label || template.id || 'Workbench template',
      noteText: generatedNotes([gap], template)
    };
  }

  function renderTemplateOptions(templates, selectedId) {
    return Object.entries(templates).map(([id, template]) => `<option value="${escapeHtml(id)}" ${id === selectedId ? 'selected' : ''}>${escapeHtml(template.label)}</option>`).join('');
  }

  function templateIdFromName(name, templates) {
    const base = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
    let id = base;
    let suffix = 2;
    while (templates[id] && templates[id].label !== name) id = `${base}-${suffix++}`;
    return id;
  }

  function fillTemplateEditor(modal) {
    const template = getSelectedTemplate(modal);
    modal.querySelector('#cwtw-template-name').value = template.label || '';
    modal.querySelector('#cwtw-template-body').value = template.template || '';
  }

  function refreshTemplateDropdown(modal, selectedId) {
    const select = modal.querySelector('#cwtw-note-template');
    select.innerHTML = renderTemplateOptions(getTemplateMap(modal), selectedId);
    if (selectedId && getTemplateMap(modal)[selectedId]) select.value = selectedId;
  }

  function getSelectedGaps(modal, gaps) {
    return gaps.filter((_, index) => modal.querySelector(`.cwtw-gap-select[data-gap-index="${index}"]`)?.checked);
  }

  function updateGapNotes(modal, gaps) {
    const selectedGaps = getSelectedGaps(modal, gaps);
    modal.querySelector('#cwtw-generated-notes').value = generatedNotes(selectedGaps, getSelectedTemplate(modal));
    modal.querySelector('#cwtw-readable').value = gapText(selectedGaps);
    modal.querySelector('#cwtw-json').value = gapJson(selectedGaps);
  }

  async function copyText(text) {
    if (typeof GM_setClipboard === 'function') return GM_setClipboard(text, 'text');
    if (typeof GM !== 'undefined' && GM.setClipboard) return GM.setClipboard(text, 'text');
    return navigator.clipboard.writeText(text);
  }

  function dispatchTextEvents(input) {
    ['keydown', 'keypress', 'keyup'].forEach(type => input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: 'Tab' })));
    ['input', 'change'].forEach(type => input.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
    input.blur();
    input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  function setTextInputValue(inputOrWrapper, value) {
    const input = /^(input|textarea)$/i.test(inputOrWrapper?.tagName || '') ? inputOrWrapper : inputFromContainer(inputOrWrapper, 'Time field');
    const prototype = input.tagName.toLowerCase() === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    input.focus();
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    dispatchTextEvents(input);
  }

  function insertOrAppendNoteText(noteText) {
    const { notesEditor } = findTimeEntryFields();
    const existingText = textOf(notesEditor);
    const textToInsert = existingText ? `\n\n${noteText}` : noteText;
    notesEditor.focus();
    let success = false;
    try {
      if (window.getSelection && document.createRange && !existingText) {
        const range = document.createRange();
        range.selectNodeContents(notesEditor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof document.execCommand === 'function') {
        success = document.execCommand('insertText', false, textToInsert);
      }
    } catch (error) {
      log('Draft editor insertText failed:', error);
    }
    ['input', 'change'].forEach(type => notesEditor.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));
    return { success: success || textOf(notesEditor).includes(noteText.slice(0, Math.min(20, noteText.length))), appended: !!existingText };
  }

  function injectTimeEntryFillPanel() {
    if (!isTimeEntryPage()) return;
    ensureStyles();
    const existing = document.getElementById(FILL_PANEL_ID);
    if (existing) existing.remove();
    const fill = getPendingFill();
    const panel = document.createElement('div');
    panel.id = FILL_PANEL_ID;
    panel.innerHTML = fill ? `
      <div class="cwtw-panel-title">CW Timesheet Workbench</div>
      <div class="cwtw-panel-note">Pending fill: ${escapeHtml(fill.startText)} - ${escapeHtml(fill.endText)} (${escapeHtml(String(fill.durationHours))} hrs)</div>
      <button id="cwtw-fill-current" type="button">Fill From Workbench</button>
      <button id="cwtw-clear-pending" type="button">Clear Pending Fill</button>
      <button id="cwtw-copy-pending-note" type="button">Copy Pending Note</button>
      <div id="cwtw-fill-status" class="cwtw-panel-status">Manual review required. This script will not save.</div>` : `
      <div class="cwtw-panel-title">CW Timesheet Workbench</div>
      <div class="cwtw-panel-note">No pending Workbench fill</div>
      <div class="cwtw-panel-note">Open Daily Time Entries and select a gap first.</div>`;
    document.body.appendChild(panel);
    if (!fill) return;
    panel.querySelector('#cwtw-fill-current').addEventListener('click', () => showFillPreview(fill));
    panel.querySelector('#cwtw-clear-pending').addEventListener('click', () => {
      clearPendingFill();
      injectTimeEntryFillPanel();
    });
    panel.querySelector('#cwtw-copy-pending-note').addEventListener('click', async () => {
      const status = panel.querySelector('#cwtw-fill-status');
      try { await copyText(fill.noteText); status.textContent = 'Pending note copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
  }

  function showFillPreview(fill) {
    ensureStyles();
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Fill From Workbench Preview">
        <h2>Fill From Workbench</h2>
        <div class="cwtw-status">Confirm before changing fields. This fills Start Time, End Time, and Notes only. It does not save.</div>
        <table><tbody>
          <tr><th>Start Time</th><td>${escapeHtml(fill.startText)}</td></tr>
          <tr><th>End Time</th><td>${escapeHtml(fill.endText)}</td></tr>
          <tr><th>Duration</th><td>${escapeHtml(String(fill.durationHours))} hrs (${escapeHtml(String(fill.durationMinutes))} min)</td></tr>
          <tr><th>Template</th><td>${escapeHtml(fill.templateName)}</td></tr>
        </tbody></table>
        <h3>Note text</h3>
        <textarea readonly>${escapeHtml(fill.noteText)}</textarea>
        <div class="cwtw-status">If notes already exist, the pending note will be appended. Manually review all fields before saving in ConnectWise.</div>
        <div id="cwtw-preview-status" class="cwtw-status" style="display:none"></div>
        <div class="cwtw-actions"><button id="cwtw-confirm-fill" type="button">Confirm Fill Fields</button><button id="cwtw-preview-copy-note" type="button">Copy Pending Note</button><button id="cwtw-close" type="button">Cancel</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cwtw-preview-copy-note').addEventListener('click', async () => {
      try { await copyText(fill.noteText); modal.querySelector('#cwtw-preview-status').style.display = ''; modal.querySelector('#cwtw-preview-status').textContent = 'Pending note copied.'; }
      catch (copyError) { modal.querySelector('#cwtw-preview-status').style.display = ''; modal.querySelector('#cwtw-preview-status').textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    modal.querySelector('#cwtw-confirm-fill').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-preview-status');
      status.style.display = '';
      status.textContent = 'Filling fields...';
      try {
        const result = await fillCurrentTimeEntry(fill);
        status.classList.add('cwtw-success');
        status.textContent = result;
        injectTimeEntryFillPanel();
      } catch (fillError) {
        status.classList.add('cwtw-error');
        status.textContent = `Fill failed: ${fillError.message || fillError}\nUse Copy Pending Note if needed.`;
      }
    });
  }

  async function fillCurrentTimeEntry(fill) {
    // Milestone 2 safety: after explicit confirmation, this only updates Start Time,
    // End Time, and Notes fields. It never clicks Save/Submit/Copy/New/Delete.
    const fields = findTimeEntryFields();
    setTextInputValue(fields.startInput, fill.startText);
    setTextInputValue(fields.endInput, fill.endText);
    const noteResult = insertOrAppendNoteText(fill.noteText);
    await new Promise(resolve => setTimeout(resolve, 700));
    const detectedHours = textOf(fields.hoursContainer) || fields.hoursContainer.value || '(blank)';
    const noteMessage = noteResult.success ? `Notes ${noteResult.appended ? 'appended' : 'inserted'}.` : 'Note insertion may have failed; use Copy Pending Note as a fallback.';
    return `${noteMessage}\nExpected duration: ${fill.durationHours} hrs (${fill.durationMinutes} min).\nDetected Actual Hours: ${detectedHours}.\nManually review Start Time, End Time, Notes, and Actual Hours, then save in ConnectWise yourself if correct.`;
  }

  function showWorkbench() {
    ensureStyles();
    if (!hasDailyTimeEntriesGrid()) {
      showGridMissingMessage();
      return;
    }
    const settings = loadSettings();
    const templates = loadTemplates();
    const selectedTemplateId = templates[settings.noteTemplate] ? settings.noteTemplate : Object.keys(templates)[0];
    const { intervals, error } = getIntervals();
    const merged = mergeIntervals(intervals);
    const boundary = getWorkdayBoundary(settings);
    const gaps = calculateGaps(merged, settings.minGapMinutes, boundary);
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Timesheet Workbench">
        <h2>Timesheet Workbench <span class="cwtw-note">manual-fill v0.2</span></h2>
        <div class="cwtw-status ${error ? 'cwtw-error' : ''}">${escapeHtml(error || `Detected ${intervals.length} valid visible interval(s), merged into ${merged.length} block(s).`)}</div>
        <div class="cwtw-row"><label>Minimum gap minutes <input id="cwtw-min-gap" type="number" min="1" max="240" step="1" value="${settings.minGapMinutes}"></label><label><input id="cwtw-boundary-enabled" type="checkbox" ${settings.useWorkdayBoundary ? 'checked' : ''}> Limit to workday</label><label>Start <input id="cwtw-boundary-start" type="text" value="${escapeHtml(settings.workdayStart)}"></label><label>End <input id="cwtw-boundary-end" type="text" value="${escapeHtml(settings.workdayEnd)}"></label><label><input id="cwtw-debug" type="checkbox" ${settings.debug ? 'checked' : ''}> Debug logging</label><button id="cwtw-refresh" type="button">Refresh Preview</button></div>
        <div class="cwtw-note">This v0.2 script never clicks ConnectWise Save, Copy, New, Submit, OK, Delete, or other action buttons. It can store a pending fill and, only after confirmation on an individual Time Entry page, fills Start Time, End Time, and Notes for manual review. Workday limits are optional and disabled by default; when disabled, gaps are calculated only between existing visible entries.</div>
        <h3>Summary</h3><table><tbody><tr><th>Total logged from merged intervals</th><td>${minutesLabel(sumMinutes(merged))}</td></tr><tr><th>Total detected gap time</th><td>${minutesLabel(sumMinutes(gaps))}</td></tr></tbody></table>
        <h3>Existing intervals</h3>${renderIntervalTable(merged)}
        <h3>Detected gaps</h3>${renderGapTable(gaps)}
        <h3>Generated notes</h3>
        <div class="cwtw-row"><label>Template <select id="cwtw-note-template">${renderTemplateOptions(templates, selectedTemplateId)}</select></label><span class="cwtw-note">Generated from selected gaps. Review before pasting into ConnectWise.</span></div>
        <textarea id="cwtw-generated-notes" readonly>${escapeHtml(generatedNotes(gaps, { id: selectedTemplateId, ...templates[selectedTemplateId] }))}</textarea>
        <h3>Template settings</h3>
        <div class="cwtw-row"><label>Template name <input id="cwtw-template-name" class="cwtw-template-name" type="text"></label></div>
        <textarea id="cwtw-template-body" class="cwtw-template-body" placeholder="Use {start}, {end}, {minutes}, and {hours} tokens."></textarea>
        <div class="cwtw-row"><button id="cwtw-save-template" type="button">Add / Update Template</button><button id="cwtw-delete-template" type="button">Delete Template</button><button id="cwtw-reset-templates" type="button">Reset Templates to Defaults</button><span id="cwtw-template-status" class="cwtw-note"></span></div>
        <h3>Reference gap text</h3><textarea id="cwtw-readable" readonly>${escapeHtml(gapText(gaps))}</textarea>
        <h3>Copyable gap JSON</h3><textarea id="cwtw-json" readonly>${escapeHtml(gapJson(gaps))}</textarea>
        <div class="cwtw-actions"><span id="cwtw-copy-status" class="cwtw-note"></span><button id="cwtw-copy-generated" type="button">Copy Generated Notes</button><button id="cwtw-copy-readable" type="button">Copy Reference Gap Text</button><button id="cwtw-copy-json" type="button">Copy JSON</button><button id="cwtw-close" type="button">Close</button></div>
      </div>`;
    modal._cwtwTemplates = templates;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.cwtw-gap-select').forEach(checkbox => {
      checkbox.addEventListener('change', () => updateGapNotes(modal, gaps));
    });
    modal.querySelectorAll('.cwtw-use-gap').forEach(button => {
      button.addEventListener('click', () => {
        const status = modal.querySelector('#cwtw-copy-status');
        const gap = gaps[Number(button.dataset.gapIndex)];
        if (!gap) { status.textContent = 'Could not find that gap.'; return; }
        const fill = buildPendingFill(gap, getSelectedTemplate(modal));
        setPendingFill(fill);
        status.textContent = `Pending fill saved for ${fill.startText} - ${fill.endText}. Open a Time Entry and use Fill From Workbench.`;
        status.classList.add('cwtw-success');
        injectTimeEntryFillPanel();
      });
    });
    fillTemplateEditor(modal);
    modal.querySelector('#cwtw-note-template').addEventListener('change', () => {
      saveSettings({ ...loadSettings(), noteTemplate: modal.querySelector('#cwtw-note-template').value });
      fillTemplateEditor(modal);
      updateGapNotes(modal, gaps);
    });
    modal.querySelector('#cwtw-save-template').addEventListener('click', () => {
      const status = modal.querySelector('#cwtw-template-status');
      const name = modal.querySelector('#cwtw-template-name').value.trim();
      const body = modal.querySelector('#cwtw-template-body').value.trim();
      if (!name || !body) { status.textContent = 'Template name and body are required.'; return; }
      const currentId = modal.querySelector('#cwtw-note-template').value;
      const templates = getTemplateMap(modal);
      const currentTemplate = templates[currentId];
      const matchingId = Object.keys(templates).find(templateId => templates[templateId].label === name);
      const id = matchingId || (currentTemplate?.label === name ? currentId : templateIdFromName(name, templates));
      modal._cwtwTemplates = { ...templates, [id]: { label: name, template: body } };
      saveTemplates(modal._cwtwTemplates);
      refreshTemplateDropdown(modal, id);
      saveSettings({ ...loadSettings(), noteTemplate: id });
      updateGapNotes(modal, gaps);
      status.textContent = 'Template saved.';
    });
    modal.querySelector('#cwtw-delete-template').addEventListener('click', () => {
      const status = modal.querySelector('#cwtw-template-status');
      const id = modal.querySelector('#cwtw-note-template').value;
      const nextTemplates = { ...getTemplateMap(modal) };
      delete nextTemplates[id];
      modal._cwtwTemplates = normalizeTemplateMap(nextTemplates) || cloneDefaultTemplates();
      saveTemplates(modal._cwtwTemplates);
      const nextId = Object.keys(modal._cwtwTemplates)[0];
      refreshTemplateDropdown(modal, nextId);
      saveSettings({ ...loadSettings(), noteTemplate: nextId });
      fillTemplateEditor(modal);
      updateGapNotes(modal, gaps);
      status.textContent = 'Template deleted.';
    });
    modal.querySelector('#cwtw-reset-templates').addEventListener('click', () => {
      modal._cwtwTemplates = cloneDefaultTemplates();
      saveTemplates(modal._cwtwTemplates);
      const nextId = DEFAULT_SETTINGS.noteTemplate;
      refreshTemplateDropdown(modal, nextId);
      saveSettings({ ...loadSettings(), noteTemplate: nextId });
      fillTemplateEditor(modal);
      updateGapNotes(modal, gaps);
      modal.querySelector('#cwtw-template-status').textContent = 'Templates reset to defaults.';
    });
    modal.querySelector('#cwtw-refresh').addEventListener('click', () => {
      saveSettings({ minGapMinutes: modal.querySelector('#cwtw-min-gap').value, debug: modal.querySelector('#cwtw-debug').checked, useWorkdayBoundary: modal.querySelector('#cwtw-boundary-enabled').checked, workdayStart: modal.querySelector('#cwtw-boundary-start').value, workdayEnd: modal.querySelector('#cwtw-boundary-end').value, noteTemplate: modal.querySelector('#cwtw-note-template').value });
      showWorkbench();
    });
    modal.querySelector('#cwtw-copy-generated').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-copy-status');
      try { await copyText(modal.querySelector('#cwtw-generated-notes').value); status.textContent = 'Generated notes copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    modal.querySelector('#cwtw-copy-readable').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-copy-status');
      try { await copyText(modal.querySelector('#cwtw-readable').value); status.textContent = 'Reference gap text copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    modal.querySelector('#cwtw-copy-json').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-copy-status');
      try { await copyText(modal.querySelector('#cwtw-json').value); status.textContent = 'JSON copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
  }

  function showGridMissingMessage() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Timesheet Workbench">
        <h2>Timesheet Workbench <span class="cwtw-note">manual-fill v0.2</span></h2>
        <div class="cwtw-status">Open Daily Time Entries to scan for gaps.</div>
        <div class="cwtw-actions"><button id="cwtw-close" type="button">Close</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
  }

  function renderIntervalTable(items) {
    if (!items.length) return '<div class="cwtw-status">None detected.</div>';
    return `<table><thead><tr><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>${items.map(item => `<tr><td>${formatMinutes(item.start)}</td><td>${formatMinutes(item.end)}</td><td>${item.end - item.start} min</td></tr>`).join('')}</tbody></table>`;
  }

  function renderGapTable(gaps) {
    if (!gaps.length) return '<div class="cwtw-status">None detected.</div>';
    return `<table><thead><tr><th>Select</th><th>Start</th><th>End</th><th>Minutes</th><th>Decimal hours</th><th>Current Time Entry</th></tr></thead><tbody>${gaps.map((gap, index) => {
      const minutes = gap.end - gap.start;
      return `<tr><td><input class="cwtw-gap-select" type="checkbox" checked data-gap-index="${index}" aria-label="Include gap ${index + 1}"></td><td>${formatMinutes(gap.start)}</td><td>${formatMinutes(gap.end)}</td><td>${minutes}</td><td>${(minutes / 60).toFixed(2)}</td><td><button class="cwtw-use-gap" type="button" data-gap-index="${index}">Use for Current Time Entry</button></td></tr>`;
    }).join('')}</tbody></table>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // Safety guard: this script never initiates ConnectWise toolbar/action clicks.
  // The only ConnectWise form updates are confirmed Start Time, End Time, and Notes
  // fills on individual Time Entry pages; saving remains manual.
  document.addEventListener('click', event => {
    const label = normalize(textOf(event.target));
    if (SAFE_ACTION_TEXT.has(label)) log('Observed ConnectWise action label; Workbench did not initiate it:', label);
  }, true);

  startObserver();
})();
