// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1.6
// @description  Helpdesk toolkit for ConnectWise ticket triage, ticket copy, board shoutouts, time-entry clipboard helpers, and tab title cleanup. Confirms before DOM-only field changes and keeps clipboard draft fallback mode; no ConnectWise/ITGlue API writes.
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
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// ==/UserScript==

(function () {
  'use strict';

  const APP = 'att-hd-toolkit';
  const DEBUG = !!localStorage.getItem('attentus-debug');
  const log = (...args) => { if (DEBUG) console.log('[HelpdeskToolkit]', ...args); };

  const DEFAULTS = {
    name: 'Sean Dill',
    headline: 'Your 5-star review has a big impact!',
    prefix: 'Please take a moment to ',
    linkText: 'leave a quick Google review.',
    suffix: '',
    closing: 'Mentioning my name helps me get recognized for the work I do.',
    spacedThankYou: false,
    defaultLocation: 'bellevue',
    randomizeLocation: true
  };

  const KEYS = {
    name: 'att_clip_name',
    headline: 'att_clip_headline',
    prefix: 'att_clip_prefix',
    link: 'att_clip_link',
    suffix: 'att_clip_suffix',
    closing: 'att_clip_closing',
    spaced: 'att_clip_spaced',
    defloc: 'att_clip_defloc',
    random: 'att_clip_random',
    boardMaps: 'att_hd_board_maps_v1'
  };

  const REVIEW_URLS = {
    tacoma: 'https://www.attentus.tech/tacoma_reviews',
    seattle: 'https://www.attentus.tech/seattle_reviews',
    bellevue: 'https://www.attentus.tech/bellevue_reviews',
    renton: 'https://www.attentus.tech/renton_reviews'
  };

  const MAINT_DATA_PREFIX = 'data:image/gif;base64,R0lGODlhEAAQAJECAAAAAAD49P///wAAACH5BAEAAAIALAAAAAAQABAAAAImlI+pm+APoQGh2lvBxDxoQXXXF4rZZp5gqpYmyXpoSka2w+T6vhcAOw==';

  const PRIORITY_LABELS = {
    P0: 'P0 - Critical',
    P1: 'P1 - High',
    P2: 'P2 - Medium',
    P3: 'P3 - Normal',
    P4: 'P4 - Low',
    PM: 'Maintenance',
    Unknown: 'Unknown'
  };

  const STATUS_ORDER = [
    'New',
    'New (email)',
    'MUST ASSIGN',
    'MUST ASSIGN - Acknowledged',
    'Re-Opened',
    'Client Has Responded',
    'Waiting Approval',
    'Waiting Client Response',
    'On-Hold',
    'Acknowledged'
  ];

  const TRIAGE_WORKFLOWS = {
    spam: {
      label: 'Apply Spam/Phish…',
      draftLabel: 'Spam/Phishing triage draft',
      title: 'Apply Spam/Phishing triage fields?',
      fields: [
        { key: 'board', label: 'Board', value: 'Help Desk' },
        { key: 'status', label: 'Status', value: 'MUST ASSIGN' },
        { key: 'type', label: 'Type', value: 'Email' },
        { key: 'subtype', label: 'Subtype', value: 'Spam/Phishing' },
        { key: 'tier', label: 'Ticket Tier?', value: 'Tier 1' },
        { key: 'priority', label: 'Priority', value: 'Priority 4' },
        { key: 'summary', label: 'Summary', value: info => `Spam/Phishing${info.contact ? ` (${info.contact})` : ''}` }
      ],
      draftSteps: [
        'Review message headers/body for malicious indicators.',
        'If confirmed: Board Help Desk, Status MUST ASSIGN, Type Email, Subtype Spam/Phishing, Tier 1, Priority 4.',
        'Suggested summary: Spam/Phishing (Contact).'
      ]
    },
    junk: {
      label: 'Apply Junk…',
      draftLabel: 'Junk triage draft',
      title: 'Set ticket Board to Junk?',
      fields: [{ key: 'board', label: 'Board', value: 'Junk' }],
      draftSteps: [
        'Confirm ticket is non-actionable junk/noise.',
        'If confirmed: move to Junk board using normal ConnectWise controls.',
        'Add a short internal note if context may be needed later.'
      ]
    },
    cancel: {
      label: 'Apply Closed/Cancelled…',
      draftLabel: 'Closed/Cancelled triage draft',
      title: 'Apply Closed/Cancelled fields?',
      fields: [
        { key: 'status', label: 'Status', value: '>Closed/Cancelled' },
        { key: 'tier', label: 'Ticket Tier?', value: 'N/A - Cancelled Ticket' }
      ],
      draftSteps: [
        'Confirm the request should be cancelled/closed without action.',
        'If confirmed: set Status to >Closed/Cancelled and Ticket Tier? to N/A - Cancelled Ticket.',
        'Use Save or Save & Close only after manual review.'
      ]
    }
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const norm = s => String(s || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const stripSLA = s => String(s || '').replace(/\b(?:Respond by|Plan by|Waiting|Scheduled|SLA)[^|-\u2014]*$/i, '').replace(/[|\u2014-]\s*$/, '').trim();
  const visible = el => !!(el && el.getClientRects && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  function ensureStyles() {
    if ($(`#${APP}-style`)) return;
    const s = document.createElement('style');
    s.id = `${APP}-style`;
    s.textContent = `
      .${APP}-group{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 6px 4px 0;vertical-align:middle}
      .${APP}-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px 8px;border:1px solid rgba(0,0,0,.22);border-radius:6px;background:#2563eb;color:#fff!important;font:12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap;min-height:24px;box-sizing:border-box}
      .${APP}-btn:hover{filter:brightness(1.06)}.${APP}-btn.secondary{background:#374151}.${APP}-btn.warn{background:#92400e}.${APP}-btn.danger{background:#b91c1c}
      .${APP}-select{padding:3px 6px;border-radius:6px;border:1px solid rgba(0,0,0,.25);font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:white;color:#111827;min-height:24px}
      .${APP}-toast{position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#111827;color:#fff;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.24)}
      .${APP}-modal-bg{position:fixed;inset:0;z-index:2147483645;background:rgba(17,24,39,.38);display:flex;align-items:center;justify-content:center;padding:20px}
      .${APP}-modal{background:#fff;color:#111827;max-width:660px;width:100%;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.35);font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px;max-height:86vh;overflow:auto}
      .${APP}-modal h2{font-size:16px;margin:0 0 10px}.${APP}-modal p{margin:8px 0}.${APP}-modal ul{margin:8px 0 8px 20px;padding:0}
      .${APP}-grid{display:grid;grid-template-columns:145px 1fr;gap:8px;align-items:center}.${APP}-grid input,.${APP}-grid select{padding:6px;border:1px solid #cbd5e1;border-radius:6px}
      .${APP}-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}.${APP}-muted{color:#4b5563;font-size:12px}.${APP}-map-preview{width:100%;min-height:90px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace}
    `;
    document.head.appendChild(s);
  }

  function toast(msg, ms = 1400) {
    const n = document.createElement('div');
    n.className = `${APP}-toast`;
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  function button(id, label, title, onClick, cls = '') {
    let b = $(`#${id}`);
    if (b) return b;
    b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = `${APP}-btn ${cls}`.trim();
    b.textContent = label;
    b.title = title || label;
    b.addEventListener('click', async e => { e.preventDefault(); await onClick(e); });
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } });
    return b;
  }

  function removeEl(id) { const el = $(`#${id}`); if (el) el.remove(); }

  function makeGroup(id, label) {
    const g = document.createElement('span');
    g.id = id;
    g.className = `${APP}-group`;
    if (label) {
      const l = document.createElement('strong');
      l.textContent = label;
      l.style.font = '12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
      l.style.color = '#111827';
      g.appendChild(l);
    }
    return g;
  }

  function modal({ id, title, body, actions }) {
    removeEl(id);
    const bg = document.createElement('div');
    bg.id = id;
    bg.className = `${APP}-modal-bg`;
    const card = document.createElement('div');
    card.className = `${APP}-modal`;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.innerHTML = `<h2>${esc(title)}</h2><div class="${APP}-body">${body}</div>`;
    const actionRow = document.createElement('div');
    actionRow.className = `${APP}-actions`;
    (actions || []).forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `${APP}-btn ${action.cls || 'secondary'}`.trim();
      btn.textContent = action.label;
      btn.addEventListener('click', async () => {
        await action.onClick?.();
        if (action.close !== false) bg.remove();
      });
      actionRow.appendChild(btn);
    });
    card.appendChild(actionRow);
    bg.appendChild(card);
    bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
  }

  async function gmGet(key, defVal) {
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }

  async function gmSet(key, value) {
    try { if (typeof GM_setValue === 'function') return GM_setValue(key, value); } catch {}
    try { if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  async function writeClipboard(html, text) {
    const safeText = String(text || '');
    const safeHtml = String(html || safeText).trim() || esc(safeText).replace(/\n/g, '<br>');
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([safeHtml], { type: 'text/html' }),
          'text/plain': new Blob([safeText], { type: 'text/plain' })
        })]);
        return true;
      } catch (err) { log('navigator rich clipboard failed', err); }
    }
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(safeHtml, 'html'); return true; } } catch {}
    try { if (typeof GM !== 'undefined' && GM.setClipboard) { await GM.setClipboard(safeHtml, { type: 'text/html' }); return true; } } catch {}
    if (navigator.clipboard) { try { await navigator.clipboard.writeText(safeText); return true; } catch {} }
    try {
      const ta = document.createElement('textarea');
      ta.value = safeText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch {}
    return false;
  }

  // ---------- page/context gates ----------
  function getTicketId() {
    const search = new URLSearchParams(location.search || '');
    for (const key of ['service_recid', 'recid', 'serviceticketid', 'srServiceRecID']) {
      const val = search.get(key);
      if (/^\d+$/.test(val || '')) return val;
    }
    const m = String(location.href).match(/[?&](?:service_recid|recid|serviceticketid)=([0-9]+)/i);
    if (m) return m[1];
    const label = $$('.cw_CwLabel,.gwt-Label,.mm_label,.cw_CwHTML').map(txt).find(t => /(?:service\s*ticket\s*#|ticket\s*#)\s*\d+/i.test(t));
    const lm = label && label.match(/#\s*(\d+)/);
    return lm ? lm[1] : '';
  }

  function hasServiceTicketNavLabel() {
    return $$('.navigationEntry.cw_CwLabel,.navigationEntry.mm_label,.navigationEntry.gwt-Label,.navigationEntry').some(el => /service\s+ticket/i.test(txt(el)));
  }

  function hasAgeLabel() {
    return $$('.cw_CwHTML.mm_label,.gwt-HTML.mm_label.cw_CwHTML,.cw_CwHTML,.mm_label').some(el => /age\s*:/i.test(txt(el)));
  }

  function isTicketContextLoose() {
    if (getTicketId()) return true;
    if ($('.pod_ticketSummary,.pod_ticketHeaderActions,.pod_service_ticket_ticket')) return true;
    return $$('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label').some(el => /service\s+ticket/i.test(txt(el)));
  }

  function isCanonicalServiceTicketPage() {
    const ok = (hasServiceTicketNavLabel() && hasAgeLabel()) || !!$('.pod_service_ticket_ticket input.cw_summary');
    log('canonical ticket gate', { ok, nav: hasServiceTicketNavLabel(), age: hasAgeLabel() });
    return ok;
  }

  function isProjectTicket() {
    return $$('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label').some(el => /project\s+ticket/i.test(txt(el)));
  }

  function isTimeSheetContext() {
    if (/timesheet/i.test(location.href)) return true;
    if ($('.mytimesheetlist,.TimeSheet')) return true;
    return $$('.cw-main-banner .navigationEntry,.cw-main-banner .cw_CwLabel').some(el => /open time sheets|time sheet/i.test(txt(el)));
  }

  function isTimeEntryContext() {
    if (isTimeSheetContext()) return false;
    if (/time(entry|_entry)|TimeEntry|time_recid/i.test(location.href)) return true;
    return $$('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label').some(el => /^time\s+entry$/i.test(txt(el)));
  }

  function isTicketThreadTimeContext() {
    if (isTimeSheetContext()) return false;
    return isTicketContextLoose() && !!threadTimepadMountTarget();
  }

  function getViewInput() {
    return $('.cw-toolbar-view-dropdown input.cw_CwComboBox') || $('.cw-toolbar-view-dropdown [id$="-input"].cw_CwComboBox');
  }

  function isBoard() {
    return !isTicketContextLoose() && !isTimeEntryContext() && !!$('table.srboard-grid') && !!$('table.srboard-grid tr.cw-ml-row') && !!getViewInput();
  }

  function pageContextSig() {
    if (isCanonicalServiceTicketPage()) return `ticket:${getTicketId() || location.pathname + location.search}`;
    if (isBoard()) return `board:${location.pathname + location.search}:${readViewExact()}`;
    if (isTimeEntryContext()) return `time:${location.pathname + location.search}`;
    if (isTicketThreadTimeContext()) return `thread:${getTicketId() || location.pathname + location.search}`;
    return `other:${location.pathname + location.search}`;
  }

  // ---------- field reads/copy ----------
  function readLabeledValue(labelRegex) {
    const labels = $$('.cw_CwLabel,.gwt-Label,.mm_label,label,.cw_CwHTML');
    for (const l of labels) {
      const text = txt(l).replace(/:$/, '');
      if (!labelRegex.test(text)) continue;
      const row = l.closest('tr,.pod-element-row,.cw_Container,.form-group,.gwt-HTMLPanel,.mm_field') || l.parentElement;
      if (!row) continue;
      const input = row.querySelector('input, textarea');
      if (input && 'value' in input && norm(input.value)) return norm(input.value);
      const candidates = $$('.cw_CwLabel,.gwt-Label,.mm_label,.cw_CwHTML,span,div', row).map(txt).filter(Boolean);
      const val = candidates.find(v => v !== txt(l) && !labelRegex.test(v));
      if (val) return val;
    }
    return '';
  }

  function currentTicketInfo() {
    const id = getTicketId();
    const url = id ? `${location.origin}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}` : location.href;
    const company = readLabeledValue(/^company$/i) || readLabeledValue(/^company name$/i);
    const contact = readLabeledValue(/^contact$/i) || readLabeledValue(/^contact name$/i);
    const summary = readFieldValue('summary') || readLabeledValue(/^summary$/i) || document.title.replace(/^.*?\bTicket\b/i, '').trim();
    const email = readLabeledValue(/^email$/i) || readLabeledValue(/^email address$/i);
    const phone = readLabeledValue(/^phone$/i) || readLabeledValue(/^phone number$/i);
    return { id, url, company, contact, summary, email, phone };
  }

  async function copyTicketLink(compact = false) {
    const info = currentTicketInfo();
    const label = info.id ? `Ticket #${info.id}` : 'ConnectWise ticket';
    const detail = [info.company, info.contact].filter(Boolean).join(', ');
    const html = compact
      ? `<a href="${esc(info.url)}">${esc(info.url)}</a>`
      : `<a href="${esc(info.url)}"><strong>${esc(label)}</strong></a>${detail ? ` - ${esc(detail)}` : ''}${info.summary ? `<br>${esc(info.summary)}` : ''}`;
    const text = compact ? info.url : [label, detail, info.summary, info.url].filter(Boolean).join('\n');
    toast(await writeClipboard(html, text) ? 'Copied ticket link' : 'Copy failed');
  }

  async function copyContact() {
    const info = currentTicketInfo();
    const lines = [info.contact && `Contact: ${info.contact}`, info.email && `Email: ${info.email}`, info.phone && `Phone: ${info.phone}`, info.company && `Company: ${info.company}`].filter(Boolean);
    if (!lines.length) { toast('No contact details found'); return; }
    toast(await writeClipboard(lines.map(esc).join('<br>'), lines.join('\n')) ? 'Copied contact details' : 'Copy failed');
  }

  // ---------- ConnectWise UI field automation (no API writes) ----------
  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function commitBlur(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.blur();
  }

  async function until(fn, { tries = 30, delay = 70 } = {}) {
    for (let i = 0; i < tries; i++) {
      const val = fn();
      if (val) return val;
      await sleep(delay);
    }
    return null;
  }

  async function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(40);
    return true;
  }

  async function openPopupAndGetContainer(input) {
    if (!input) return null;
    input.focus();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(80);
    return $('.popupContent,.gwt-PopupPanel,.GMPD3GJDKP,.GMDB3DUBKP,.x-combo-list') || document.body;
  }

  function findClickableOption(root, desiredValue) {
    const target = norm(desiredValue).toLowerCase();
    const cands = $$('div,td,li,span', root).filter(visible);
    return cands.find(el => norm(el.textContent).toLowerCase() === target)
        || cands.find(el => norm(el.textContent).toLowerCase().startsWith(target))
        || cands.find(el => norm(el.textContent).toLowerCase().includes(target))
        || null;
  }

  async function commitComboOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (norm(input.value) === norm(desiredValue)) return true;
    const popup = await openPopupAndGetContainer(input);
    const opt = popup && findClickableOption(popup, desiredValue);
    if (opt) {
      await clickLikeUser(opt);
      commitBlur(input);
      await sleep(90);
      return norm(input.value) === norm(desiredValue);
    }
    input.focus();
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.value = String(desiredValue);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(120);
    return norm(input.value) === norm(desiredValue);
  }

  function findInputNearLabel(labelText) {
    const needle = norm(String(labelText).replace(/[:?]\s*$/, '')).toLowerCase();
    const rows = $$('tr,.pod-element-row,.mm_field,.cw_Container,.gwt-HTMLPanel,div');
    for (const row of rows) {
      const label = $('.mm_label,.cw_CwLabel,.gwt-Label,label,[id$="-label"]', row);
      const text = norm(txt(label).replace(/[:?]\s*$/, '')).toLowerCase();
      if (!text || text !== needle) continue;
      const input = $('input,textarea', row);
      if (input) return input;
    }
    return null;
  }

  function fieldElement(key) {
    const selectors = {
      board: ['input.cw_serviceBoard', 'input[aria-label="Board"]', 'input[id*="Board"][role="combobox"]'],
      status: ['input.cw_status', 'input[aria-label="Status"]', 'input[id*="Status"][role="combobox"]'],
      type: ['input.cw_type', 'input[aria-label="Type"]', 'input[id*="Type"][role="combobox"]'],
      subtype: ['input.cw_subType', 'input.cw_subtype', 'input[aria-label="Subtype"]', 'input[aria-label="Sub Type"]', 'input[id*="SubType"][role="combobox"]'],
      priority: ['input.cw_priority', 'input[aria-label="Priority"]', 'input[id*="Priority"][role="combobox"]'],
      summary: ['input.cw_summary', 'input[aria-label="Summary"]', 'input[placeholder*="summary" i]'],
      tier: []
    };
    for (const sel of selectors[key] || []) {
      const el = $(sel);
      if (el && visible(el)) return el;
    }
    if (key === 'tier') return findInputNearLabel('Ticket Tier?') || findInputNearLabel('Tier') || findInputNearLabel('Item');
    return findInputNearLabel(key);
  }

  function readFieldValue(key) {
    const el = fieldElement(key);
    return el && 'value' in el ? el.value || '' : '';
  }

  async function setFieldValue(key, value) {
    const el = await until(() => fieldElement(key), { tries: 35, delay: 70 });
    if (!el) return { ok: false, reason: `Field not found: ${key}` };
    if (key === 'summary') {
      el.focus();
      el.value = String(value);
      dispatchAll(el);
      await sleep(80);
      return { ok: norm(el.value) === norm(value), reason: `Could not set ${key}` };
    }
    const ok = await commitComboOnElement(el, value);
    return { ok, reason: `Could not set ${key} to ${value}` };
  }

  function findToolbarButton(cls) {
    const el = $(`.${cls}`);
    return visible(el) ? el : null;
  }

  async function clickSave() { return clickLikeUser(findToolbarButton('cw_ToolbarButton_Save')); }
  async function clickSaveAndClose() { return clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose')); }

  // ---------- clear contact ----------
  function contactTargets() {
    const selectors = [
      'input.cw_contact', 'input[aria-label="Contact"]', 'input[id*="Contact"][role="combobox"]', 'input[name="ContactRecID"]',
      'input.cw_emailAddress', 'input[aria-label="Email"]', 'input[name="EmailAddress"]',
      'input[aria-label="Phone"]', 'input[name="PhoneNumber"]', 'input[aria-label*="Ext"]', 'input[name*="Ext"]'
    ];
    const set = new Set();
    selectors.forEach(sel => $$(sel).forEach(el => { if ('value' in el) set.add(el); }));
    const phoneBlock = $('.cw_contactPhoneCommunications');
    if (phoneBlock) $$('input[type="text"]', phoneBlock).forEach(el => { if ('value' in el) set.add(el); });
    return Array.from(set).filter(el => !el.disabled && !el.readOnly);
  }

  function snapshotElements(elements) {
    return elements.map(el => ({ el, value: el.value || '' }));
  }

  function restoreSnapshot(snapshot) {
    snapshot.forEach(item => {
      if (!item.el || !document.contains(item.el)) return;
      item.el.value = item.value;
      dispatchAll(item.el);
    });
  }

  function confirmClearContact() {
    if (!isCanonicalServiceTicketPage() || isProjectTicket()) { toast('Clear Contact is only available on Service Tickets'); return; }
    const targets = contactTargets().filter(el => el.value);
    if (!targets.length) { toast('No contact/email/phone fields to clear'); return; }
    const snapshot = snapshotElements(targets);
    modal({
      id: `${APP}-clear-confirm`,
      title: 'Clear contact fields?',
      body: `<p>This will clear visible Contact, Email, Phone, and Ext fields in the ConnectWise UI only. Nothing is saved until you use ConnectWise Save.</p><ul>${snapshot.map(item => `<li>${esc(item.el.getAttribute('aria-label') || item.el.name || item.el.className || 'Field')}: ${esc(item.value)}</li>`).join('')}</ul>`,
      actions: [
        { label: 'Cancel' },
        { label: 'Clear Fields', cls: 'danger', onClick: () => {
          snapshot.forEach(item => { if (document.contains(item.el)) { item.el.value = ''; dispatchAll(item.el); } });
          showPostUiAction('Contact fields cleared. Changes are unsaved.', snapshot);
        }}
      ]
    });
  }

  function showPostUiAction(title, snapshot) {
    modal({
      id: `${APP}-post-action`,
      title,
      body: '<p>These changes are currently only in the ConnectWise browser UI. Choose Revert, leave them unsaved for manual review, or explicitly Save.</p>',
      actions: [
        { label: 'Revert', cls: 'secondary', onClick: () => { restoreSnapshot(snapshot); toast('Reverted UI changes'); } },
        { label: 'Leave Unsaved', cls: 'secondary', onClick: () => toast('Left unsaved') },
        { label: 'Save', onClick: async () => { if (!await clickSave()) toast('Save button not found'); } },
        { label: 'Save & Close', cls: 'warn', onClick: async () => { if (!await clickSaveAndClose()) toast('Save & Close button not found'); } }
      ]
    });
  }

  // ---------- triage ----------
  function resolvedWorkflowFields(kind) {
    const info = currentTicketInfo();
    const wf = TRIAGE_WORKFLOWS[kind] || TRIAGE_WORKFLOWS.spam;
    return { wf, info, fields: wf.fields.map(f => ({ ...f, value: typeof f.value === 'function' ? f.value(info) : f.value })) };
  }

  async function copyTriage(kind) {
    const { wf, info, fields } = resolvedWorkflowFields(kind);
    const lines = [
      wf.draftLabel,
      info.id && `Ticket #${info.id}: ${info.url}`,
      info.company && `Company: ${info.company}`,
      info.contact && `Contact: ${info.contact}`,
      info.summary && `Summary: ${info.summary}`,
      '',
      ...wf.draftSteps.map(step => `- ${step}`),
      '',
      'Field plan:',
      ...fields.map(f => `- ${f.label}: ${f.value}`)
    ].filter(v => v !== false && v != null);
    const html = lines.map(line => line ? esc(line) : '<br>').join('<br>');
    toast(await writeClipboard(html, lines.join('\n')) ? 'Copied triage draft' : 'Copy failed');
  }

  function confirmApplyTriage(kind) {
    if (!isCanonicalServiceTicketPage() || isProjectTicket()) { toast('Triage actions are only available on Service Tickets'); return; }
    const { wf, fields } = resolvedWorkflowFields(kind);
    modal({
      id: `${APP}-triage-confirm`,
      title: wf.title,
      body: `<p>This will change visible ConnectWise ticket fields only. No API write is used, and nothing is saved unless you choose Save afterward.</p><ul>${fields.map(f => `<li><strong>${esc(f.label)}:</strong> ${esc(f.value)}</li>`).join('')}</ul>`,
      actions: [
        { label: 'Cancel' },
        { label: 'Copy Draft Only', cls: 'secondary', onClick: () => copyTriage(kind) },
        { label: 'Apply Fields', cls: 'warn', onClick: () => applyTriage(kind) }
      ]
    });
  }

  async function applyTriage(kind) {
    const { wf, fields } = resolvedWorkflowFields(kind);
    const snapshot = fields.map(f => ({ key: f.key, label: f.label, value: readFieldValue(f.key), el: fieldElement(f.key) })).filter(s => s.el);
    const failures = [];
    for (const f of fields) {
      const ret = await setFieldValue(f.key, f.value);
      if (!ret.ok) failures.push(ret.reason);
    }
    if (failures.length) {
      toast(`Triage incomplete: ${failures[0]}`, 2600);
      modal({
        id: `${APP}-triage-failed`,
        title: 'Triage incomplete',
        body: `<p>Some fields could not be applied:</p><ul>${failures.map(f => `<li>${esc(f)}</li>`).join('')}</ul><p>You can revert fields that were captured before trying again.</p>`,
        actions: [
          { label: 'Revert Captured Fields', cls: 'secondary', onClick: () => { restoreSnapshot(snapshot); toast('Reverted captured fields'); } },
          { label: 'Close' }
        ]
      });
      return;
    }
    showPostUiAction(`${wf.draftLabel.replace(' draft', '')} fields applied.`, snapshot);
  }

  // ---------- ticket toolbar ----------
  function findTicketActionMount() {
    const follow = $$('.cw_ToolbarButton,.mm_button,button,div[role="button"],.cw_CwActionButton').find(el => /^follow$/i.test(txt(el)) || /follow/i.test(txt(el)));
    if (follow && follow.parentElement) return follow.parentElement;
    const save = $('.cw_ToolbarButton_Save');
    if (save && save.parentElement) return save.parentElement;
    return $('.pod_ticketHeaderActions,.cw-main-toolbar,.cw_toolbar,.MainToolbar') || document.body;
  }

  function ensureTicketTools() {
    const loose = isTicketContextLoose();
    const canonical = isCanonicalServiceTicketPage() && !isProjectTicket();
    if (!loose) { removeEl(`${APP}-ticket-group`); return; }
    const existing = $(`#${APP}-ticket-group`);
    if (existing && existing.dataset.canonical === String(canonical)) return;
    if (existing) existing.remove();
    const mount = findTicketActionMount();
    if (!mount) return;
    const g = makeGroup(`${APP}-ticket-group`, 'Helpdesk:');
    g.dataset.canonical = String(canonical);
    g.append(
      button(`${APP}-copy-ticket`, 'Copy Ticket', 'Copy a formatted ticket link', () => copyTicketLink(false)),
      button(`${APP}-copy-url`, 'URL', 'Copy only the ticket URL', () => copyTicketLink(true), 'secondary'),
      button(`${APP}-copy-contact`, 'Copy Contact', 'Copy detected contact details', copyContact, 'secondary')
    );
    if (canonical) {
      g.append(
        button(`${APP}-clear-contact`, 'Clear Contact…', 'Clear Contact, Email, Phone, and Ext after confirmation', confirmClearContact, 'danger'),
        button(`${APP}-triage-spam`, TRIAGE_WORKFLOWS.spam.label, 'Confirm then apply Spam/Phishing fields in the UI', () => confirmApplyTriage('spam'), 'warn'),
        button(`${APP}-triage-junk`, TRIAGE_WORKFLOWS.junk.label, 'Confirm then set Board to Junk in the UI', () => confirmApplyTriage('junk'), 'warn'),
        button(`${APP}-triage-cancel`, TRIAGE_WORKFLOWS.cancel.label, 'Confirm then apply Closed/Cancelled fields in the UI', () => confirmApplyTriage('cancel'), 'warn')
      );
    }
    mount.appendChild(g);
  }

  // ---------- time-entry clipboard ----------
  function findThreadPodHeaderByLabel(textNeedle) {
    const want = String(textNeedle || '').toLowerCase();
    return $$('.mm_podHeader [id$="-label"],.pod_unknown_header [id$="-label"]').find(el => txt(el).toLowerCase().includes(want)) || null;
  }

  function threadTimepadMountTarget() {
    const label = findThreadPodHeaderByLabel('thread: auto time entries');
    if (label) return label.closest('.mm_podHeader,.pod_unknown_header') || label;
    return $('.pod_hosted_16_header') || $('.pod_hosted_16') || null;
  }

  function findNotesTimestampButton() {
    for (const st of $$('.cw_ToolbarButton_TimeStamp')) {
      const row = st.closest('tr');
      if (!row || /notes$/i.test(txt(row))) return st;
    }
    return null;
  }

  function findTimeEntryMount() {
    const stamp = findNotesTimestampButton();
    if (stamp) return stamp.parentElement || stamp;
    if (isTicketContextLoose()) return threadTimepadMountTarget();
    return null;
  }

  function signatureHTML(name, { spacedThankYou = false } = {}) {
    return `<div style="margin:0;line-height:1.35"><div>Thank you,</div>${spacedThankYou ? '<div><br></div>' : ''}<div><strong>${esc(name)}</strong></div><div>Attentus Technologies</div><div><strong>Support:</strong> (253) 218-6015 x1</div><div>Call or Text Us: (253) 218-6015</div></div>`;
  }

  function signatureText(name, { spacedThankYou = false } = {}) {
    return ['Thank you,', spacedThankYou ? '' : null, name, 'Attentus Technologies', 'Support: (253) 218-6015 x1', 'Call or Text Us: (253) 218-6015'].filter(v => v !== null).join('\n');
  }

  async function reviewContent(selectedLocation) {
    const headline = await gmGet(KEYS.headline, DEFAULTS.headline);
    const prefix = await gmGet(KEYS.prefix, DEFAULTS.prefix);
    const linkText = await gmGet(KEYS.link, DEFAULTS.linkText);
    const suffix = await gmGet(KEYS.suffix, DEFAULTS.suffix);
    const closing = await gmGet(KEYS.closing, DEFAULTS.closing);
    const random = await gmGet(KEYS.random, DEFAULTS.randomizeLocation);
    const defLoc = await gmGet(KEYS.defloc, DEFAULTS.defaultLocation);
    const locs = Object.keys(REVIEW_URLS);
    const loc = random ? locs[Math.floor(Math.random() * locs.length)] : (selectedLocation || defLoc || 'bellevue');
    const url = REVIEW_URLS[loc] || REVIEW_URLS.bellevue;
    const gap1 = /\s$/.test(prefix) ? '' : ' ';
    const gap2 = suffix && !/^\s/.test(suffix) ? ' ' : '';
    return {
      html: `<div style="margin:0;line-height:1.35"><div><strong>${esc(headline)}</strong></div><div>${esc(prefix)}${gap1}<a href="${esc(url)}">${esc(linkText)}</a>${gap2}${esc(suffix)}</div><div>${esc(closing)}</div></div>`,
      text: [headline, `${prefix}${gap1}${linkText}${gap2}${suffix}`.trim(), url, closing].filter(Boolean).join('\n'),
      loc
    };
  }

  async function openClipboardSettings() {
    const values = {
      name: await gmGet(KEYS.name, DEFAULTS.name),
      headline: await gmGet(KEYS.headline, DEFAULTS.headline),
      prefix: await gmGet(KEYS.prefix, DEFAULTS.prefix),
      link: await gmGet(KEYS.link, DEFAULTS.linkText),
      suffix: await gmGet(KEYS.suffix, DEFAULTS.suffix),
      closing: await gmGet(KEYS.closing, DEFAULTS.closing),
      spaced: await gmGet(KEYS.spaced, DEFAULTS.spacedThankYou),
      defloc: await gmGet(KEYS.defloc, DEFAULTS.defaultLocation),
      random: await gmGet(KEYS.random, DEFAULTS.randomizeLocation)
    };
    const bg = modal({
      id: `${APP}-settings-bg`,
      title: 'Clipboard settings',
      body: `<div class="${APP}-grid">
        <label>Name</label><input id="${APP}-set-name" value="${esc(values.name)}">
        <label>Headline</label><input id="${APP}-set-headline" value="${esc(values.headline)}">
        <label>Prefix</label><input id="${APP}-set-prefix" value="${esc(values.prefix)}">
        <label>Link text</label><input id="${APP}-set-link" value="${esc(values.link)}">
        <label>Suffix</label><input id="${APP}-set-suffix" value="${esc(values.suffix)}">
        <label>Closing</label><input id="${APP}-set-closing" value="${esc(values.closing)}">
        <label>Spaced thank-you</label><input id="${APP}-set-spaced" type="checkbox" ${values.spaced ? 'checked' : ''}>
        <label>Default location</label><select id="${APP}-set-defloc"><option value="bellevue">Bellevue</option><option value="renton">Renton</option><option value="seattle">Seattle</option><option value="tacoma">Tacoma</option></select>
        <label>Randomize reviews</label><input id="${APP}-set-random" type="checkbox" ${values.random ? 'checked' : ''}>
      </div>`,
      actions: [
        { label: 'Cancel' },
        { label: 'Save', onClick: async () => {
          await gmSet(KEYS.name, $(`#${APP}-set-name`).value.trim() || DEFAULTS.name);
          await gmSet(KEYS.headline, $(`#${APP}-set-headline`).value);
          await gmSet(KEYS.prefix, $(`#${APP}-set-prefix`).value);
          await gmSet(KEYS.link, $(`#${APP}-set-link`).value);
          await gmSet(KEYS.suffix, $(`#${APP}-set-suffix`).value);
          await gmSet(KEYS.closing, $(`#${APP}-set-closing`).value);
          await gmSet(KEYS.spaced, $(`#${APP}-set-spaced`).checked);
          await gmSet(KEYS.defloc, $(`#${APP}-set-defloc`).value);
          await gmSet(KEYS.random, $(`#${APP}-set-random`).checked);
          toast('Settings saved');
        }}
      ]
    });
    $(`#${APP}-set-defloc`, bg).value = values.defloc;
  }

  async function ensureTimeEntryTools() {
    if (!(isTimeEntryContext() || isTicketThreadTimeContext())) { removeEl(`${APP}-time-group`); return; }
    const mount = findTimeEntryMount();
    if (!mount) { removeEl(`${APP}-time-group`); return; }
    const existing = $(`#${APP}-time-group`);
    if (existing && existing.parentElement === mount) return;
    if (existing) existing.remove();
    const g = makeGroup(`${APP}-time-group`, 'Clipboard:');
    const select = document.createElement('select');
    select.id = `${APP}-review-loc`;
    select.className = `${APP}-select`;
    for (const loc of Object.keys(REVIEW_URLS)) {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc[0].toUpperCase() + loc.slice(1);
      select.appendChild(opt);
    }
    select.value = await gmGet(KEYS.defloc, DEFAULTS.defaultLocation);
    select.addEventListener('change', async () => { await gmSet(KEYS.defloc, select.value); toast(`Default location: ${select.value}`); });
    g.append(
      select,
      button(`${APP}-clip-settings`, '⚙', 'Clipboard settings', openClipboardSettings, 'secondary'),
      button(`${APP}-sig`, 'Copy signature', 'Copy signature', async () => {
        const name = await gmGet(KEYS.name, DEFAULTS.name);
        const spaced = await gmGet(KEYS.spaced, DEFAULTS.spacedThankYou);
        toast(await writeClipboard(signatureHTML(name, { spacedThankYou: spaced }), signatureText(name, { spacedThankYou: spaced })) ? 'Copied signature' : 'Copy failed');
      }),
      button(`${APP}-review`, 'Copy review + signature', 'Copy review request and signature', async () => {
        const review = await reviewContent(select.value);
        const name = await gmGet(KEYS.name, DEFAULTS.name);
        const spaced = await gmGet(KEYS.spaced, DEFAULTS.spacedThankYou);
        const html = `${review.html}<div><br></div>${signatureHTML(name, { spacedThankYou: spaced })}`;
        const text = `${review.text}\n\n${signatureText(name, { spacedThankYou: spaced })}`;
        toast(await writeClipboard(html, text) ? `Copied review (${review.loc})` : 'Copy failed');
      })
    );
    mount.appendChild(g);
  }

  // ---------- board shoutouts ----------
  function boardRows() { return $$('table.srboard-grid tr.cw-ml-row').filter(visible); }
  function cellText(row, index) { return index == null || index < 0 ? '' : txt(row.querySelector(`td[cellindex="${index}"]`)); }
  function readViewExact() { const inp = getViewInput(); return inp && typeof inp.value === 'string' && inp.value.trim() ? inp.value.trim() : '(No View)'; }
  function boardKey() { return `${location.host.toLowerCase()}::${readViewExact()}`; }
  async function getBoardMaps() { const raw = await gmGet(KEYS.boardMaps, '{}'); try { return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch { return {}; } }
  async function setBoardMaps(maps) { await gmSet(KEYS.boardMaps, JSON.stringify(maps || {})); }

  function boardColumns() {
    const row = boardRows()[0];
    if (!row) return [];
    return $$('td[cellindex]', row).map(td => {
      const idx = Number(td.getAttribute('cellindex'));
      return { idx, label: `${idx}: ${txt(td).slice(0, 42) || '(blank)'}` };
    });
  }

  function guessBoardMap() {
    const row = boardRows()[0];
    const map = {};
    if (!row) return map;
    const cells = $$('td[cellindex]', row);
    const set = (key, pred) => { if (map[key] != null) return; const c = cells.find(pred); if (c) map[key] = Number(c.getAttribute('cellindex')); };
    set('ticket', c => /^\d{5,}$/.test(txt(c)) || !!c.querySelector('a[href*="service_recid"]'));
    set('priority', c => {
      const node = c.querySelector('img') || c.firstElementChild || c;
      return priorityFromText(txt(c)) !== 'Unknown' || !!c.querySelector('img') || !!extractDataUrlFromNode(node) || !!priorityFromRgb(parseRgb(getComputedStyle(node).color));
    });
    set('status', c => STATUS_ORDER.some(st => norm(txt(c)).toLowerCase() === st.toLowerCase()));
    return map;
  }

  async function openBoardSetup() {
    if (!isBoard()) { toast('Open a Service Board view first'); return; }
    const cols = boardColumns();
    if (!cols.length) { toast('No board rows to map'); return; }
    const maps = await getBoardMaps();
    const saved = maps[boardKey()] || guessBoardMap();
    const optHtml = (selected) => ['<option value="">-- choose --</option>'].concat(cols.map(c => `<option value="${c.idx}" ${Number(selected) === c.idx ? 'selected' : ''}>${esc(c.label)}</option>`)).join('');
    const sample = boardRows()[0];
    const preview = () => {
      const val = id => Number($(`#${APP}-${id}`)?.value);
      const parts = [val('map-ticket'), val('map-priority'), val('map-summary'), val('map-company'), val('map-status'), val('map-resource')].map(i => Number.isFinite(i) ? cellText(sample, i) : '').filter(Boolean);
      const pv = $(`#${APP}-map-preview`);
      if (pv) pv.value = parts.join(' | ');
    };
    const bg = modal({
      id: `${APP}-board-setup-modal`,
      title: `Board mapping: ${readViewExact()}`,
      body: `<p class="${APP}-muted">Saved per host + exact view name. This prevents bad Teams shoutouts when columns move.</p><div class="${APP}-grid">
        <label>Ticket #</label><select id="${APP}-map-ticket">${optHtml(saved.ticket)}</select>
        <label>Priority</label><select id="${APP}-map-priority">${optHtml(saved.priority)}</select>
        <label>Summary</label><select id="${APP}-map-summary">${optHtml(saved.summary)}</select>
        <label>Company</label><select id="${APP}-map-company">${optHtml(saved.company)}</select>
        <label>Contact</label><select id="${APP}-map-contact">${optHtml(saved.contact)}</select>
        <label>Status</label><select id="${APP}-map-status">${optHtml(saved.status)}</select>
        <label>Resource</label><select id="${APP}-map-resource">${optHtml(saved.resource)}</select>
      </div><p>Preview</p><textarea id="${APP}-map-preview" class="${APP}-map-preview" readonly></textarea>`,
      actions: [
        { label: 'Cancel' },
        { label: 'Save Mapping', onClick: async () => {
          const val = id => { const v = $(`#${APP}-${id}`).value; return v === '' ? null : Number(v); };
          const next = { ticket: val('map-ticket'), priority: val('map-priority'), summary: val('map-summary'), company: val('map-company'), contact: val('map-contact'), status: val('map-status'), resource: val('map-resource') };
          const all = await getBoardMaps();
          all[boardKey()] = next;
          await setBoardMaps(all);
          toast('Board mapping saved');
        }}
      ]
    });
    $$('select', bg).forEach(sel => sel.addEventListener('change', preview));
    preview();
  }

  function priorityFromText(s) {
    const text = norm(s).toUpperCase();
    const match = text.match(/\bP[0-4]\b/);
    if (match) return match[0];
    if (/MAINT|MAINTENANCE/.test(text)) return 'PM';
    return 'Unknown';
  }

  function parseRgb(s) {
    const match = /rgba?\s*\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s || '');
    return match ? { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) } : null;
  }

  function isBlack(r, g, b) { return r < 40 && g < 40 && b < 40; }
  function isRed(r, g, b) { return r > 150 && g < 110 && b < 110; }
  function isOrange(r, g, b) { return r > 200 && g > 110 && g < 200 && b < 90; }
  function isYellow(r, g, b) { return r > 200 && g > 200 && b < 140; }
  function isBlue(r, g, b) { return b > 140 && r < 120 && g < 190; }

  function priorityFromRgb(rgb) {
    if (!rgb) return '';
    const { r, g, b } = rgb;
    if (isBlack(r, g, b)) return 'P0';
    if (isRed(r, g, b)) return 'P1';
    if (isOrange(r, g, b)) return 'P2';
    if (isYellow(r, g, b)) return 'P3';
    if (isBlue(r, g, b)) return 'P4';
    return '';
  }

  function extractDataUrlFromNode(node) {
    if (!node) return '';
    if (node.tagName === 'IMG' && /^data:image/i.test(node.getAttribute('src') || '')) return node.getAttribute('src');
    const pick = s => String(s || '').replace(/^.*url\(["']?/, '').replace(/["']?\).*$/, '');
    const inline = (node.style && (node.style.background || node.style.backgroundImage)) || '';
    let url = /url\(/.test(inline) ? pick(inline) : '';
    if (!url) {
      const bg = getComputedStyle(node).backgroundImage || '';
      if (/url\(/.test(bg)) url = pick(bg);
    }
    return /^data:image/i.test(url) ? url : '';
  }

  function sampleDataUrl(url) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || 16;
          canvas.height = img.naturalHeight || 16;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          resolve({ r: data[0], g: data[1], b: data[2] });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function readPriorityFromCell(td) {
    if (!td) return 'Unknown';
    const node = td.querySelector('img') || td.firstElementChild || td;
    const hint = [td.title, node?.title, node?.alt, node?.getAttribute?.('aria-label'), txt(td)].filter(Boolean).join(' ');
    const hinted = priorityFromText(hint);
    if (hinted !== 'Unknown') return hinted;

    const url = extractDataUrlFromNode(node);
    if (url && url.indexOf(MAINT_DATA_PREFIX) === 0) return 'PM';
    if (url) {
      const sampled = priorityFromRgb(await sampleDataUrl(url));
      if (sampled) return sampled;
    }

    const nodeColor = priorityFromRgb(parseRgb(getComputedStyle(node).color));
    if (nodeColor) return nodeColor;
    const tdColor = node !== td ? priorityFromRgb(parseRgb(getComputedStyle(td).color)) : '';
    if (tdColor) return tdColor;
    return 'Unknown';
  }

  function cellByIndex(row, index) {
    return index == null || index < 0 ? null : row.querySelector(`td[cellindex="${index}"]`);
  }

  async function ticketFromRow(row, map) {
    const direct = cellText(row, map.ticket).match(/\d{5,}/);
    const link = row.querySelector('a[href*="service_recid="]');
    const hrefId = link && link.href.match(/[?&]service_recid=(\d+)/i);
    const id = direct ? direct[0] : (hrefId ? hrefId[1] : '');
    return {
      id,
      url: id ? `${location.origin}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}` : '',
      summary: stripSLA(cellText(row, map.summary)),
      company: stripSLA(cellText(row, map.company)),
      contact: stripSLA(cellText(row, map.contact)),
      status: cellText(row, map.status),
      resource: cellText(row, map.resource),
      priority: await readPriorityFromCell(cellByIndex(row, map.priority))
    };
  }

  async function requireBoardMap() {
    const maps = await getBoardMaps();
    const map = maps[boardKey()];
    if (map && map.ticket != null && map.summary != null) return map;
    toast('Board mapping needed');
    openBoardSetup();
    return null;
  }

  async function copyBoardShoutout(mode = 'tickets') {
    const map = await requireBoardMap();
    if (!map) return;
    const rows = boardRows();
    const tickets = await Promise.all(rows.map(r => ticketFromRow(r, map)));
    const unassigned = tickets.filter(t => !norm(t.resource));
    const responses = tickets.filter(t => /client has responded/i.test(t.status));
    const buckets = {};
    unassigned.forEach(t => { buckets[t.priority] = (buckets[t.priority] || 0) + 1; });
    const html = [];
    const text = [];
    html.push(`<strong>HD Board Health Update</strong>${unassigned.length ? ` (${unassigned.length} unassigned)` : ''}<br><br>`);
    text.push(`HD Board Health Update${unassigned.length ? ` (${unassigned.length} unassigned)` : ''}`, '');
    const priorities = ['P0', 'P1', 'P2', 'P3', 'P4', 'PM', 'Unknown'].filter(p => buckets[p]);
    if (priorities.length) {
      html.push('<table border="1" cellpadding="4" cellspacing="0"><thead><tr><th>Priority</th><th>Unassigned tickets</th></tr></thead><tbody>');
      text.push('Priority vs Unassigned');
      priorities.forEach(p => { html.push(`<tr><td>${esc(PRIORITY_LABELS[p] || p)}</td><td>${buckets[p]}</td></tr>`); text.push(`${PRIORITY_LABELS[p] || p}: ${buckets[p]}`); });
      html.push('</tbody></table>');
    }
    if (responses.length) {
      const counts = responses.reduce((acc, t) => { const key = norm(t.resource) || 'Unassigned'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
      html.push('<br><br><strong>Tickets with Responses</strong><br>');
      text.push('', 'Tickets with Responses');
      Object.keys(counts).sort((a, b) => a.localeCompare(b)).forEach(name => { html.push(`• ${esc(name)}, ${counts[name]}<br>`); text.push(`  • ${name}, ${counts[name]}`); });
    }
    if (mode !== 'overview') {
      const important = tickets.filter(t => mode === 'p0p2' ? /P[0-2]/.test(t.priority) : (/P[0-2]/.test(t.priority) || /client has responded/i.test(t.status) || !norm(t.resource))).slice(0, 40);
      if (important.length) {
        html.push('<br><br><strong>Tickets</strong><br>');
        text.push('', 'Tickets');
        important.forEach(t => {
          const label = t.id ? `#${t.id}` : '(no id)';
          html.push(`• ${t.url ? `<a href="${esc(t.url)}">${esc(label)}</a>` : esc(label)} ${esc([t.priority, t.status, t.company, t.summary].filter(Boolean).join(' - '))}<br>`);
          text.push(`  • ${label} ${[t.priority, t.status, t.company, t.summary, t.url].filter(Boolean).join(' - ')}`);
        });
      }
    }
    toast(await writeClipboard(html.join(''), text.join('\n')) ? 'Copied board shoutout' : 'Copy failed');
  }

  function ensureBoardTools() {
    if (!isBoard()) { removeEl(`${APP}-board-group`); return; }
    const mount = getViewInput()?.closest('.cw-toolbar-view-dropdown,td,div') || $('.cw_toolbar,.cw-main-toolbar') || document.body;
    const existing = $(`#${APP}-board-group`);
    if (existing && existing.parentElement === mount) return;
    if (existing) existing.remove();
    const g = makeGroup(`${APP}-board-group`, 'HD Board:');
    g.append(
      button(`${APP}-board-overview`, 'Health Update', 'Copy unassigned/response overview from mapped visible rows', () => copyBoardShoutout('overview')),
      button(`${APP}-board-tickets`, 'Shoutout', 'Copy overview plus notable mapped visible tickets', () => copyBoardShoutout('tickets'), 'secondary'),
      button(`${APP}-board-p0p2`, 'P0-P2', 'Copy only P0-P2 mapped visible tickets', () => copyBoardShoutout('p0p2'), 'warn'),
      button(`${APP}-board-setup`, 'Setup Mapping', 'Map columns for this Service Board view', openBoardSetup, 'secondary')
    );
    mount.appendChild(g);
  }

  // ---------- tab title ----------
  function normalizeTitle() {
    const id = getTicketId();
    if (id && isTicketContextLoose()) {
      const info = currentTicketInfo();
      const bits = [`#${id}`, info.summary, info.company].filter(Boolean);
      const next = bits.join(' - ');
      if (next && document.title !== next) document.title = next;
      return;
    }
    if (isTimeEntryContext()) {
      const next = id ? `#${id} - Time Entry` : 'Time Entry';
      if (document.title !== next) document.title = next;
      return;
    }
    if (isBoard()) {
      const view = readViewExact();
      if (view && view !== '(No View)' && document.title !== view) document.title = view;
    }
  }

  // ---------- SPA-safe engine ----------
  let tickQueued = false;
  let lastSig = '';
  function tick() {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(async () => {
      tickQueued = false;
      ensureStyles();
      const sig = pageContextSig();
      if (sig !== lastSig) {
        removeEl(`${APP}-ticket-group`);
        removeEl(`${APP}-time-group`);
        removeEl(`${APP}-board-group`);
        lastSig = sig;
      }
      normalizeTitle();
      ensureTicketTools();
      await ensureTimeEntryTools();
      ensureBoardTools();
    }, 120);
  }

  ensureStyles();
  tick();
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', tick);
  window.addEventListener('popstate', tick);
  ['pushState', 'replaceState'].forEach(key => {
    const orig = history[key];
    if (typeof orig !== 'function' || orig.__attToolkitWrapped) return;
    const wrapped = function () { const ret = orig.apply(this, arguments); queueMicrotask(tick); return ret; };
    wrapped.__attToolkitWrapped = true;
    history[key] = wrapped;
  });
  setInterval(tick, 2500);
})();
