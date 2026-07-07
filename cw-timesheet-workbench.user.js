// ==UserScript==
// @name         CW Timesheet Workbench
// @namespace    https://github.com/AttentusTechnologies/userscripts
// @version      0.2.5
// @description  ConnectWise Manage Daily Time Entries gap finder with confirmed Time Entry time fill and note clipboard. Does not click ConnectWise Save, Copy, Submit, Delete, or modify ConnectWise data via API.
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
  const DEFAULT_SETTINGS = { minGapMinutes: 3, debug: false, useWorkdayBoundary: false, workdayStart: '7:00 AM', workdayEnd: '4:00 PM', noteTemplate: 'service-desk-triage' };
  const DEFAULT_TEMPLATES = {
    'service-desk-triage': { label: 'Service Desk Dispatch / Triage', category: 'Service Desk Dispatch / Triage', chargeCode: 'Morning/Evening Dispatch', chargeCodePath: 'Attentus Technologies / Morning/Evening Dispatch', template: 'Worked active service desk dispatch and triage from {start} to {end} ({hours} hrs), including reviewing inbound tickets, monitoring board flow, routing issues, identifying SLA or escalation needs, and updating ticket context for technician follow-up.' },
    'queue-review': { label: 'Queue Review / Board Cleanup', category: 'Queue Review / Board Cleanup', chargeCode: 'Morning/Evening Dispatch', chargeCodePath: 'Attentus Technologies / Morning/Evening Dispatch', template: 'Reviewed service board activity from {start} to {end} ({hours} hrs), cleaned up ticket context, checked routing and ownership, identified stale or misrouted items, and updated next steps where needed.' },
    'ai-automation': { label: 'AI Prompt / Automation Work', category: 'AI Prompt / Automation Work', chargeCode: 'Internal Technical', chargeCodePath: 'Attentus Technologies / Internal Technical', template: 'Worked on AI and automation improvements from {start} to {end} ({hours} hrs), including reviewing behavior, testing outputs, refining prompts or scripts, validating results, and documenting follow-up changes.' },
    documentation: { label: 'Documentation / SOP / KB Updates', category: 'Documentation / SOP / KB Updates', chargeCode: 'Internal Technical', chargeCodePath: 'Attentus Technologies / Internal Technical', template: 'Reviewed and updated internal documentation from {start} to {end} ({hours} hrs), including support process notes, system context, SOP details, and operational reference material for future technician use.' },
    training: { label: 'Training / Shadowing / Coverage Handoff', category: 'Training / Shadowing / Coverage Handoff', chargeCode: 'Training', chargeCodePath: 'Attentus Technologies / Training', template: 'Provided training, shadowing, or coverage support from {start} to {end} ({hours} hrs), including reviewing workflow expectations, answering process questions, and helping transfer operational knowledge.' },
    meeting: { label: 'Internal Meeting / Review', category: 'Internal Meeting / Review', chargeCode: 'Internal Meeting', chargeCodePath: 'Attentus Technologies / Internal Meeting', template: 'Attended internal review meeting from {start} to {end} ({hours} hrs) and discussed service desk operations, current priorities, process updates, coverage needs, and follow-up action items.' },
    'time-sheet-review': { label: 'Time Sheet Review', category: 'Time Sheet Review', chargeCode: 'Time Sheet Review', chargeCodePath: 'Attentus Technologies / Time Sheet Review', template: 'Reviewed, corrected, audited, or updated timesheet entries from {start} to {end} ({hours} hrs), including validating time coverage, entry accuracy, and required follow-up.' },
    break: { label: 'Break', category: 'Break', chargeCode: 'Break', chargeCodePath: 'Attentus Technologies / Break', template: 'Break from {start} to {end} ({hours} hrs).' },
    'eod-eow-review': { label: 'EOD Review / EOW Review', category: 'EOD Review / EOW Review', chargeCode: 'Internal Meeting', chargeCodePath: 'Attentus Technologies / Internal Meeting', template: 'Completed daily or weekly operational review from {start} to {end} ({hours} hrs), including reviewing priorities, planning follow-up, and assessing service desk coverage or process needs.' }
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
    return {
      startInput: inputFromContainer(startContainer, 'Start Time field'),
      endInput: inputFromContainer(endContainer, 'End Time field'),
      hoursContainer
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
      #${MODAL_ID} .cwtw-dialog{box-sizing:border-box;width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;margin:16px auto;background:#fff;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.35);padding:14px}
      #${MODAL_ID} h2{margin:0 0 8px;font-size:18px} #${MODAL_ID} h3{margin:12px 0 6px;font-size:14px}
      #${MODAL_ID} .cwtw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
      #${MODAL_ID} input[type=number]{width:70px} #${MODAL_ID} input[type=text]{width:90px} #${MODAL_ID} .cwtw-template-name{width:220px} #${MODAL_ID} select{padding:3px 4px} #${MODAL_ID} textarea{width:100%;min-height:72px;box-sizing:border-box;font-family:Consolas,monospace;font-size:12px}
      #${MODAL_ID} .cwtw-template-body{min-height:80px}
      #${MODAL_ID} #cwtw-generated-notes{min-height:84px;font-size:13px;border:1px solid #8cbbdc;background:#f8fbff}
      #${MODAL_ID} .cwtw-gap-list{display:grid;gap:8px;margin:8px 0}
      #${MODAL_ID} .cwtw-gap-card{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #d0d7de;border-radius:6px;padding:8px;background:#fff}
      #${MODAL_ID} .cwtw-gap-time{font-weight:bold}.cwtw-gap-duration{color:#57606a;font-size:12px}
      #${MODAL_ID} details.cwtw-advanced{margin-top:12px;border-top:1px solid #d0d7de;padding-top:8px}
      #${MODAL_ID} details.cwtw-advanced>summary{cursor:pointer;color:#57606a;font-size:12px}
      #${MODAL_ID} table{width:100%;border-collapse:collapse;margin:6px 0} #${MODAL_ID} th,#${MODAL_ID} td{border:1px solid #d0d7de;padding:4px 6px;text-align:left;vertical-align:top}
      #${MODAL_ID} th{background:#f6f8fa} #${MODAL_ID} .cwtw-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;position:sticky;bottom:0;background:#fff;padding-top:8px}
      #${MODAL_ID} button{padding:5px 10px;cursor:pointer} #${MODAL_ID} .cwtw-status{padding:8px;border-radius:4px;background:#f6f8fa;border:1px solid #d0d7de}.cwtw-error{background:#fff5f5!important;border-color:#f2a6a6!important;color:#8a1f11}.cwtw-success{background:#f0fff4!important;border-color:#95d5a6!important;color:#0f5132}.cwtw-note{color:#57606a;font-size:12px}`;
    document.head.appendChild(style);
  }

  function injectButton() {
    if (loadSettings().debug) logStartupState();
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
    if (primary.intervals.length) return { intervals: primary.intervals, candidates: primary.candidates, error: '' };
    if (!primary.scrollerFound) return { intervals: [], candidates: [], error: 'Open Daily Time Entries to scan for gaps.' };
    return { intervals: [], candidates: primary.candidates, error: 'No valid Start Time / End Time intervals were detected in visible rows.' };
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

  function chargeCodeForCategory(category) {
    const mappings = {
      'Service Desk Dispatch / Triage': { chargeCode: 'Morning/Evening Dispatch', chargeCodePath: 'Attentus Technologies / Morning/Evening Dispatch' },
      'Queue Review / Board Cleanup': { chargeCode: 'Morning/Evening Dispatch', chargeCodePath: 'Attentus Technologies / Morning/Evening Dispatch' },
      'AI Prompt / Automation Work': { chargeCode: 'Internal Technical', chargeCodePath: 'Attentus Technologies / Internal Technical' },
      'Documentation / SOP / KB Updates': { chargeCode: 'Internal Technical', chargeCodePath: 'Attentus Technologies / Internal Technical' },
      'Training / Shadowing / Coverage Handoff': { chargeCode: 'Training', chargeCodePath: 'Attentus Technologies / Training' },
      'Internal Meeting / Review': { chargeCode: 'Internal Meeting', chargeCodePath: 'Attentus Technologies / Internal Meeting' },
      'Time Sheet Review': { chargeCode: 'Time Sheet Review', chargeCodePath: 'Attentus Technologies / Time Sheet Review' },
      Break: { chargeCode: 'Break', chargeCodePath: 'Attentus Technologies / Break' },
      'EOD Review / EOW Review': { chargeCode: 'Internal Meeting', chargeCodePath: 'Attentus Technologies / Internal Meeting' }
    };
    return mappings[category] || { chargeCode: '', chargeCodePath: '' };
  }

  function cloneDefaultTemplates() {
    return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
  }

  function normalizeTemplateMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const templates = {};
    Object.entries(value).forEach(([id, template]) => {
      if (!id || !template || typeof template !== 'object') return;
      const label = String(template.label || template.category || id).trim();
      const category = String(template.category || label).trim();
      const mapping = chargeCodeForCategory(category);
      const chargeCode = String(template.chargeCode || mapping.chargeCode || '').trim();
      const chargeCodePath = String(template.chargeCodePath || mapping.chargeCodePath || '').trim();
      const body = String(template.template || '').trim();
      if (label && body) templates[id] = { label, category, chargeCode, chargeCodePath, template: body };
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
    const selected = templates[fallbackId] || DEFAULT_TEMPLATES[DEFAULT_SETTINGS.noteTemplate];
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
      category: template.category || template.label || 'Workbench',
      chargeCode: template.chargeCode || '',
      chargeCodePath: template.chargeCodePath || '',
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
    modal.querySelector('#cwtw-template-category').value = template.category || template.label || '';
    modal.querySelector('#cwtw-template-charge-code').value = template.chargeCode || '';
    modal.querySelector('#cwtw-template-charge-code-path').value = template.chargeCodePath || '';
  }

  function updateChargeCodePreview(modal) {
    const preview = modal.querySelector('#cwtw-charge-code-preview');
    if (!preview) return;
    const template = getSelectedTemplate(modal);
    preview.textContent = `Charge Code: ${template.chargeCode || '(none)'}`;
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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  async function waitUntil(fn, tries = 30, delay = 60) {
    for (let i = 0; i < tries; i += 1) {
      const value = fn();
      if (value) return value;
      await sleep(delay);
    }
    return null;
  }

  function visibleElements(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).filter(isVisible);
  }

  function normValue(value) {
    return normalize(value).replace(/\s*\/\s*/g, ' / ');
  }

  function isChargeCodeValueMatch(actual, fill) {
    const actualNorm = normValue(actual);
    const codeNorm = normValue(fill.chargeCode);
    const pathNorm = normValue(fill.chargeCodePath);
    return !!actualNorm && (actualNorm === codeNorm || actualNorm === pathNorm || actualNorm.endsWith(` / ${codeNorm}`));
  }

  function findInputByLabel(labelText) {
    const needle = normalize(String(labelText).replace(/[:?]\s*$/, ''));
    const labelSelectors = '.mm_label, .cw_CwLabel, label, [id$="-label"], [class*="label"], [class*="Label"]';
    for (const label of visibleElements(labelSelectors)) {
      const labelValue = normalize(textOf(label).replace(/[:?]\s*$/, ''));
      if (labelValue !== needle) continue;
      const row = label.closest('.pod-element-row, tr, li, .form-group, .row, div') || label.parentElement;
      const input = row && visibleElements('input:not([type="hidden"]), textarea, [contenteditable="true"]', row)[0];
      if (input) return input;
    }
    return null;
  }

  function findChargeCodeInput() {
    const selectorMatches = visibleElements('input[class*="ChargeCode"], input[id*="ChargeCode"], input[name*="ChargeCode"], input[aria-label="Charge Code"]')
      .filter(input => !/chargeto/i.test(`${input.className} ${input.id} ${input.name}`));
    if (selectorMatches.length === 1) return selectorMatches[0];
    return findInputByLabel('Charge Code');
  }

  function openComboPopup(input) {
    const before = new Set(visibleElements('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"], .x-layer, .x-menu-floating, .x-combo-list, .GMDB3DUBPDJ.GMDB3DUBGFJ'));
    const button = input.closest('div')?.querySelector('.k-select, .k-input-button, button[aria-haspopup="listbox"], .GMDB3DUBHWH');
    if (button && isVisible(button)) {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      button.click();
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } else {
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    }
    return waitUntil(() => {
      const after = visibleElements('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"], .x-layer, .x-menu-floating, .x-combo-list, .GMDB3DUBPDJ.GMDB3DUBGFJ');
      return after.find(el => !before.has(el)) || after.at(-1);
    }, 15, 50);
  }

  function exactChargeCodeOptions(container, fill) {
    const wanted = [fill.chargeCodePath, fill.chargeCode].filter(Boolean).map(normValue);
    const optionSelector = '[role="option"], .k-list-item, .k-item, .select2-results__option, li, div, span';
    const matches = visibleElements(optionSelector, container)
      .filter(el => wanted.includes(normValue(textOf(el))))
      .map(el => el.closest('[role="option"], .k-list-item, .k-item, .select2-results__option, li') || el);
    return Array.from(new Set(matches));
  }

  function setComboSearchValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function setChargeCode(fill) {
    if (!fill.chargeCode) return { ok: false, message: 'No Charge Code was stored with this pending fill.' };
    const input = findChargeCodeInput();
    if (!input) return { ok: false, message: 'Charge Code field was not found.' };
    if (isChargeCodeValueMatch(input.value || textOf(input), fill)) return { ok: true, message: `Charge Code already set to ${fill.chargeCode}.` };

    input.focus();
    setComboSearchValue(input, fill.chargeCode);
    const popup = await openComboPopup(input);
    if (!popup) return { ok: false, message: `Charge Code popup did not open for ${fill.chargeCode}.` };

    const matches = exactChargeCodeOptions(popup, fill);
    if (matches.length !== 1) return { ok: false, message: `Charge Code not set: expected exactly one match for ${fill.chargeCode}, found ${matches.length}.` };

    matches[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    matches[0].click();
    matches[0].dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
    await sleep(250);

    const actual = input.value || textOf(input);
    if (!isChargeCodeValueMatch(actual, fill)) return { ok: false, message: `Charge Code verification failed. Expected ${fill.chargeCode}; current value is ${actual || '(blank)'}.` };
    return { ok: true, message: `Charge Code filled: ${fill.chargeCode}.` };
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

  async function copyPendingNoteText(noteText) {
    // ConnectWise Notes is a React/Draft.js editor. Live testing showed direct DOM
    // mutation/execCommand can corrupt Draft.js state and make the editor disappear,
    // so notes are clipboard-only until a supported ConnectWise editor API is known.
    await copyText(noteText);
    const focusMessage = focusNotesEditor();
    return `Note copied to clipboard. ${focusMessage}`;
  }

  function findNotesEditor() {
    return document.querySelector('.public-DraftEditor-content[role="textbox"]') ||
      document.querySelector('.ManageNoteRichTextEditor-richEditor');
  }

  function focusNotesEditor() {
    const editor = findNotesEditor();
    if (!editor || !isVisible(editor)) return 'Could not find the Notes editor; paste the note manually after opening Notes.';
    editor.focus();
    return 'The Notes editor was focused. Press Ctrl+V to paste the note.';
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
      <div class="cwtw-panel-note">Template: ${escapeHtml(fill.templateName)}</div>
      <div class="cwtw-panel-note">Charge Code: ${escapeHtml(fill.chargeCode || '(none)')}</div>
      <button id="cwtw-fill-current" type="button">Fill Times + Copy Note</button>
      <button id="cwtw-copy-pending-note" type="button">Copy Note</button>
      <button id="cwtw-clear-pending" type="button">Clear Pending Fill</button>
      <button id="cwtw-focus-notes" type="button">Focus Notes</button>
      <div id="cwtw-fill-status" class="cwtw-panel-status">Manual review required. This script will not save.</div>` : `
      <div class="cwtw-panel-title">CW Timesheet Workbench</div>
      <div class="cwtw-panel-note">No pending Workbench fill</div>
      <div class="cwtw-panel-note">Open Daily Time Entries and choose a gap.</div>`;
    document.body.appendChild(panel);
    if (!fill) return;
    panel.querySelector('#cwtw-fill-current').addEventListener('click', () => showFillPreview(fill));
    panel.querySelector('#cwtw-clear-pending').addEventListener('click', () => {
      clearPendingFill();
      injectTimeEntryFillPanel();
    });
    panel.querySelector('#cwtw-copy-pending-note').addEventListener('click', async () => {
      const status = panel.querySelector('#cwtw-fill-status');
      try { status.textContent = await copyPendingNoteText(fill.noteText); }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    panel.querySelector('#cwtw-focus-notes').addEventListener('click', () => {
      panel.querySelector('#cwtw-fill-status').textContent = focusNotesEditor();
    });
  }

  function showFillPreview(fill) {
    ensureStyles();
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Fill Times + Copy Note Preview">
        <h2>Fill Times + Copy Note</h2>
        <div class="cwtw-status">Warning: This will not save the entry.</div>
        <table><tbody>
          <tr><th>Start Time</th><td>${escapeHtml(fill.startText)}</td></tr>
          <tr><th>End Time</th><td>${escapeHtml(fill.endText)}</td></tr>
          <tr><th>Duration</th><td>${escapeHtml(String(fill.durationHours))} hrs (${escapeHtml(String(fill.durationMinutes))} min)</td></tr>
          <tr><th>Template</th><td>${escapeHtml(fill.templateName)}</td></tr>
          <tr><th>Category</th><td>${escapeHtml(fill.category || fill.templateName)}</td></tr>
          <tr><th>Charge Code</th><td>${escapeHtml(fill.chargeCode || '(none)')}</td></tr>
        </tbody></table>
        <h3>Note preview</h3>
        <textarea readonly>${escapeHtml(fill.noteText)}</textarea>

        <div id="cwtw-preview-status" class="cwtw-status" style="display:none"></div>
        <div class="cwtw-actions"><button id="cwtw-confirm-fill" type="button">Fill Times + Copy Note</button><button id="cwtw-preview-copy-note" type="button">Copy Note</button><button id="cwtw-preview-focus-notes" type="button">Focus Notes</button><button id="cwtw-close" type="button">Cancel</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cwtw-preview-copy-note').addEventListener('click', async () => {
      try { modal.querySelector('#cwtw-preview-status').style.display = ''; modal.querySelector('#cwtw-preview-status').textContent = await copyPendingNoteText(fill.noteText); }
      catch (copyError) { modal.querySelector('#cwtw-preview-status').style.display = ''; modal.querySelector('#cwtw-preview-status').textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    modal.querySelector('#cwtw-preview-focus-notes').addEventListener('click', () => {
      modal.querySelector('#cwtw-preview-status').style.display = '';
      modal.querySelector('#cwtw-preview-status').textContent = focusNotesEditor();
    });
    modal.querySelector('#cwtw-confirm-fill').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-preview-status');
      status.style.display = '';
      status.textContent = 'Filling fields...';
      try {
        const result = await fillCurrentTimeEntry(fill);
        modal.remove();
        injectTimeEntryFillPanel();
        const panelStatus = document.querySelector(`#${FILL_PANEL_ID} #cwtw-fill-status`);
        if (panelStatus) panelStatus.textContent = result;
        focusNotesEditor();
      } catch (fillError) {
        status.classList.add('cwtw-error');
        status.textContent = `Fill failed: ${fillError.message || fillError}\nUse Copy Note if needed.`;
      }
    });
  }

  async function fillCurrentTimeEntry(fill) {
    // Milestone safety: after explicit confirmation, this updates Start Time,
    // End Time, and Charge Code only. Notes are copied to the clipboard for
    // manual paste because direct Draft.js DOM mutation caused the ConnectWise
    // Notes editor to crash. It never clicks Save/Submit/Copy/New/Delete.
    const fields = findTimeEntryFields();
    setTextInputValue(fields.startInput, fill.startText);
    setTextInputValue(fields.endInput, fill.endText);
    const chargeResult = await setChargeCode(fill);
    await copyPendingNoteText(fill.noteText);
    await sleep(700);
    const detectedHours = textOf(fields.hoursContainer) || fields.hoursContainer.value || '(blank)';
    const chargeLine = chargeResult.ok ? 'Charge Code filled.' : `Charge Code not filled: ${chargeResult.message}`;
    return `Start Time filled.
End Time filled.
${chargeLine}
Notes copied to clipboard.
Manual review and save required.
Expected duration: ${fill.durationHours} hrs (${fill.durationMinutes} min).
ConnectWise Actual Hours: ${detectedHours}.`;
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
    const { intervals, candidates, error } = getIntervals();
    const merged = mergeIntervals(intervals);
    const boundary = getWorkdayBoundary(settings);
    const gaps = calculateGaps(merged, settings.minGapMinutes, boundary);
    const pending = getPendingFill();
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Timesheet Workbench">
        <h2>Timesheet Workbench <span class="cwtw-note">manual-fill v0.2.5</span></h2>
        <div class="cwtw-status ${error ? 'cwtw-error' : ''}">${escapeHtml(error || `Total missing time: ${minutesLabel(sumMinutes(gaps))}`)}</div>
        ${pending ? renderPendingFillSummary(pending) : ''}
        <h3>Detected gaps</h3>${renderGapCards(gaps)}
        <h3>Template</h3>
        <div class="cwtw-row"><select id="cwtw-note-template">${renderTemplateOptions(templates, selectedTemplateId)}</select><span id="cwtw-charge-code-preview" class="cwtw-note">Charge Code: ${escapeHtml((templates[selectedTemplateId] || {}).chargeCode || '(none)')}</span><button id="cwtw-copy-generated" type="button">Copy Note</button><button id="cwtw-refresh" type="button">Refresh</button><span id="cwtw-copy-status" class="cwtw-note"></span></div>
        <h3>Generated note preview</h3>
        <textarea id="cwtw-generated-notes" readonly>${escapeHtml(generatedNotes(gaps.slice(0, 1), { id: selectedTemplateId, ...templates[selectedTemplateId] }))}</textarea>
        <details class="cwtw-advanced">
          <summary>Advanced / Debug</summary>
          <div class="cwtw-row"><label>Minimum gap minutes <input id="cwtw-min-gap" type="number" min="1" max="240" step="1" value="${settings.minGapMinutes}"></label><label><input id="cwtw-boundary-enabled" type="checkbox" ${settings.useWorkdayBoundary ? 'checked' : ''}> Limit to workday</label><label>Start <input id="cwtw-boundary-start" type="text" value="${escapeHtml(settings.workdayStart)}"></label><label>End <input id="cwtw-boundary-end" type="text" value="${escapeHtml(settings.workdayEnd)}"></label><label><input id="cwtw-debug" type="checkbox" ${settings.debug ? 'checked' : ''}> Debug logging</label></div>
          <div class="cwtw-note">This v0.2.5 script never clicks ConnectWise Save, Copy, New, Submit, OK, Delete, or other action buttons. It stores a pending fill and, only after confirmation on a Time Entry page, fills Start Time, End Time, and exactly one verified Charge Code match while copying Notes for manual paste/review.</div>
          <h3>Existing intervals</h3>${renderIntervalTable(merged)}
          <h3>Raw Start/End candidates</h3>${renderCandidateTable(candidates)}
          <h3>Template settings</h3>
          <div class="cwtw-row"><label>Template name <input id="cwtw-template-name" class="cwtw-template-name" type="text"></label><label>Category <input id="cwtw-template-category" class="cwtw-template-name" type="text"></label></div>
          <div class="cwtw-row"><label>Charge Code <input id="cwtw-template-charge-code" class="cwtw-template-name" type="text"></label><label>Path <input id="cwtw-template-charge-code-path" class="cwtw-template-name" type="text"></label></div>
          <textarea id="cwtw-template-body" class="cwtw-template-body" placeholder="Use {start}, {end}, {minutes}, and {hours} tokens."></textarea>
          <div class="cwtw-row"><button id="cwtw-save-template" type="button">Add / Update Template</button><button id="cwtw-delete-template" type="button">Delete Template</button><button id="cwtw-reset-templates" type="button">Reset Templates to Defaults</button><span id="cwtw-template-status" class="cwtw-note"></span></div>
          <h3>Reference gap text</h3><textarea id="cwtw-readable" readonly>${escapeHtml(gapText(gaps))}</textarea>
          <h3>Copyable gap JSON</h3><textarea id="cwtw-json" readonly>${escapeHtml(gapJson(gaps))}</textarea>
        </details>
        <div class="cwtw-actions"><button id="cwtw-close" type="button">Close</button></div>
      </div>`;
    modal._cwtwTemplates = templates;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
    modal.querySelectorAll('.cwtw-gap-select').forEach(radio => radio.addEventListener('change', () => updateGapNotes(modal, gaps)));
    modal.querySelectorAll('.cwtw-use-gap').forEach(button => button.addEventListener('click', () => storePendingFillFromGap(modal, gaps, button)));
    modal.querySelector('#cwtw-note-template').addEventListener('change', () => {
      saveSettings({ ...loadSettings(), noteTemplate: modal.querySelector('#cwtw-note-template').value });
      fillTemplateEditor(modal);
      updateChargeCodePreview(modal);
      updateGapNotes(modal, gaps);
    });
    wireTemplateButtons(modal, gaps);
    modal.querySelector('#cwtw-refresh').addEventListener('click', () => {
      saveSettings({ minGapMinutes: modal.querySelector('#cwtw-min-gap').value, debug: modal.querySelector('#cwtw-debug').checked, useWorkdayBoundary: modal.querySelector('#cwtw-boundary-enabled').checked, workdayStart: modal.querySelector('#cwtw-boundary-start').value, workdayEnd: modal.querySelector('#cwtw-boundary-end').value, noteTemplate: modal.querySelector('#cwtw-note-template').value });
      showWorkbench();
    });
    modal.querySelector('#cwtw-copy-generated').addEventListener('click', async () => {
      const status = modal.querySelector('#cwtw-copy-status');
      try { await copyText(modal.querySelector('#cwtw-generated-notes').value); status.textContent = 'Note copied.'; }
      catch (copyError) { status.textContent = `Copy failed: ${copyError.message || copyError}`; }
    });
    modal.querySelector('#cwtw-clear-pending')?.addEventListener('click', () => { clearPendingFill(); showWorkbench(); injectTimeEntryFillPanel(); });
    fillTemplateEditor(modal);
  }

  function storePendingFillFromGap(modal, gaps, button) {
    const status = modal.querySelector('#cwtw-copy-status');
    const gap = gaps[Number(button.dataset.gapIndex)];
    if (!gap) { status.textContent = 'Could not find that gap.'; return; }
    const fill = buildPendingFill(gap, getSelectedTemplate(modal));
    setPendingFill(fill);
    status.textContent = 'Pending fill saved. Open a new Time Entry, then click Fill Times + Copy Note.';
    status.classList.add('cwtw-success');
    showWorkbench();
    injectTimeEntryFillPanel();
  }

  function wireTemplateButtons(modal, gaps) {
    modal.querySelector('#cwtw-save-template').addEventListener('click', () => {
      const status = modal.querySelector('#cwtw-template-status');
      const name = modal.querySelector('#cwtw-template-name').value.trim();
      const body = modal.querySelector('#cwtw-template-body').value.trim();
      const category = modal.querySelector('#cwtw-template-category').value.trim() || name;
      const mapping = chargeCodeForCategory(category);
      const chargeCode = modal.querySelector('#cwtw-template-charge-code').value.trim() || mapping.chargeCode;
      const chargeCodePath = modal.querySelector('#cwtw-template-charge-code-path').value.trim() || mapping.chargeCodePath;
      if (!name || !body) { status.textContent = 'Template name and body are required.'; return; }
      const currentId = modal.querySelector('#cwtw-note-template').value;
      const templates = getTemplateMap(modal);
      const currentTemplate = templates[currentId];
      const matchingId = Object.keys(templates).find(templateId => templates[templateId].label === name);
      const id = matchingId || (currentTemplate?.label === name ? currentId : templateIdFromName(name, templates));
      modal._cwtwTemplates = { ...templates, [id]: { label: name, category, chargeCode, chargeCodePath, template: body } };
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
      updateChargeCodePreview(modal);
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
      updateChargeCodePreview(modal);
      updateGapNotes(modal, gaps);
      modal.querySelector('#cwtw-template-status').textContent = 'Templates reset to defaults.';
    });
  }

  function showGridMissingMessage() {
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.innerHTML = `
      <div class="cwtw-dialog" role="dialog" aria-modal="true" aria-label="Timesheet Workbench">
        <h2>Timesheet Workbench <span class="cwtw-note">manual-fill v0.2.5</span></h2>
        <div class="cwtw-status">Open Daily Time Entries to scan for gaps.</div>
        <div class="cwtw-actions"><button id="cwtw-close" type="button">Close</button></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => { if (event.target === modal) modal.remove(); });
    modal.querySelector('#cwtw-close').addEventListener('click', () => modal.remove());
  }

  function renderPendingFillSummary(fill) {
    return `<div class="cwtw-status cwtw-success"><strong>Pending fill saved.</strong><br>Open a new Time Entry, then click Fill Times + Copy Note.<br>Pending: ${escapeHtml(fill.startText)} - ${escapeHtml(fill.endText)}<br>Template: ${escapeHtml(fill.templateName)}<br>Charge Code: ${escapeHtml(fill.chargeCode || '(none)')}<br><button id="cwtw-clear-pending" type="button">Clear Pending Fill</button></div>`;
  }

  function renderGapCards(gaps) {
    if (!gaps.length) return '<div class="cwtw-status">No gaps detected.</div>';
    return `<div class="cwtw-gap-list">${gaps.map((gap, index) => {
      const minutes = gap.end - gap.start;
      return `<div class="cwtw-gap-card"><label><input class="cwtw-gap-select" type="radio" name="cwtw-selected-gap" ${index === 0 ? 'checked' : ''} data-gap-index="${index}"> <span class="cwtw-gap-time">${formatMinutes(gap.start)} - ${formatMinutes(gap.end)}</span><br><span class="cwtw-gap-duration">${minutes} min / ${(minutes / 60).toFixed(2)} hrs</span></label><button class="cwtw-use-gap" type="button" data-gap-index="${index}">Use for Current Time Entry</button></div>`;
    }).join('')}</div>`;
  }

  function renderCandidateTable(items) {
    if (!items.length) return '<div class="cwtw-status">No raw candidates detected.</div>';
    return `<table><thead><tr><th>Row</th><th>Start text</th><th>End text</th><th>Parsed</th></tr></thead><tbody>${items.map(item => `<tr><td>${item.rowIndex}</td><td>${escapeHtml(item.startText)}</td><td>${escapeHtml(item.endText)}</td><td>${item.start == null || item.end == null ? 'No' : 'Yes'}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderIntervalTable(items) {
    if (!items.length) return '<div class="cwtw-status">None detected.</div>';
    return `<table><thead><tr><th>Start</th><th>End</th><th>Duration</th></tr></thead><tbody>${items.map(item => `<tr><td>${formatMinutes(item.start)}</td><td>${formatMinutes(item.end)}</td><td>${item.end - item.start} min</td></tr>`).join('')}</tbody></table>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  // Safety guard: this script never initiates ConnectWise toolbar/action clicks.
  // The only ConnectWise form updates are confirmed Start Time and End Time fills
  // on individual Time Entry pages; notes are clipboard-only and saving remains manual.
  document.addEventListener('click', event => {
    const label = normalize(textOf(event.target));
    if (SAFE_ACTION_TEXT.has(label)) log('Observed ConnectWise action label; Workbench did not initiate it:', label);
  }, true);

  startObserver();
})();
