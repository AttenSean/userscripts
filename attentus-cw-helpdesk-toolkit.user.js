// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1.4
// @description  Helpdesk toolkit for ConnectWise ticket triage. Confirms before DOM-only field changes and keeps clipboard draft fallback mode.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TICKET_GROUP_ID = 'att-hd-toolkit-ticket-group';
  const BOARD_GROUP_ID = 'att-hd-toolkit-board-group';
  const BOARD_MAPPING_STORAGE_KEY = 'att_cw_shoutout_settings_exact_views_json';
  const BOARD_ROW_SELECTOR = 'table.srboard-grid tr.cw-ml-row';
  const TIME_GROUP_ID = 'att-hd-toolkit-time-group';
  const LEGACY_TICKET_GROUP_ID = 'att-cw-helpdesk-toolkit-bar';
  const LEGACY_TIME_GROUP_ID = 'cw-notes-inline-copy-group';
  const BAR_ID = TICKET_GROUP_ID;
  const SLOT_ID = 'att-cw-helpdesk-toolkit-slot';
  const TRIAGE_MODE_STORAGE_KEY = 'att_hd_triage_mode';
  const SETTINGS_STORAGE_KEY = 'att_hd_toolkit_settings';
  const TRIAGE_MODES = new Set(['draftOnly', 'confirmApply']);
  const DEFAULT_TRIAGE_MODE = 'confirmApply';
  const DEFAULT_TOOLKIT_SETTINGS = {
    clipboard: {
      includeTicketLink: true,
      signatureName: '',
      signatureTemplate: '',
      reviewChecklist: ''
    },
    triage: {
      defaultMode: DEFAULT_TRIAGE_MODE
    },
    boardShoutouts: {
      mappingsText: ''
    },
    safety: {
      requireClearContactConfirmation: true,
      requireTriageApplyConfirmation: true,
      showPostApplySave: true,
      showPostApplySaveAndClose: true
    }
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const DEBUG = !!localStorage.getItem('attentus-debug');
  const log = (...args) => { if (DEBUG) console.log('[HelpdeskToolkit]', ...args); };


  function cloneDefaultSettings() {
    return JSON.parse(JSON.stringify(DEFAULT_TOOLKIT_SETTINGS));
  }

  function storageGet(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
    } catch {}
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : saved;
    } catch {}
    return fallback;
  }

  function storageSet(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        return true;
      }
    } catch {}
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {}
    return false;
  }

  function normalizeToolkitSettings(settings = {}) {
    const defaults = cloneDefaultSettings();
    const normalized = {
      clipboard: { ...defaults.clipboard, ...(settings.clipboard || {}) },
      triage: { ...defaults.triage, ...(settings.triage || {}) },
      boardShoutouts: { ...defaults.boardShoutouts, ...(settings.boardShoutouts || {}) },
      safety: { ...defaults.safety, ...(settings.safety || {}) }
    };
    if (!TRIAGE_MODES.has(normalized.triage.defaultMode)) normalized.triage.defaultMode = DEFAULT_TRIAGE_MODE;
    normalized.clipboard.includeTicketLink = !!normalized.clipboard.includeTicketLink;
    normalized.clipboard.signatureName = String(normalized.clipboard.signatureName || '');
    normalized.clipboard.signatureTemplate = String(normalized.clipboard.signatureTemplate || '');
    normalized.clipboard.reviewChecklist = String(normalized.clipboard.reviewChecklist || '');
    normalized.boardShoutouts.mappingsText = String(normalized.boardShoutouts.mappingsText || '');
    normalized.safety.requireClearContactConfirmation = normalized.safety.requireClearContactConfirmation !== false;
    normalized.safety.requireTriageApplyConfirmation = true;
    normalized.safety.showPostApplySave = true;
    normalized.safety.showPostApplySaveAndClose = true;
    return normalized;
  }

  function getToolkitSettings() {
    const saved = storageGet(SETTINGS_STORAGE_KEY, '');
    let parsed = {};
    if (saved) {
      try {
        parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      } catch {}
    }

    if (!parsed.triage?.defaultMode) {
      const legacyMode = storageGet(TRIAGE_MODE_STORAGE_KEY, '');
      if (TRIAGE_MODES.has(legacyMode)) parsed = { ...parsed, triage: { ...(parsed.triage || {}), defaultMode: legacyMode } };
    }

    return normalizeToolkitSettings(parsed);
  }

  function setToolkitSettings(settings) {
    const normalized = normalizeToolkitSettings(settings);
    storageSet(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    storageSet(TRIAGE_MODE_STORAGE_KEY, normalized.triage.defaultMode);
    updateTriageButtons();
    return normalized;
  }

  const TRIAGE_APPLY_TOOLTIP = [
    'Changes visible ConnectWise fields only after confirmation.',
    'Does not call ConnectWise or ITGlue APIs.',
    'Triage button clicks only apply fields to the browser UI; saving is offered only in the post-apply dialog.',
    'No click shortcut will automatically Save & Close.'
  ].join('\n');

  const TRIAGE_DRAFT_TOOLTIP = [
    'Copies a triage draft to the clipboard only.',
    'Does not change visible ConnectWise fields.',
    'Does not call ConnectWise or ITGlue APIs.'
  ].join('\n');

  const TRIAGE_WORKFLOWS = {
    spam: {
      buttonLabel: 'Spam/Phishing…',
      draftLabel: 'Copy Spam Draft',
      confirmationTitle: 'Confirm Spam/Phishing triage',
      fieldSummary: 'Classify the ticket as Spam/Phishing with Help Desk ownership, Tier 1 handling, Priority 4 urgency, and a normalized contact-aware summary.',
      mutations: [
        { field: 'board', value: 'Help Desk' },
        { field: 'status', value: 'MUST ASSIGN' },
        { field: 'type', value: 'Email' },
        { field: 'subtype', value: 'Spam/Phishing' },
        { field: 'tier', value: 'Tier 1' },
        { field: 'priority', value: 'Priority 4' },
        { field: 'summary', valueFrom: 'summaryTemplate' }
      ],
      summaryTemplate: ({ contact }) => `Spam/Phishing${contact ? ` (${contact})` : ''}`,
      postApplyMessage: 'Spam/Phishing fields applied'
    },
    junk: {
      buttonLabel: 'Junk…',
      draftLabel: 'Copy Junk Draft',
      confirmationTitle: 'Confirm Junk triage',
      fieldSummary: 'Move the ticket to the Junk board.',
      mutations: [
        { field: 'board', value: 'Junk' }
      ],
      postApplyMessage: 'Junk fields applied'
    },
    cancel: {
      buttonLabel: 'Closed/Cancelled…',
      draftLabel: 'Copy Cancel Draft',
      confirmationTitle: 'Confirm Closed/Cancelled triage',
      fieldSummary: 'Close/cancel the ticket and mark Ticket Tier? as N/A - Cancelled Ticket.',
      mutations: [
        { field: 'status', value: '>Closed/Cancelled' },
        { field: 'tier', value: 'N/A - Cancelled Ticket' }
      ],
      postApplyMessage: 'Closed/Cancelled fields applied'
    }
  };

  const TIME_ENTRY_CLIP_DEFAULTS = {
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

  const TIME_ENTRY_CLIP_KEYS = {
    name: 'att_clip_name',
    headline: 'att_clip_headline',
    prefix: 'att_clip_prefix',
    link: 'att_clip_link',
    suffix: 'att_clip_suffix',
    closing: 'att_clip_closing',
    spaced: 'att_clip_spaced',
    defloc: 'att_clip_defloc',
    random: 'att_clip_random'
  };

  const TIME_ENTRY_REVIEW_URLS = {
    tacoma: 'https://www.attentus.tech/tacoma_reviews',
    seattle: 'https://www.attentus.tech/seattle_reviews',
    bellevue: 'https://www.attentus.tech/bellevue_reviews',
    renton: 'https://www.attentus.tech/renton_reviews'
  };
  const TIME_ENTRY_LOCATIONS = Object.keys(TIME_ENTRY_REVIEW_URLS);
  const TIME_ENTRY_CLIP_GROUP_ID = TIME_GROUP_ID;
  const TIME_ENTRY_CLIP_ORIGIN = 'att-clipboard-bar';

  function ensureTimeEntryClipStyles() {
    if (!document.getElementById('att-clipbar-style')) {
      const s = document.createElement('style');
      s.id = 'att-clipbar-style';
      s.textContent = `
      #att-clipbar-row { display:inline-flex; align-items:center; gap:8px; vertical-align:middle; }
      #att-hd-toolkit-time-group, #cw-notes-inline-copy-group { display:inline-flex; flex-wrap:wrap; gap:6px; align-items:center; margin:8px 0; }
      #att-hd-toolkit-time-group .mm_button, #cw-notes-inline-copy-group .mm_button {
        display:inline-block !important; pointer-events:auto !important; opacity:1 !important; cursor:pointer !important;
        padding:4px 8px; border-radius:6px; border:1px solid rgba(0,0,0,.2); background:#2563eb; color:#fff; line-height:1.2; white-space:nowrap;
      }
      #att-hd-toolkit-time-group select, #cw-notes-inline-copy-group select { padding:4px 6px; border-radius:6px; }
    `;
      document.head.appendChild(s);
    }

    if (!document.getElementById('att-clipbar-spacer-style')) {
      const s = document.createElement('style');
      s.id = 'att-clipbar-spacer-style';
      s.textContent = `.att-action-spacer{display:inline-block;width:8px;height:1px}`;
      document.head.appendChild(s);
    }
  }

  function ensureTimeEntryAfterSiblingSpacer(node, px = 8) {
    if (!node || !node.parentElement) return null;
    const parent = node.parentElement;
    let sib = node.nextSibling;
    const isSpacer = el => el && el.nodeType === 1 && el.classList && el.classList.contains('att-action-spacer');
    if (!isSpacer(sib)) {
      const sp = document.createElement('span');
      sp.className = 'att-action-spacer';
      sp.style.display = 'inline-block';
      sp.style.width = `${px}px`;
      sp.style.height = '1px';
      parent.insertBefore(sp, node.nextSibling);
      sib = sp;
    }
    return sib;
  }

  const attClipEsc = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function attClipGet(key, defVal) {
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(key, defVal); } catch {}
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }

  async function attClipSet(key, value) {
    try { if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(key, value); } catch {}
    try { if (typeof GM_setValue === 'function') return GM_setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  async function attClipCopyRich(html, text) {
    try { if (typeof GM_setClipboard === 'function') GM_setClipboard(html, 'html'); } catch {}
    try { if (typeof GM === 'object' && GM?.setClipboard) GM.setClipboard(html, { type: 'text/html' }); } catch {}
    try { if (typeof GM === 'object' && GM?.setClipboard) GM.setClipboard(text, { type: 'text/plain' }); } catch {}

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const data = {
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' })
        };
        await navigator.clipboard.write([new ClipboardItem(data)]);
        return true;
      } catch {}
    }
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
    }
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

  function isTimeEntryTimesheetContext() {
    const crumbs = Array.from(document.querySelectorAll('.cw-main-banner .navigationEntry, .cw-main-banner .cw_CwLabel'))
      .map(e => (e.textContent || '').trim().toLowerCase());
    if (crumbs.some(t => t.includes('open time sheets') || t === 'time sheet')) return true;
    if (document.querySelector('.mytimesheetlist, .TimeSheet')) return true;
    return false;
  }

  function isTimeEntryTicketContext() {
    const search = location.search || '';
    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;
    if (document.querySelector('.pod_ticketSummary, .pod_ticketHeaderActions')) return true;
    if ($$('.cw_CwLabel,.gwt-Label,.mm_label').some(el => /service\s*ticket\s*#/i.test((el.textContent || '')))) return true;
    return false;
  }

  function findThreadPodHeaderByLabel(textNeedle) {
    const labels = document.querySelectorAll('.mm_podHeader [id$="-label"], .pod_unknown_header [id$="-label"]');
    const want = (textNeedle || '').toLowerCase();
    for (const el of labels) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text && text.includes(want)) return el;
    }
    return null;
  }

  function threadTimeEntryMountTarget() {
    const autoHeaderLabel = findThreadPodHeaderByLabel('thread: auto time entries');
    if (autoHeaderLabel) return autoHeaderLabel.closest('.mm_podHeader, .pod_unknown_header') || autoHeaderLabel;
    const hosted16Header = document.querySelector('.pod_hosted_16_header');
    if (hosted16Header) return hosted16Header;
    const hosted16Pod = document.querySelector('.pod_hosted_16');
    if (hosted16Pod) return hosted16Pod;
    return null;
  }

  function isTimeEntryDiscussionPodElement(el) {
    return !!el?.closest?.('.pod_service_ticket_discussion, .pod_hosted_15');
  }

  function findNotesTimestampButton() {
    const stamps = document.querySelectorAll('.cw_ToolbarButton_TimeStamp');
    for (const stamp of stamps) {
      if (isTimeEntryDiscussionPodElement(stamp)) continue;
      const row = stamp.closest('tr');
      const label = row && row.querySelector('.gwt-Label, .mm_label, .cw_CwLabel');
      if (label && /notes$/i.test((label.textContent || '').trim())) return stamp;
    }
    return null;
  }

  function signatureHTML(name, { spacedThankYou = false } = {}) {
    const n = attClipEsc(name);
    return [
      `<div style="margin:0;line-height:1.35">`,
      `<div style="margin:0">Thank you,</div>`,
      spacedThankYou ? `<div style="margin:0"><br></div>` : ``,
      `<div style="margin:0"><strong>${n}</strong></div>`,
      `<div style="margin:0">Attentus Technologies</div>`,
      `<div style="margin:0"><strong>Support:</strong> (253) 218-6015 x1</div>`,
      `<div style="margin:0">Call or Text Us: (253) 218-6015</div>`
    ].join('');
  }

  function signatureText(name, { spacedThankYou = false } = {}) {
    const lines = [
      'Thank you,',
      spacedThankYou ? '' : null,
      name,
      'Attentus Technologies',
      'Support: (253) 218-6015 x1',
      'Call or Text Us: (253) 218-6015'
    ].filter(v => v !== null);
    return lines.join('\n');
  }

  function pickRandomTimeEntryLocation() {
    return TIME_ENTRY_LOCATIONS[Math.floor(Math.random() * TIME_ENTRY_LOCATIONS.length)];
  }

  async function getTimeEntryReviewMsg(selectedLoc) {
    const headline = await attClipGet(TIME_ENTRY_CLIP_KEYS.headline, TIME_ENTRY_CLIP_DEFAULTS.headline);
    const prefix = await attClipGet(TIME_ENTRY_CLIP_KEYS.prefix, TIME_ENTRY_CLIP_DEFAULTS.prefix);
    const linkText = await attClipGet(TIME_ENTRY_CLIP_KEYS.link, TIME_ENTRY_CLIP_DEFAULTS.linkText);
    const suffix = await attClipGet(TIME_ENTRY_CLIP_KEYS.suffix, TIME_ENTRY_CLIP_DEFAULTS.suffix);
    const closing = await attClipGet(TIME_ENTRY_CLIP_KEYS.closing, TIME_ENTRY_CLIP_DEFAULTS.closing);
    const random = await attClipGet(TIME_ENTRY_CLIP_KEYS.random, TIME_ENTRY_CLIP_DEFAULTS.randomizeLocation);
    const defLoc = await attClipGet(TIME_ENTRY_CLIP_KEYS.defloc, TIME_ENTRY_CLIP_DEFAULTS.defaultLocation);
    const loc = random ? pickRandomTimeEntryLocation() : (selectedLoc || defLoc || TIME_ENTRY_CLIP_DEFAULTS.defaultLocation);
    const url = TIME_ENTRY_REVIEW_URLS[loc] || TIME_ENTRY_REVIEW_URLS.bellevue;
    const gap1 = /\s$/.test(prefix) ? '' : ' ';
    const gap2 = suffix && !/^\s/.test(suffix) ? ' ' : '';

    const html = [
      `<div style="margin:0;line-height:1.35">`,
      `<div style="margin:0"><strong>${attClipEsc(headline)}</strong></div>`,
      `<div style="margin:0">${attClipEsc(prefix)}${gap1}<a href="${url}" target="_blank" rel="noopener">${attClipEsc(linkText)}</a>${gap2}${attClipEsc(suffix || '')}</div>`,
      `<div style="margin:0">${attClipEsc(closing)}</div>`,
      `</div>`
    ].join('');

    const text = [
      headline,
      `${prefix}${gap1}${linkText}${gap2}${suffix || ''}`,
      closing
    ].join('\n');

    return { html, text };
  }

  async function buildTimeEntryClipChildren(intoWrap) {
    if (!intoWrap || intoWrap.dataset.ready === 'true') return;
    intoWrap.dataset.ready = 'true';

    const sel = document.createElement('select');
    sel.innerHTML = `
      <option value="bellevue">Bellevue</option>
      <option value="renton">Renton</option>
      <option value="seattle">Seattle</option>
      <option value="tacoma">Tacoma</option>
    `;
    sel.value = await attClipGet(TIME_ENTRY_CLIP_KEYS.defloc, TIME_ENTRY_CLIP_DEFAULTS.defaultLocation);

    const mkBtn = (label, title, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm_button';
      b.textContent = label;
      b.title = title;
      b.style.opacity = '1';
      b.style.pointerEvents = 'auto';
      b.style.cursor = 'pointer';
      b.addEventListener('click', async (event) => { event.preventDefault(); await onClick(event); });
      b.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          b.click();
        }
      });
      return b;
    };

    const copySignature = async () => {
      const name = await attClipGet(TIME_ENTRY_CLIP_KEYS.name, TIME_ENTRY_CLIP_DEFAULTS.name);
      const spaced = await attClipGet(TIME_ENTRY_CLIP_KEYS.spaced, TIME_ENTRY_CLIP_DEFAULTS.spacedThankYou);
      const html = signatureHTML(name, { spacedThankYou: spaced });
      await attClipCopyRich(html, signatureText(name, { spacedThankYou: spaced }));
      toast('Signature copied');
    };

    const copyReviewPlusSignature = async () => {
      const name = await attClipGet(TIME_ENTRY_CLIP_KEYS.name, TIME_ENTRY_CLIP_DEFAULTS.name);
      const spaced = await attClipGet(TIME_ENTRY_CLIP_KEYS.spaced, TIME_ENTRY_CLIP_DEFAULTS.spacedThankYou);
      const { html: reviewHTML, text: reviewText } = await getTimeEntryReviewMsg(sel.value);
      const sigHTML = signatureHTML(name, { spacedThankYou: spaced });
      const html = `${reviewHTML}<div><br></div>${sigHTML}`;
      const text = `${reviewText}\n\n${signatureText(name, { spacedThankYou: spaced })}`;
      await attClipCopyRich(html, text);
      toast('Review + signature copied');
    };

    const btnSettings = mkBtn('⚙', 'Open clipboard settings', () => showTimeEntryClipboardSettings());
    btnSettings.setAttribute('aria-label', 'Open clipboard settings');
    const btnSig = mkBtn('Copy signature', 'Copy signature', copySignature);
    const btnReview = mkBtn('Copy review + signature', 'Copy review message + signature', copyReviewPlusSignature);

    Object.assign(intoWrap.style, { display: 'inline-flex', gap: '6px', alignItems: 'center' });
    intoWrap.append(sel, btnSettings, btnSig, btnReview);

    sel.addEventListener('change', async () => {
      await attClipSet(TIME_ENTRY_CLIP_KEYS.defloc, sel.value);
      toast(`Default location: ${sel.value}`);
    });
  }

  function mountTimeEntryClipGroup(nextToStamp) {
    const existing = document.getElementById(TIME_ENTRY_CLIP_GROUP_ID) || document.getElementById(LEGACY_TIME_GROUP_ID);
    if (existing) {
      if (existing.previousElementSibling === nextToStamp || existing.parentElement?.previousElementSibling === nextToStamp) return true;
      if (existing.dataset?.origin === TIME_ENTRY_CLIP_ORIGIN) existing.remove();
    }

    const row = document.createElement('span');
    row.id = 'att-clipbar-row';
    row.dataset.origin = TIME_ENTRY_CLIP_ORIGIN;
    Object.assign(row.style, { display: 'inline-flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', verticalAlign: 'middle' });

    const wrap = document.createElement('span');
    wrap.id = TIME_ENTRY_CLIP_GROUP_ID;
    wrap.dataset.origin = TIME_ENTRY_CLIP_ORIGIN;
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'nowrap', margin: '0' });

    const td = nextToStamp.closest('td');
    if (td) td.style.whiteSpace = 'nowrap';

    nextToStamp.style.display = 'inline-block';
    nextToStamp.insertAdjacentElement('beforebegin', row);
    row.appendChild(nextToStamp);
    row.appendChild(wrap);

    buildTimeEntryClipChildren(wrap);
    ensureTimeEntryAfterSiblingSpacer(row, 8);
    return true;
  }

  async function mountTimeEntryClipGroupUnderThread(targetEl) {
    if (isTimeEntryDiscussionPodElement(targetEl)) return false;

    const existing = document.getElementById(TIME_ENTRY_CLIP_GROUP_ID) || document.getElementById(LEGACY_TIME_GROUP_ID);
    if (existing && (existing.previousElementSibling === targetEl || existing.nextElementSibling === targetEl)) return true;
    if (existing && existing.dataset && existing.dataset.origin === TIME_ENTRY_CLIP_ORIGIN) existing.remove();

    const strip = document.createElement('div');
    strip.id = TIME_ENTRY_CLIP_GROUP_ID;
    strip.dataset.origin = TIME_ENTRY_CLIP_ORIGIN;

    if (targetEl.matches?.('.mm_podHeader, .pod_unknown_header')) {
      targetEl.insertAdjacentElement('afterend', strip);
    } else if (targetEl.matches?.('.pod_hosted_16')) {
      targetEl.insertAdjacentElement('afterbegin', strip);
    } else {
      targetEl.insertAdjacentElement('afterend', strip);
    }

    await buildTimeEntryClipChildren(strip);
    return true;
  }

  function closeTimeEntryModal(el) { el?.remove(); }

  async function showTimeEntryClipboardSettings() {
    const name = await attClipGet(TIME_ENTRY_CLIP_KEYS.name, TIME_ENTRY_CLIP_DEFAULTS.name);
    const headline = await attClipGet(TIME_ENTRY_CLIP_KEYS.headline, TIME_ENTRY_CLIP_DEFAULTS.headline);
    const prefix = await attClipGet(TIME_ENTRY_CLIP_KEYS.prefix, TIME_ENTRY_CLIP_DEFAULTS.prefix);
    const linkText = await attClipGet(TIME_ENTRY_CLIP_KEYS.link, TIME_ENTRY_CLIP_DEFAULTS.linkText);
    const suffix = await attClipGet(TIME_ENTRY_CLIP_KEYS.suffix, TIME_ENTRY_CLIP_DEFAULTS.suffix);
    const closing = await attClipGet(TIME_ENTRY_CLIP_KEYS.closing, TIME_ENTRY_CLIP_DEFAULTS.closing);
    const spaced = await attClipGet(TIME_ENTRY_CLIP_KEYS.spaced, TIME_ENTRY_CLIP_DEFAULTS.spacedThankYou);
    const defLoc = await attClipGet(TIME_ENTRY_CLIP_KEYS.defloc, TIME_ENTRY_CLIP_DEFAULTS.defaultLocation);
    const random = await attClipGet(TIME_ENTRY_CLIP_KEYS.random, TIME_ENTRY_CLIP_DEFAULTS.randomizeLocation);

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 2147483646,
      display: 'grid', placeItems: 'center', font: '13px system-ui,Segoe UI,Roboto,Arial,sans-serif'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#0b1220', color: '#fff', border: '1px solid rgba(255,255,255,.18)',
      borderRadius: '12px', width: 'min(560px, 96%)', padding: '14px', boxShadow: '0 10px 30px rgba(0,0,0,.35)'
    });
    card.innerHTML = `
      <h3 style="margin:0 0 8px 0; display:flex; justify-content:space-between; align-items:center">
        Clipboard Settings
        <button id="att-clip-close" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">✕</button>
      </h3>
      <div style="display:grid; grid-template-columns: 1fr 2fr; gap:8px">
        <label>Name</label><input id="att-clip-name" value="${attClipEsc(name)}">
        <label>Headline</label><input id="att-clip-headline" value="${attClipEsc(headline)}">
        <label>Prefix</label><input id="att-clip-prefix" value="${attClipEsc(prefix)}">
        <label>Link Text</label><input id="att-clip-link" value="${attClipEsc(linkText)}">
        <label>Suffix</label><input id="att-clip-suffix" value="${attClipEsc(suffix)}">
        <label>Closing</label><input id="att-clip-closing" value="${attClipEsc(closing)}">
        <label>Spaced “Thank you”</label><input id="att-clip-spaced" type="checkbox" ${spaced ? 'checked' : ''}>
        <label>Default Location</label>
        <select id="att-clip-defloc">
          <option value="bellevue">Bellevue</option>
          <option value="renton">Renton</option>
          <option value="seattle">Seattle</option>
          <option value="tacoma">Tacoma</option>
        </select>
        <label>Randomize review location</label><input id="att-clip-random" type="checkbox" ${random ? 'checked' : ''}>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px">
        <button id="att-clip-cancel" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">Close</button>
        <button id="att-clip-save" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">Save</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('att-clip-defloc').value = defLoc;
    document.getElementById('att-clip-close').onclick = document.getElementById('att-clip-cancel').onclick = () => closeTimeEntryModal(overlay);
    document.getElementById('att-clip-save').onclick = async () => {
      const get = id => document.getElementById(id);
      await attClipSet(TIME_ENTRY_CLIP_KEYS.name, get('att-clip-name').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.headline, get('att-clip-headline').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.prefix, get('att-clip-prefix').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.link, get('att-clip-link').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.suffix, get('att-clip-suffix').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.closing, get('att-clip-closing').value.trim());
      await attClipSet(TIME_ENTRY_CLIP_KEYS.spaced, get('att-clip-spaced').checked);
      await attClipSet(TIME_ENTRY_CLIP_KEYS.defloc, get('att-clip-defloc').value || TIME_ENTRY_CLIP_DEFAULTS.defaultLocation);
      await attClipSet(TIME_ENTRY_CLIP_KEYS.random, get('att-clip-random').checked);
      toast('Settings saved');
      closeTimeEntryModal(overlay);
    };
  }

  function removeTimeEntryClipGroupIfAny() {
    for (const id of [TIME_ENTRY_CLIP_GROUP_ID, LEGACY_TIME_GROUP_ID]) {
      const ex = document.getElementById(id);
      if (ex && ex.dataset && ex.dataset.origin === TIME_ENTRY_CLIP_ORIGIN && ex.parentNode) ex.parentNode.removeChild(ex);
    }
    const row = document.getElementById('att-clipbar-row');
    if (row?.dataset?.origin === TIME_ENTRY_CLIP_ORIGIN && row.parentNode) {
      const stamp = row.querySelector('.cw_ToolbarButton_TimeStamp');
      if (stamp) row.insertAdjacentElement('beforebegin', stamp);
      row.remove();
    }
  }

  async function ensureTimeEntryClipboard() {
    ensureTimeEntryClipStyles();
    if (isTimeEntryTimesheetContext()) {
      removeTimeEntryClipGroupIfAny();
      return false;
    }
    const stamp = findNotesTimestampButton();
    if (stamp) return mountTimeEntryClipGroup(stamp);
    if (isTimeEntryTicketContext()) {
      const target = threadTimeEntryMountTarget();
      if (target && await mountTimeEntryClipGroupUnderThread(target)) return true;
    }
    removeTimeEntryClipGroupIfAny();
    return false;
  }

  async function until(fn, { tries = 60, delay = 60 } = {}) {
    for (let i = 0; i < tries; i++) {
      const value = fn();
      if (value) return value;
      await sleep(delay);
    }
    return null;
  }

  function toast(message, ms = 1400) {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: 2147483646,
      background: '#111827',
      color: '#fff',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,.25)',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    document.body.appendChild(node);
    setTimeout(() => node.remove(), ms);
  }

  function openChevronFor(input) {
    const wrapper = input?.closest('div, td, .pod-element-row') || input?.parentElement;
    const chevron = wrapper?.querySelector('.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]');
    if (visible(chevron)) {
      chevron.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      chevron.click();
      chevron.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    return true;
  }

  async function openPopupAndGetContainer(input) {
    const popupSelectors = [
      '.GMDB3DUBPDJ.GMDB3DUBGFJ',
      '.k-animation-container',
      '.k-popup',
      '.select2-container--open',
      '[data-popup-open="true"]',
      '.x-layer',
      '.x-menu-floating',
      '.x-combo-list'
    ];
    const before = new Set(popupSelectors.flatMap(selector => $$(selector)).filter(visible));

    openChevronFor(input);
    await sleep(35);

    return await until(() => {
      const after = popupSelectors.flatMap(selector => $$(selector)).filter(visible);
      return after.find(el => !before.has(el)) || after.slice(-1)[0] || null;
    }, { tries: 12, delay: 35 });
  }

  function findClickableOption(container, desiredValue) {
    if (!container) return null;
    const target = norm(desiredValue);
    const candidates = [
      ...$$('[role="option"]', container),
      ...$$('.k-list-item, .k-item, .select2-results__option, li', container),
      ...$$('div, span', container)
    ].filter(el => visible(el) && (el.textContent || '').trim());

    return candidates.find(el => norm(el.textContent) === target)
      || candidates.find(el => norm(el.textContent).startsWith(target))
      || candidates.find(el => norm(el.textContent).includes(target))
      || null;
  }

  async function clickEl(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(22);
  }

  function dispatchInput(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
  }

  function commitBlur(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.blur();
  }


  function dispatchAll(input) {
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setDomInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    dispatchAll(input);
  }

  const CONTACT_CLEAR_GROUPS = [
    {
      label: 'Contact',
      selectors: [
        'input.cw_contact',
        'input[aria-label="Contact"]',
        'input[id*="Contact"][role="combobox"]'
      ]
    },
    {
      label: 'Contact RecID',
      selectors: [
        'input[name="ContactRecID"]',
        'input[id="ContactRecID"]',
        'input[id$="ContactRecID"]'
      ]
    },
    {
      label: 'Email',
      selectors: [
        'input.cw_emailAddress',
        'input[aria-label="Email"]',
        'input[name="EmailAddress"]'
      ]
    },
    {
      label: 'Phone',
      selectors: [
        'input[aria-label="Phone"]',
        'input[name="PhoneNumber"]',
        'input[name*="Phone" i]'
      ]
    },
    {
      label: 'Extension',
      selectors: [
        'input[aria-label*="Ext"]',
        'input[name*="Ext" i]',
        'input[id*="Ext" i]'
      ]
    },
    {
      label: 'Contact phone communications input',
      selectors: [],
      roots: ['.cw_contactPhoneCommunications'],
      rootInputSelector: 'input'
    }
  ];

  const contactSnapshotsByTicket = new Map();

  function describeInput(input) {
    return input.getAttribute('aria-label')
      || input.getAttribute('name')
      || input.id
      || input.className
      || input.type
      || 'input';
  }

  function getContactClearInputs() {
    const seen = new Set();
    const entries = [];

    const addInput = (input, groupLabel) => {
      if (!input || !('value' in input) || seen.has(input)) return;
      seen.add(input);
      entries.push({ input, groupLabel, label: `${groupLabel} (${describeInput(input)})` });
    };

    for (const group of CONTACT_CLEAR_GROUPS) {
      for (const selector of group.selectors || []) {
        $$(selector).forEach(input => addInput(input, group.label));
      }
      for (const rootSelector of group.roots || []) {
        $$(rootSelector).forEach(root => {
          $$(group.rootInputSelector || 'input', root).forEach(input => addInput(input, group.label));
        });
      }
    }

    return entries;
  }

  function snapshotContactInfo(entries = getContactClearInputs()) {
    const ticketId = getTicketId();
    const snapshot = {
      ticketId,
      createdAt: Date.now(),
      entries: entries.map(entry => ({
        ...entry,
        value: String(entry.input.value || ''),
        found: true
      }))
    };

    if (ticketId) contactSnapshotsByTicket.set(ticketId, snapshot);
    return snapshot;
  }

  function buildContactClearPlan(entries = getContactClearInputs()) {
    return entries.map(entry => ({
      ...entry,
      found: true,
      currentValue: String(entry.input.value || ''),
      value: '(blank)'
    }));
  }

  function clearContactInfo(snapshot = snapshotContactInfo()) {
    let didSomething = false;

    for (const entry of snapshot.entries || []) {
      const input = entry.input;
      if (!input || !('value' in input)) continue;
      if (String(input.value || '') !== '') didSomething = true;
      setDomInputValue(input, '');
    }

    if (!didSomething) toast('Contact, email, and phone fields were already blank');
    return didSomething;
  }

  async function revertContactInfo(snapshot) {
    const activeTicketId = getTicketId();
    const savedSnapshot = snapshot || (activeTicketId ? contactSnapshotsByTicket.get(activeTicketId) : null);
    if (!savedSnapshot) {
      toast('No captured contact values found for this ticket');
      return false;
    }
    if (activeTicketId && savedSnapshot.ticketId && savedSnapshot.ticketId !== activeTicketId) {
      toast('Contact revert stopped: active ticket changed');
      return false;
    }

    for (const entry of savedSnapshot.entries || []) {
      const input = entry.input;
      if (!input || !('value' in input) || !input.isConnected) {
        toast(`${entry.label || entry.groupLabel || 'Contact field'} not found for revert`);
        return false;
      }
      setDomInputValue(input, entry.value || '');
      await sleep(20);
    }
    return true;
  }

  function showPostClearContactDialog(plan, snapshot) {
    showActionDialog('Contact fields cleared', {
      message: 'Contact, Contact RecID, email, phone, extension, and contact-phone communication fields were cleared in the visible ConnectWise UI only. Nothing has been saved and no ConnectWise or ITGlue APIs were called.',
      fields: plan,
      actions: [
        {
          label: 'Revert',
          primary: true,
          onClick: async () => {
            const ok = await revertContactInfo(snapshot);
            toast(ok ? 'Contact values reverted' : 'Contact revert stopped');
          }
        },
        { label: 'Leave Unsaved', onClick: () => toast('Cleared values left unsaved') }
      ]
    });
  }

  function confirmAndClearContactInfo() {
    if (!isCanonicalServiceTicketPage()) {
      toast('Clear Contact is available only on canonical Service Ticket pages');
      return false;
    }

    const entries = getContactClearInputs();
    if (!entries.length) {
      toast('No contact fields found to clear');
      return false;
    }

    const plan = buildContactClearPlan(entries);
    showActionDialog('Confirm Clear Contact', {
      message: 'Review the target field values below. No fields will be cleared until you click Clear Fields. This uses only visible UI/DOM events; no ConnectWise or ITGlue APIs are called, and nothing is saved automatically.',
      fields: plan,
      actions: [
        { label: 'Cancel', onClick: () => toast('Clear Contact cancelled') },
        {
          label: 'Clear Fields',
          primary: true,
          onClick: () => {
            const snapshot = snapshotContactInfo(entries);
            const clearPlan = buildContactClearPlan(snapshot.entries || entries);
            clearContactInfo(snapshot);
            toast('Contact fields cleared');
            showPostClearContactDialog(clearPlan, snapshot);
          }
        }
      ]
    });
    return true;
  }

  async function commitComboOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (norm(input.value) === norm(desiredValue)) return true;

    const popup = await openPopupAndGetContainer(input);
    const option = popup && findClickableOption(popup, desiredValue);
    if (option) {
      await clickEl(option);
      commitBlur(input);
      await sleep(60);
      return norm(input.value) === norm(desiredValue);
    }

    input.focus();
    dispatchInput(input, '');
    dispatchInput(input, String(desiredValue));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    if (norm(input.value) === norm(desiredValue)) return true;

    await openPopupAndGetContainer(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(45);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    return norm(input.value) === norm(desiredValue);
  }

  async function commitTextOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (String(input.value || '') === String(desiredValue)) return true;

    input.focus();
    dispatchInput(input, String(desiredValue));
    commitBlur(input);
    await sleep(60);
    return String(input.value || '') === String(desiredValue);
  }

  function labelText(el) {
    return norm((el?.textContent || '').replace(/[:?]\s*$/, ''));
  }

  function findUdfInputByLabel(labelTextToFind) {
    const needle = norm(String(labelTextToFind).replace(/[:?]\s*$/, ''));
    const rows = $$('.pod-element-row').filter(visible);

    for (const row of rows) {
      const label = $('.mm_label, .cw_CwLabel, [id$="-label"], label, .gwt-Label', row);
      const text = labelText(label);
      if (text && text === needle) {
        const input = row.querySelector('input.cw_PsaUserDefinedComboBox, input.GMDB3DUBKVH, input:not([type="hidden"]), textarea');
        if (visible(input)) return input;
      }
    }

    return null;
  }

  function findInputByLabel(labelTextToFind) {
    const needle = norm(String(labelTextToFind).replace(/[:?]\s*$/, ''));
    const rows = $$('.pod-element-row, tr, .cw_CwFormRow, .form-group, .x-form-item, .GMDB3DUBHGH');

    for (const row of rows) {
      if (!visible(row)) continue;
      const label = $('.mm_label, .cw_CwLabel, label, [id$="-label"], .gwt-Label', row);
      if (labelText(label) === needle) {
        const input = $('input:not([type="hidden"]), textarea', row);
        if (visible(input)) return input;
      }
    }

    const labels = $$('.mm_label, .cw_CwLabel, label, [id$="-label"], .gwt-Label').filter(visible);
    for (const label of labels) {
      if (labelText(label) !== needle) continue;
      const row = label.closest('.pod-element-row, tr, .cw_CwFormRow, .form-group, .x-form-item, .GMDB3DUBHGH') || label.parentElement;
      const input = row && $('input:not([type="hidden"]), textarea', row);
      if (visible(input)) return input;
    }

    return null;
  }

  function findInputBySelectors(selectors) {
    for (const selector of selectors) {
      const input = $(selector);
      if (visible(input)) return input;
    }
    return null;
  }

  function findSummaryInput() {
    return findInputBySelectors([
      'input.cw_summary',
      'input[name*="summary" i]',
      'textarea[name*="summary" i]'
    ]) || findInputByLabel('Summary');
  }

  function findContactName() {
    const input = findInputBySelectors(['input.cw_contactName', 'input.cw_contact', 'input[name*="contact" i]']) || findInputByLabel('Contact');
    return (input?.value || '').trim();
  }

  function getTicketIdFromHeader() {
    const header = $('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header');
    if (!header || !visible(header)) return '';

    const label = document.getElementById(`${header.id}-label`) || header.nextElementSibling || header;
    const scanNodes = [label, header, header.parentElement, header.parentElement?.nextElementSibling].filter(Boolean);
    for (const node of scanNodes) {
      const match = String(node.textContent || '').match(/\b(?:service\s+)?ticket\s*#\s*(\d{3,})\b/i);
      if (match) return match[1];
    }
    return '';
  }

  function getTicketIdFromUrl() {
    try {
      const url = new URL(location.href);
      const params = url.searchParams;
      const id = params.get('service_recid') || params.get('srRecID') || params.get('serviceTicketId') || params.get('recid');
      if (id && /^\d{3,}$/.test(id)) return id;

      const match = url.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{3,})/i);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  function getTicketId() {
    return getTicketIdFromHeader() || getTicketIdFromUrl();
  }

  const TRIAGE_FIELD_RESOLVERS = {
    board: { label: 'Board', type: 'combo', find: () => findInputBySelectors(['input.cw_serviceBoard']) || findInputByLabel('Board') },
    status: { label: 'Status', type: 'combo', find: () => findInputBySelectors(['input.cw_status']) || findInputByLabel('Status') },
    type: { label: 'Type', type: 'combo', find: () => findInputBySelectors(['input.cw_type']) || findInputByLabel('Type') },
    subtype: { label: 'Subtype', type: 'combo', find: () => findInputBySelectors(['input.cw_subType']) || findInputByLabel('Sub-Type') || findInputByLabel('Subtype') },
    tier: { label: 'Ticket Tier?', type: 'combo', find: () => findUdfInputByLabel('Ticket Tier?') || findInputByLabel('Ticket Tier?') || findInputByLabel('Item/Tier') },
    priority: { label: 'Priority', type: 'combo', find: () => findInputBySelectors(['input.cw_priority']) || findInputByLabel('Priority') },
    summary: { label: 'Summary', type: 'text', find: findSummaryInput }
  };

  function getTriageWorkflow(kind) {
    const key = norm(kind || '').replace(/[^a-z]/g, '');
    if (key === 'closedcancelled' || key === 'closed' || key === 'cancelled') return TRIAGE_WORKFLOWS.cancel;
    if (key === 'spamphishing' || key === 'phishing') return TRIAGE_WORKFLOWS.spam;
    return TRIAGE_WORKFLOWS[key] || null;
  }

  function getTriageMode() {
    return getToolkitSettings().triage.defaultMode;
  }

  function setTriageMode(mode) {
    const settings = getToolkitSettings();
    settings.triage.defaultMode = TRIAGE_MODES.has(mode) ? mode : DEFAULT_TRIAGE_MODE;
    return setToolkitSettings(settings).triage.defaultMode;
  }

  function isDraftOnlyMode() {
    return false;
  }

  function getTriageButtonLabel(workflow) {
    return workflow.buttonLabel;
  }

  function getTriageButtonTooltip() {
    return TRIAGE_APPLY_TOOLTIP;
  }

  function handleTriageButton(kind) {
    if (isDraftOnlyMode()) return copyTriage(kind);
    if (!isCanonicalServiceTicketPage()) {
      toast('Apply triage is available only on canonical Service Ticket pages');
      return false;
    }
    return confirmAndApplyTriage(kind);
  }

  function resolveMutationValue(workflow, mutation) {
    if (mutation.valueFrom === 'summaryTemplate') {
      return workflow.summaryTemplate?.({ contact: findContactName() }) || '';
    }
    return typeof mutation.value === 'function' ? mutation.value() : mutation.value;
  }

  function buildFieldPlan(workflow) {
    return workflow.mutations.map(mutation => {
      const field = TRIAGE_FIELD_RESOLVERS[mutation.field];
      const input = field?.find?.() || null;
      const value = resolveMutationValue(workflow, mutation);
      return {
        ...field,
        ...mutation,
        label: mutation.label || field?.label || mutation.field,
        type: mutation.type || field?.type || 'combo',
        input,
        value,
        currentValue: input ? (input.value || '').trim() : '',
        found: !!input
      };
    });
  }

  function displayFieldValue(value) {
    const text = String(value || '').trim();
    return text || '(blank)';
  }

  function fieldValueChanged(before, after) {
    return displayFieldValue(before) !== displayFieldValue(after);
  }

  function describePlan(plan) {
    return plan.map(item => `${item.label}: ${displayFieldValue(item.currentValue)} → ${displayFieldValue(item.value)}`).join('\n');
  }

  function parseBoardShoutoutMappings(mappingsText) {
    const mappings = new Map();
    for (const line of String(mappingsText || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(.+?)(?:\s*=>\s*|\s*=\s*|\s*:\s*)(.+)$/);
      if (!match) continue;
      mappings.set(norm(match[1]), match[2].trim());
    }
    return mappings;
  }

  function getBoardShoutout(boardName, settings = getToolkitSettings()) {
    const mappings = parseBoardShoutoutMappings(settings.boardShoutouts.mappingsText);
    return mappings.get(norm(boardName)) || '';
  }

  function buildTriageDraft(workflow, plan) {
    const settings = getToolkitSettings();
    const lines = [workflow.fieldSummary, '', 'Fields:', describePlan(plan)];
    const boardItem = plan.find(item => item.field === 'board');
    const shoutout = getBoardShoutout(boardItem?.value || boardItem?.currentValue || '', settings);

    if (shoutout) lines.push('', `Board shoutout: ${shoutout}`);
    if (settings.clipboard.includeTicketLink) lines.push('', `Ticket link: ${location.href}`);
    if (settings.clipboard.reviewChecklist) lines.push('', 'Review checklist:', settings.clipboard.reviewChecklist);
    if (settings.clipboard.signatureTemplate) lines.push('', settings.clipboard.signatureTemplate);
    else if (settings.clipboard.signatureName) lines.push('', settings.clipboard.signatureName);

    return lines.join('\n');
  }



  function stripBoardInvisibleText(value) {
    return String(value || '')
      .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getBoardViewInput() {
    return $('.cw-toolbar-view-dropdown input.cw_CwComboBox')
      || $('.cw-toolbar-view-dropdown [id$="-input"].cw_CwComboBox')
      || $('.cw-toolbar-view-dropdown input[type="text"]');
  }

  function getBoardViewExact() {
    const input = getBoardViewInput();
    const value = input && typeof input.value === 'string' ? input.value.trim() : '';
    return value || '(No View)';
  }

  function getBoardViewCanonical() {
    return stripBoardInvisibleText(getBoardViewExact());
  }

  function getBoardMappingContext() {
    const host = location.host.toLowerCase();
    const exactView = getBoardViewExact();
    const canonicalView = getBoardViewCanonical();
    return {
      host,
      exactView,
      canonicalView,
      exactKey: `${host}::${exactView}`,
      canonicalKey: `${host}::${canonicalView}`
    };
  }

  function getBoardMappingKeys() {
    const context = getBoardMappingContext();
    return [context.exactKey, context.canonicalKey];
  }

  function parseBoardMappingsStore(raw) {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try { return JSON.parse(raw || '{}') || {}; } catch { return {}; }
    }
    return raw && typeof raw === 'object' ? raw : {};
  }

  async function getBoardColumnMappings() {
    try {
      const raw = await gmGet(BOARD_MAPPING_STORAGE_KEY, '{}');
      return parseBoardMappingsStore(raw);
    } catch {}
    return parseBoardMappingsStore(storageGet(BOARD_MAPPING_STORAGE_KEY, '{}'));
  }

  async function setBoardColumnMappings(mappings) {
    const json = JSON.stringify(mappings || {});
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(BOARD_MAPPING_STORAGE_KEY, json);
        return;
      }
    } catch {}
    try {
      if (typeof GM !== 'undefined' && GM.setValue) {
        await GM.setValue(BOARD_MAPPING_STORAGE_KEY, json);
        return;
      }
    } catch {}
    storageSet(BOARD_MAPPING_STORAGE_KEY, json);
  }

  function isUsableBoardColumnMapping(mapping) {
    return !!mapping && ['ticket', 'priority', 'summary', 'company', 'contact'].every(key => Number.isInteger(Number(mapping[key])));
  }

  async function getCurrentBoardColumnMapping() {
    const mappings = await getBoardColumnMappings();
    const { exactKey, canonicalKey } = getBoardMappingContext();
    return mappings[exactKey] || mappings[canonicalKey] || null;
  }

  function firstSavedBoardMapping(mappings) {
    return Object.keys(mappings || {}).map(key => mappings[key]).find(mapping => isUsableBoardColumnMapping(mapping)) || null;
  }

  function getVisibleBoardRows() {
    return $$(BOARD_ROW_SELECTOR).filter(row => visible(row));
  }

  function getBoardCell(row, index) {
    return Number.isInteger(Number(index)) ? row.querySelector(`td[cellindex="${Number(index)}"]`) : null;
  }

  function getBoardCellText(row, index) {
    const cell = getBoardCell(row, index);
    if (!cell) return '';
    const target = cell.querySelector('a') || cell.querySelector('div') || cell;
    return stripBoardInvisibleText(target.textContent || '');
  }

  function getBoardHeaderCells() {
    const headers = new Map();
    $$('.cw-ml-header *[cellindex], .x-grid3-hd-row *[cellindex], .x-grid3-header *[cellindex]').forEach(cell => {
      const index = Number(cell.getAttribute('cellindex'));
      if (!Number.isInteger(index)) return;
      const label = stripBoardInvisibleText(cell.textContent || '').toLowerCase();
      if (label) headers.set(index, label);
    });
    return headers;
  }

  function getBoardSampleCells() {
    const row = getVisibleBoardRows()[0];
    const samples = new Map();
    if (!row) return samples;
    $$('td[cellindex]', row).forEach(cell => {
      const index = Number(cell.getAttribute('cellindex'));
      if (!Number.isInteger(index)) return;
      const target = cell.querySelector('a') || cell.querySelector('div') || cell;
      samples.set(index, stripBoardInvisibleText(target.textContent || ''));
    });
    return samples;
  }

  function guessBoardColumn(pattern, fallback = null) {
    let found = fallback;
    getBoardHeaderCells().forEach((label, index) => {
      if (found == null && pattern.test(label)) found = index;
    });
    return found;
  }

  function detectBoardTicketColumnIndex() {
    const headerGuess = guessBoardColumn(/ticket/i, null);
    if (headerGuess != null) return headerGuess;

    const counts = {};
    getVisibleBoardRows().slice(0, 8).forEach(row => {
      $$('td[cellindex]', row).forEach(cell => {
        const linkText = stripBoardInvisibleText(cell.querySelector('a')?.textContent || '');
        if (!/^\d{5,}$/.test(linkText)) return;
        const index = Number(cell.getAttribute('cellindex'));
        if (Number.isInteger(index)) counts[index] = (counts[index] || 0) + 1;
      });
    });

    return Object.entries(counts).reduce((best, [index, count]) => {
      if (count < 2) return best;
      if (!best || count > best.count) return { index: Number(index), count };
      return best;
    }, null)?.index ?? null;
  }

  function buildBoardColumnOptions(select, selectedIndex) {
    const headers = getBoardHeaderCells();
    const samples = getBoardSampleCells();
    const indexes = new Set([...headers.keys(), ...samples.keys()]);
    select.textContent = '';
    [...indexes].sort((a, b) => a - b).forEach(index => {
      const option = document.createElement('option');
      const header = headers.get(index) || '(no header)';
      const sample = samples.get(index) || '';
      option.value = String(index);
      option.textContent = `#${index} - ${header}${sample ? ` • ${sample.slice(0, 60)}` : ''}`;
      option.selected = Number(selectedIndex) === index;
      select.appendChild(option);
    });
  }

  function guessBoardMapping(existing = {}) {
    return {
      ticket: Number.isInteger(Number(existing.ticket)) ? Number(existing.ticket) : detectBoardTicketColumnIndex() ?? guessBoardColumn(/ticket|#/i, 0),
      priority: Number.isInteger(Number(existing.priority)) ? Number(existing.priority) : guessBoardColumn(/priority|prio/i, 1),
      summary: Number.isInteger(Number(existing.summary)) ? Number(existing.summary) : guessBoardColumn(/summary|description/i, 2),
      company: Number.isInteger(Number(existing.company)) ? Number(existing.company) : guessBoardColumn(/company/i, 3),
      contact: Number.isInteger(Number(existing.contact)) ? Number(existing.contact) : guessBoardColumn(/contact/i, 4)
    };
  }

  function getSmartBoardMappingSeed(mappings, context) {
    const existing = mappings[context.exactKey] || mappings[context.canonicalKey];
    if (existing) return existing;

    const ticketIndex = detectBoardTicketColumnIndex();
    const candidate = firstSavedBoardMapping(mappings);
    if (candidate && ticketIndex != null && Number(candidate.ticket) === Number(ticketIndex)) return candidate;
    return {};
  }

  function readBoardMappingFromForm(card, fields) {
    const mapping = {};
    fields.forEach(([key]) => { mapping[key] = Number($(`#att-hd-board-map-${key}`, card)?.value); });
    return mapping;
  }

  function buildBoardShoutoutPreview(mapping) {
    const row = getVisibleBoardRows()[0];
    if (!row) return 'No rows to preview.';
    const ticket = getBoardCellText(row, mapping.ticket);
    const priority = getBoardCellText(row, mapping.priority);
    const summary = getBoardCellText(row, mapping.summary).replace(/\b(?:Respond by|Plan by|Waiting|Scheduled|SLA)[^|-]*$/i, '').trim();
    const company = getBoardCellText(row, mapping.company);
    const contact = getBoardCellText(row, mapping.contact);
    const meta = [company, contact].filter(Boolean).join(' - ');
    const url = ticket ? `${location.origin}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(ticket)}` : '';
    return `${boardPriorityDot(priority)} #${ticket || '(ticket?)'} ${summary || '(summary?)'}${meta ? `\nㅤ ${meta}` : ''}${url ? `\n${url}` : ''}`;
  }

  async function showBoardMappingSetup({ requireConfirmation = false, message = '' } = {}) {
    const mappings = await getBoardColumnMappings();
    const context = getBoardMappingContext();
    const { exactKey, canonicalKey } = context;
    const existing = getSmartBoardMappingSeed(mappings, context);
    const guessed = guessBoardMapping(existing);

    return new Promise(resolve => {
      $(`#att-hd-toolkit-board-mapping-overlay`)?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'att-hd-toolkit-board-mapping-overlay';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: 2147483645, background: 'rgba(17,24,39,.35)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end', padding: '72px 16px 16px'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      width: '460px', background: '#fff', color: '#111827', border: '1px solid #D1D5DB', borderRadius: '12px',
      boxShadow: '0 18px 45px rgba(0,0,0,.25)', padding: '14px', font: '13px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });

    const title = document.createElement('h2');
    title.textContent = requireConfirmation ? 'Confirm Service Board Column Mapping' : 'Service Board Column Mapping';
    Object.assign(title.style, { margin: '0 0 4px', fontSize: '16px' });
    const help = document.createElement('p');
    help.textContent = message || `Map columns for the current Service Board view: ${context.exactView}. These settings are local and copying is clipboard-only.`;
    Object.assign(help.style, { margin: '0 0 12px', color: '#4B5563' });

    const form = document.createElement('div');
    Object.assign(form.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' });
    const fields = [
      ['ticket', 'Ticket # column'],
      ['priority', 'Priority column'],
      ['summary', 'Summary column'],
      ['company', 'Company column'],
      ['contact', 'Contact column']
    ];
    fields.forEach(([key, labelText]) => {
      const label = document.createElement('label');
      label.textContent = labelText;
      Object.assign(label.style, { display: 'grid', gap: '4px', fontWeight: 600 });
      const select = document.createElement('select');
      select.id = `att-hd-board-map-${key}`;
      Object.assign(select.style, { padding: '6px', border: '1px solid #D1D5DB', borderRadius: '8px' });
      buildBoardColumnOptions(select, guessed[key]);
      label.appendChild(select);
      form.appendChild(label);
    });

    const previewLabel = document.createElement('label');
    previewLabel.textContent = 'Preview';
    Object.assign(previewLabel.style, { display: 'grid', gap: '4px', fontWeight: 600, marginTop: '12px' });
    const preview = document.createElement('textarea');
    preview.readOnly = true;
    Object.assign(preview.style, { minHeight: '86px', resize: 'vertical', padding: '8px', border: '1px solid #D1D5DB', borderRadius: '8px', font: '12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace' });
    previewLabel.appendChild(preview);

    const refreshPreview = () => {
      preview.value = buildBoardShoutoutPreview(readBoardMappingFromForm(card, fields));
    };
    fields.forEach(([key]) => $(`#att-hd-board-map-${key}`, card)?.addEventListener('change', refreshPreview));

    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '14px' });
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = requireConfirmation ? 'Save & Copy' : 'Save Mapping';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Use Once';
    [close, confirm, save].forEach(button => Object.assign(button.style, { borderRadius: '8px', border: '1px solid #D1D5DB', padding: '7px 12px', cursor: 'pointer' }));
    Object.assign(save.style, { background: '#111827', color: '#fff', borderColor: '#111827' });
    close.addEventListener('click', () => { overlay.remove(); resolve(null); });
    confirm.addEventListener('click', () => {
      const mapping = readBoardMappingFromForm(card, fields);
      overlay.remove();
      resolve(isUsableBoardColumnMapping(mapping) ? mapping : null);
    });
    save.addEventListener('click', async () => {
      const mapping = readBoardMappingFromForm(card, fields);
      mappings[exactKey] = mapping;
      if (canonicalKey !== exactKey) mappings[canonicalKey] = mapping;
      await setBoardColumnMappings(mappings);
      overlay.remove();
      toast('Board column mapping saved');
      refreshToolkitContext('board-mapping-saved');
      resolve(isUsableBoardColumnMapping(mapping) ? mapping : null);
    });
    actions.append(close);
    if (requireConfirmation) actions.append(confirm);
    actions.append(save);
    card.append(title, help, form, previewLabel, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
      refreshPreview();
    });
  }

  function boardPriorityDot(priority) {
    const normalized = String(priority || '').toUpperCase().match(/P[0-4]/)?.[0] || 'P4';
    return ({ P0: '🔴', P1: '🟠', P2: '🟡', P3: '🟢', P4: '⚪' })[normalized] || '⚪';
  }

  async function prepareBoardShoutoutMapping() {
    const context = getBoardMappingContext();
    const mappings = await getBoardColumnMappings();
    const mapping = mappings[context.exactKey] || mappings[context.canonicalKey] || null;
    if (isUsableBoardColumnMapping(mapping)) return mapping;

    toast('Confirm column mapping before copying', 1800);
    return showBoardMappingSetup({
      requireConfirmation: true,
      message: `No saved mapping was found for ${context.host} / ${context.exactView}. Review the smart-detected columns below, then use once or save before copying.`
    });
  }

  async function copyBoardShoutout(mapping) {
    if (!isUsableBoardColumnMapping(mapping)) {
      toast('Board copy canceled; no confirmed mapping');
      return false;
    }
    const rows = getVisibleBoardRows();
    const items = rows.map(row => {
      const ticket = getBoardCellText(row, mapping.ticket);
      if (!/^\d{5,}$/.test(ticket)) return null;
      const priority = getBoardCellText(row, mapping.priority);
      const summary = getBoardCellText(row, mapping.summary).replace(/\b(?:Respond by|Plan by|Waiting|Scheduled|SLA)[^|-]*$/i, '').trim();
      const company = getBoardCellText(row, mapping.company);
      const contact = getBoardCellText(row, mapping.contact);
      const url = `${location.origin}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(ticket)}`;
      return { ticket, priority, summary, company, contact, url };
    }).filter(Boolean);

    const lines = [`Tickets needing attention (${items.length})`, ''];
    items.forEach((item, index) => {
      lines.push(`${boardPriorityDot(item.priority)} #${item.ticket} ${item.summary} (${item.url})`);
      const meta = [item.company, item.contact].filter(Boolean).join(' - ');
      if (meta) lines.push(`ㅤ ${meta}`);
      if (index !== items.length - 1) lines.push('');
    });
    const ok = await copyText(lines.join('\n'));
    toast(ok ? `Copied ${items.length} board ${items.length === 1 ? 'entry' : 'entries'}` : 'Board copy failed');
    return ok;
  }

  function findBoardToolbarCanvas() {
    return $('.x-panel-toolbar .GMDB3DUBHYI .GMDB3DUBALJ')
      || $('.GMDB3DUBHYI .GMDB3DUBALJ')
      || $('.x-panel-toolbar')
      || $('.cw-toolbar-view-dropdown')?.parentElement
      || null;
  }

  function positionBoardGroup(group) {
    const canvas = findBoardToolbarCanvas();
    if (!canvas || !group) return;
    const anchor = canvas.querySelector('.cw-toolbar-search') || canvas.querySelector('.cw-toolbar-actions') || canvas.querySelector('.cw-toolbar-clear');
    let left = 8;
    if (anchor) {
      const anchorLeft = parseInt(anchor.style.left || '0', 10) || 0;
      const anchorWidth = anchor.getBoundingClientRect?.().width || 64;
      left = Math.max(0, anchorLeft + anchorWidth + 8);
    }
    Object.assign(group.style, { position: 'absolute', top: '3px', left: `${left}px`, zIndex: '2' });
  }

  async function mountBoardTools() {
    if (!isBoard()) {
      document.getElementById(BOARD_GROUP_ID)?.remove();
      return false;
    }
    const desiredMode = 'copy-with-mapping-gate';
    const existing = document.getElementById(BOARD_GROUP_ID);
    if (existing && existing.dataset.mode === desiredMode) {
      positionBoardGroup(existing);
      return true;
    }
    existing?.remove();

    const canvas = findBoardToolbarCanvas();
    if (!canvas) return false;
    const group = document.createElement('div');
    group.id = BOARD_GROUP_ID;
    group.dataset.mode = desiredMode;
    Object.assign(group.style, { display: 'inline-flex', gap: '6px', alignItems: 'center' });

    group.appendChild(makeActionButton('att-hd-toolkit-board-copy-btn', 'Teams Shoutout', 'Copy a Service Board shoutout to the clipboard. Shift+Click opens mapping setup.', async (event) => {
      if (event?.shiftKey) return showBoardMappingSetup();
      const currentMapping = await prepareBoardShoutoutMapping();
      return currentMapping ? copyBoardShoutout(currentMapping) : false;
    }));

    canvas.appendChild(group);
    positionBoardGroup(group);
    return true;
  }

  const fieldSnapshotsByTicket = new Map();

  function uniqueWorkflowMutations(workflow) {
    const seen = new Set();
    return (workflow?.mutations || []).filter(mutation => {
      const fieldKey = mutation.field;
      if (seen.has(fieldKey)) return false;
      seen.add(fieldKey);
      return true;
    });
  }

  function snapshotFields(workflow) {
    const ticketId = getTicketId();
    if (!ticketId) {
      toast('Ticket # not found; fields were not changed');
      return null;
    }

    const snapshot = {
      ticketId,
      workflow: workflow?.buttonLabel || '',
      createdAt: Date.now(),
      fields: {},
      entries: []
    };

    for (const mutation of uniqueWorkflowMutations(workflow)) {
      const resolver = TRIAGE_FIELD_RESOLVERS[mutation.field];
      const label = mutation.label || resolver?.label || mutation.field;
      const input = resolver?.find?.() || null;
      const entry = {
        field: mutation.field,
        label,
        type: mutation.type || resolver?.type || 'combo',
        value: input ? (input.value || '').trim() : '',
        found: !!input
      };
      snapshot.fields[label] = entry;
      snapshot.entries.push(entry);
    }

    fieldSnapshotsByTicket.set(ticketId, snapshot);
    return snapshot;
  }

  async function copyText(text) {
    try {
      if (window.GM?.setClipboard) {
        await window.GM.setClipboard(text, 'text');
        return true;
      }
    } catch {}
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    return false;
  }

  async function copyTriage(kind) {
    const workflow = getTriageWorkflow(kind);
    if (!workflow) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(workflow);
    const draft = buildTriageDraft(workflow, plan);
    const ok = await copyText(draft);
    toast(ok ? `${workflow.draftLabel || workflow.buttonLabel} copied` : 'Could not copy draft');
    return ok;
  }

  async function applyFieldChanges(workflow, ticketInfo = {}) {
    const snapshot = snapshotFields(workflow);
    if (!snapshot) return { ok: false, snapshot: null, plan: [] };

    if (ticketInfo && typeof ticketInfo === 'object') {
      ticketInfo.ticketId = snapshot.ticketId;
      ticketInfo.snapshot = snapshot;
    }

    const plan = buildFieldPlan(workflow);
    for (const item of plan) {
      const input = item.input || item.find?.();
      if (!input) {
        toast(`${item.label} field not found`);
        return { ok: false, snapshot, plan };
      }
      const ok = item.type === 'text'
        ? await commitTextOnElement(input, item.value)
        : await commitComboOnElement(input, item.value);
      if (!ok) {
        toast(`Could not set ${item.label}`);
        return { ok: false, snapshot, plan };
      }
    }
    return {
      ok: true,
      snapshot,
      plan: plan.filter(item => fieldValueChanged(item.currentValue, item.value))
    };
  }

  function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  }

  function findToolbarButton(cls) {
    const el = $('.' + cls);
    return visible(el) ? el : null;
  }

  function clickSave() {
    return clickLikeUser(findToolbarButton('cw_ToolbarButton_Save'));
  }

  function clickSaveAndClose() {
    return clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose'));
  }

  async function clearField(input) {
    input.focus();
    dispatchInput(input, '');
    commitBlur(input);
    await sleep(60);
    return String(input.value || '') === '';
  }

  async function revertFieldChanges(snapshot) {
    const activeTicketId = getTicketId();
    const savedSnapshot = snapshot || (activeTicketId ? fieldSnapshotsByTicket.get(activeTicketId) : null);
    if (!savedSnapshot) {
      toast('No captured field values found for this ticket');
      return false;
    }
    if (activeTicketId && savedSnapshot.ticketId !== activeTicketId) {
      toast('Revert stopped: active ticket changed');
      return false;
    }

    for (const item of savedSnapshot.entries || []) {
      const resolver = TRIAGE_FIELD_RESOLVERS[item.field];
      const input = resolver?.find?.() || null;
      if (!input) {
        toast(`${item.label} field not found for revert`);
        return false;
      }

      const previousValue = item.value || '';
      const ok = previousValue
        ? (item.type === 'text'
          ? await commitTextOnElement(input, previousValue)
          : await commitComboOnElement(input, previousValue))
        : await clearField(input);
      if (!ok) {
        toast(`Could not revert ${item.label}`);
        return false;
      }
    }
    return true;
  }

  function eventHasModifier(event) {
    return !!(event?.shiftKey || event?.ctrlKey || event?.metaKey || event?.altKey);
  }

  function showPostApplyDialog(workflow, plan, snapshot) {
    const changedFields = plan.length ? plan : [{ label: 'No field values changed', currentValue: '', value: '', found: true, unchanged: true }];
    const actions = [
      {
        label: 'Revert',
        onClick: async () => {
          const ok = await revertFieldChanges(snapshot);
          toast(ok ? 'Triage changes reverted' : 'Triage revert stopped');
        }
      },
      { label: 'Leave Unsaved', onClick: () => toast('Changes left unsaved') }
    ];

    actions.push({
      label: 'Save',
      primary: true,
      onClick: async () => {
        await sleep(120);
        if (!clickSave()) toast('Save button not found');
      }
    });

    actions.push({
      label: 'Save & Close',
      onClick: async (event) => {
        if (eventHasModifier(event)) {
          toast('Use a plain Save & Close button click; modifier-key Save & Close is not supported');
          return;
        }
        await sleep(120);
        if (!clickSaveAndClose()) toast('Save & Close button not found');
      }
    });

    showActionDialog(workflow.postApplyMessage || `${workflow.buttonLabel} fields applied`, {
      message: 'The changed fields below are currently unsaved in the browser UI. Choose Revert to restore the captured pre-triage values, Leave Unsaved to keep editing without saving, or explicitly choose Save or Save & Close.',
      fields: changedFields,
      actions
    });
  }

  function showActionDialog(title, { message, fields = [], actions = [] }) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.38)',
      zIndex: 2147483645,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff',
      borderRadius: '12px',
      minWidth: '420px',
      maxWidth: '680px',
      padding: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      color: '#111827'
    });

    const heading = document.createElement('div');
    heading.textContent = title;
    Object.assign(heading.style, { fontSize: '16px', fontWeight: 700, marginBottom: '8px' });

    const intro = document.createElement('p');
    intro.textContent = message || '';
    Object.assign(intro.style, { margin: '0 0 10px', lineHeight: 1.4, color: '#374151' });

    const list = document.createElement('ul');
    Object.assign(list.style, { margin: '0 0 14px 20px', padding: 0, lineHeight: 1.5 });
    for (const field of fields) {
      const item = document.createElement('li');
      item.textContent = field.unchanged
        ? field.label
        : field.found
          ? `${field.label}: ${displayFieldValue(field.currentValue)} → ${displayFieldValue(field.value)}`
          : `${field.label}: field not found; intended value → ${displayFieldValue(field.value)}`;
      list.appendChild(item);
    }

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

    function makeButton(label, action, primary = false) {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, {
        borderRadius: '10px',
        padding: '8px 12px',
        cursor: 'pointer',
        border: '1px solid',
        fontWeight: 600,
        background: primary ? '#111827' : '#fff',
        color: primary ? '#fff' : '#111827',
        borderColor: primary ? '#111827' : '#D1D5DB'
      });
      button.addEventListener('click', async (event) => {
        button.disabled = true;
        try {
          await action?.(event);
        } finally {
          overlay.remove();
        }
      });
      return button;
    }

    actions.forEach(action => row.appendChild(makeButton(action.label, action.onClick, action.primary)));
    card.append(heading, intro, list, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function confirmAndApplyTriage(kind) {
    if (isProjectTicket()) {
      toast('Field-mutating triage is not available on Project Tickets');
      return false;
    }

    const workflow = getTriageWorkflow(kind);
    if (!workflow) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(workflow);
    showActionDialog(workflow.confirmationTitle, {
      message: `${workflow.fieldSummary} Review the exact field changes below. No ConnectWise fields will change until you choose Apply Fields. This uses only visible UI/DOM automation; Copy Draft Only copies this field plan to the clipboard.`,
      fields: plan,
      actions: [
        {
          label: 'Apply Fields',
          primary: true,
          onClick: async () => {
            const ticketInfo = {};
            const result = await applyFieldChanges(workflow, ticketInfo);
            if (result.ok) {
              toast(workflow.postApplyMessage || `${workflow.buttonLabel} fields applied`);
              showPostApplyDialog(workflow, result.plan, result.snapshot);
            } else {
              toast(`${workflow.buttonLabel} apply stopped`);
            }
          }
        },
        { label: 'Copy Draft Only', onClick: () => copyTriage(kind) },
        { label: 'Cancel', onClick: () => toast('Triage cancelled') }
      ]
    });
    return true;
  }


  // ---------- Ticket context gates ----------

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

  // Optional debug-only signal. This is intentionally not part of the strict gate
  // because ConnectWise contact-label markup varies across layouts.
  function hasContactLabelLoose() {
    if (document.querySelector('.cw_contact.contact.label')) return true;

    const labels = document.querySelectorAll('.mm_label, .cw_CwLabel, .gwt-Label');
    return Array.from(labels).some(el => {
      const text = norm(el.textContent).replace(/[:?]\s*$/, '');
      return text === 'contact';
    });
  }

  function isProjectTicket() {
    const textIncludes = (selector, needle) => $$(selector).some(el => visible(el) && norm(el.textContent).includes(norm(needle)));
    return textIncludes('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Board')
      || textIncludes('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Ticket')
      || visible($('input.cw_projectBoard'))
      || visible($('.cw_project'));
  }

  function isTicketContextLoose() {
    const project = isProjectTicket();
    const hasTicketPod = !!findTicketPodRoot();
    const hasTicketId = !!getTicketId();
    const hasTicketUrl = /[?&](service_recid|srrecid|serviceticketid|recid)=\d{3,}/i.test(location.search || '')
      || /(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/\d{3,}/i.test(location.pathname || '');
    const hasTicketLabel = $$('.cw_CwLabel,.gwt-Label,.mm_label').some(el => /service\s*ticket\s*#/i.test((el.textContent || '')));
    const ok = !project && (hasTicketPod || hasTicketId || hasTicketUrl || hasTicketLabel);

    if (DEBUG) log('isTicketContextLoose', { project, hasTicketPod, hasTicketId, hasTicketUrl, hasTicketLabel, ok });
    return ok;
  }

  function isCanonicalServiceTicketPage() {
    const project = isProjectTicket();
    const nav = hasServiceTicketNavLabel();
    const age = hasAgeLabel();
    const contactLabel = hasContactLabelLoose();
    const ok = !project && nav && age;

    if (DEBUG) log('isCanonicalServiceTicketPage', { project, nav, age, contactLabel, ok });
    return ok;
  }

  function findTicketPodRoot() {
    return $('.pod_service_ticket_ticket')
      || $('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBLGH')
      || null;
  }

  function findHeaderBlock(podRoot) {
    return podRoot?.querySelector('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBHGH') || null;
  }

  const FIELD_MUTATING_TOOL_IDS = [
    'att-cw-helpdesk-spam-btn',
    'att-cw-helpdesk-junk-btn',
    'att-cw-helpdesk-cancel-btn',
    'att-cw-helpdesk-clear-contact-btn'
  ];

  function removeFieldMutatingControls(root = document) {
    FIELD_MUTATING_TOOL_IDS.forEach(id => root.querySelector(`#${id}`)?.remove());
  }

  function canShowFieldMutatingControls() {
    return !isProjectTicket() && isCanonicalServiceTicketPage();
  }

  function makeActionButton(id, text, title, handler) {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = id;
    outer.dataset.origin = 'attentus';
    outer.title = title;
    Object.assign(outer.style, { display: 'inline-block', verticalAlign: 'middle', whiteSpace: 'nowrap' });

    const button = document.createElement('div');
    button.className = 'GMDB3DUBIOG mm_button';
    button.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = text;

    inner.appendChild(label);
    button.appendChild(inner);
    outer.appendChild(button);

    const act = (event) => {
      event.preventDefault();
      handler(event);
    };
    outer.addEventListener('click', act);
    outer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') act(event);
    });
    return outer;
  }

  function updateTriageButtons() {
    const buttons = [
      ['att-cw-helpdesk-spam-btn', TRIAGE_WORKFLOWS.spam],
      ['att-cw-helpdesk-junk-btn', TRIAGE_WORKFLOWS.junk],
      ['att-cw-helpdesk-cancel-btn', TRIAGE_WORKFLOWS.cancel]
    ];

    for (const [id, workflow] of buttons) {
      const button = document.getElementById(id);
      if (!button) continue;
      const label = $('.GMDB3DUBBPG', button);
      if (label) label.textContent = getTriageButtonLabel(workflow);
      button.title = getTriageButtonTooltip();
    }
  }

  function showToolkitSettingsDialog() {
    const settings = getToolkitSettings();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.38)',
      zIndex: 2147483645,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '18px'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff',
      borderRadius: '12px',
      width: 'min(760px, calc(100vw - 36px))',
      maxHeight: 'calc(100vh - 36px)',
      overflow: 'auto',
      padding: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      color: '#111827'
    });

    const heading = document.createElement('div');
    heading.textContent = 'Helpdesk Toolkit Settings';
    Object.assign(heading.style, { fontSize: '16px', fontWeight: 700, marginBottom: '8px' });

    const intro = document.createElement('p');
    intro.textContent = `Settings are stored locally as ${SETTINGS_STORAGE_KEY} with GM_getValue/GM_setValue when available, then localStorage fallback. API access remains read-only; apply mode changes only visible ConnectWise UI fields.`;
    Object.assign(intro.style, { margin: '0 0 12px', lineHeight: 1.4, color: '#374151' });

    const form = document.createElement('div');
    Object.assign(form.style, { display: 'grid', gap: '12px', marginBottom: '14px' });

    function makeSection(title, description) {
      const section = document.createElement('section');
      Object.assign(section.style, {
        border: '1px solid #D1D5DB',
        borderRadius: '12px',
        padding: '12px',
        display: 'grid',
        gap: '10px'
      });
      const sectionHeading = document.createElement('div');
      sectionHeading.textContent = title;
      Object.assign(sectionHeading.style, { fontWeight: 700, fontSize: '14px' });
      section.appendChild(sectionHeading);
      if (description) {
        const desc = document.createElement('p');
        desc.textContent = description;
        Object.assign(desc.style, { margin: '-4px 0 0', color: '#4B5563', lineHeight: 1.4 });
        section.appendChild(desc);
      }
      return section;
    }

    function makeTextInput(id, labelText, value, placeholder = '') {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'grid', gap: '4px' });
      const labelTitle = document.createElement('span');
      labelTitle.textContent = labelText;
      Object.assign(labelTitle.style, { fontWeight: 600 });
      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = value || '';
      input.placeholder = placeholder;
      Object.assign(input.style, { border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px' });
      label.append(labelTitle, input);
      return label;
    }

    function makeTextarea(id, labelText, value, placeholder = '') {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'grid', gap: '4px' });
      const labelTitle = document.createElement('span');
      labelTitle.textContent = labelText;
      Object.assign(labelTitle.style, { fontWeight: 600 });
      const input = document.createElement('textarea');
      input.id = id;
      input.value = value || '';
      input.placeholder = placeholder;
      input.rows = 4;
      Object.assign(input.style, { border: '1px solid #D1D5DB', borderRadius: '8px', padding: '8px', resize: 'vertical' });
      label.append(labelTitle, input);
      return label;
    }

    function makeCheckbox(id, labelText, checked, help = '') {
      const label = document.createElement('label');
      Object.assign(label.style, { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px', alignItems: 'start' });
      const input = document.createElement('input');
      input.id = id;
      input.type = 'checkbox';
      input.checked = !!checked;
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = labelText;
      text.appendChild(strong);
      if (help) {
        const desc = document.createElement('span');
        desc.textContent = help;
        Object.assign(desc.style, { display: 'block', color: '#4B5563', fontWeight: 400, marginTop: '2px' });
        text.appendChild(desc);
      }
      label.append(input, text);
      return label;
    }

    function makeModeRadio(value, titleText, description) {
      const label = document.createElement('label');
      Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '8px',
        alignItems: 'start',
        padding: '10px',
        border: '1px solid #D1D5DB',
        borderRadius: '10px',
        cursor: 'pointer'
      });
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'att-cw-triage-mode';
      input.value = value;
      input.checked = settings.triage.defaultMode === value;
      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = titleText;
      const desc = document.createElement('span');
      desc.textContent = description;
      Object.assign(desc.style, { display: 'block', color: '#4B5563', marginTop: '2px' });
      text.append(title, desc);
      label.append(input, text);
      return label;
    }

    const clipboardSection = makeSection(
      'Clipboard, signature, and review settings',
      'Stored templates for local clipboard drafts, signatures, and review prompts. These settings do not call external APIs.'
    );
    clipboardSection.append(
      makeCheckbox('att-cw-settings-include-link', 'Include ticket link in clipboard drafts', settings.clipboard.includeTicketLink),
      makeTextInput('att-cw-settings-signature-name', 'Signature name', settings.clipboard.signatureName, 'Your name or team signature'),
      makeTextarea('att-cw-settings-signature-template', 'Signature template', settings.clipboard.signatureTemplate, 'Example: Regards,\nHelp Desk'),
      makeTextarea('att-cw-settings-review-checklist', 'Review checklist', settings.clipboard.reviewChecklist, 'Items to check before saving or closing a ticket')
    );

    const triageSection = makeSection(
      'Triage settings',
      'Choose the default behavior for Spam/Phish, Junk, and Cancel triage buttons.'
    );
    triageSection.append(
      makeModeRadio('draftOnly', 'Copy Draft Only', 'Triage buttons copy drafts to the clipboard only and do not change fields.'),
      makeModeRadio('confirmApply', 'Apply Fields After Confirmation', 'Triage buttons apply fields through visible UI automation after the configured confirmation step.')
    );

    const boardSection = makeSection(
      'Board shoutout mappings',
      'Map ConnectWise board names to shoutout text for local reference. Use one mapping per line, such as “Help Desk = @helpdesk”.'
    );
    boardSection.append(
      makeTextarea('att-cw-settings-board-mappings', 'Mappings', settings.boardShoutouts.mappingsText, 'Help Desk = @helpdesk\nJunk = @triage')
    );

    const safetySection = makeSection(
      'Safety settings',
      'Triage always uses a two-stage confirmation flow: Apply Fields / Copy Draft Only / Cancel before mutation, then Revert / Leave Unsaved / Save / Save & Close after mutation. API endpoints remain read-only; no ConnectWise or ITGlue data is modified through APIs.'
    );
    safetySection.append(
      makeCheckbox('att-cw-settings-confirm-clear-contact', 'Require confirmation before Clear Contact', settings.safety.requireClearContactConfirmation, 'Stored for Clear Contact actions; no Clear Contact button is added by this settings dialog.')
    );

    form.append(clipboardSection, triageSection, boardSection, safetySection);

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

    function makeButton(label, action, primary = false) {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, {
        borderRadius: '10px',
        padding: '8px 12px',
        cursor: 'pointer',
        border: '1px solid',
        fontWeight: 600,
        background: primary ? '#111827' : '#fff',
        color: primary ? '#fff' : '#111827',
        borderColor: primary ? '#111827' : '#D1D5DB'
      });
      button.addEventListener('click', async (event) => {
        button.disabled = true;
        try {
          await action?.(event);
        } finally {
          overlay.remove();
        }
      });
      return button;
    }

    row.append(
      makeButton('Cancel', () => {}),
      makeButton('Save Settings', () => {
        const saved = setToolkitSettings({
          clipboard: {
            includeTicketLink: $('#att-cw-settings-include-link', form)?.checked,
            signatureName: $('#att-cw-settings-signature-name', form)?.value || '',
            signatureTemplate: $('#att-cw-settings-signature-template', form)?.value || '',
            reviewChecklist: $('#att-cw-settings-review-checklist', form)?.value || ''
          },
          triage: {
            defaultMode: $('input[name="att-cw-triage-mode"]:checked', form)?.value || DEFAULT_TRIAGE_MODE
          },
          boardShoutouts: {
            mappingsText: $('#att-cw-settings-board-mappings', form)?.value || ''
          },
          safety: {
            requireClearContactConfirmation: $('#att-cw-settings-confirm-clear-contact', form)?.checked,
            requireTriageApplyConfirmation: true,
            showPostApplySave: true,
            showPostApplySaveAndClose: true
          }
        });
        toast(`Toolkit settings saved; triage mode is ${saved.triage.defaultMode}`);
      }, true)
    );

    card.append(heading, intro, form, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function mountTicketTools() {
    const bar = document.createElement('div');
    bar.id = BAR_ID;
    Object.assign(bar.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 0 8px 0',
      flexWrap: 'wrap',
      position: 'relative',
      zIndex: '0',
      marginLeft: '8px'
    });

    const label = document.createElement('span');
    label.textContent = 'Helpdesk Toolkit:';
    Object.assign(label.style, {
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      fontWeight: 600,
      color: '#374151',
      userSelect: 'none'
    });

    const showFieldMutatingControls = canShowFieldMutatingControls();
    const slot = document.createElement('div');
    slot.id = SLOT_ID;
    slot.dataset.fieldMutatingControls = showFieldMutatingControls ? 'true' : 'false';
    Object.assign(slot.style, { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });

    if (showFieldMutatingControls) {
      slot.append(
        makeActionButton('att-cw-helpdesk-spam-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.spam), getTriageButtonTooltip(), () => handleTriageButton('spam')),
        makeActionButton('att-cw-helpdesk-junk-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.junk), getTriageButtonTooltip(), () => handleTriageButton('junk')),
        makeActionButton('att-cw-helpdesk-cancel-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.cancel), getTriageButtonTooltip(), () => handleTriageButton('cancel')),
        makeActionButton('att-cw-helpdesk-clear-contact-btn', 'Clear Contact', 'Clear visible contact, email, phone, and extension fields after confirmation. Does not call ConnectWise or ITGlue APIs.', () => confirmAndClearContactInfo())
      );
    }

    slot.append(
      makeActionButton('att-cw-helpdesk-settings-btn', 'Settings…', `Configure ${TRIAGE_MODE_STORAGE_KEY}`, () => showToolkitSettingsDialog())
    );
    if (titleController.isActive) {
      slot.appendChild(makeActionButton(TITLE_SETTINGS_BUTTON_ID, 'Title Settings…', 'Configure tab title normalization', () => titleController.openSettings()));
    }

    bar.append(label, slot);
    return bar;
  }

  function ensureBarPlaced() {
    const existingBar = $(`#${BAR_ID}`);

    if (isProjectTicket()) {
      if (existingBar) {
        removeFieldMutatingControls(existingBar);
        existingBar.remove();
      }
      return false;
    }

    if (!isTicketContextLoose()) {
      existingBar?.remove();
      return false;
    }

    const showFieldMutatingControls = canShowFieldMutatingControls();
    const existingSlot = $(`#${SLOT_ID}`);
    if (existingSlot) {
      if (existingSlot.dataset.fieldMutatingControls === (showFieldMutatingControls ? 'true' : 'false')) {
        if (!showFieldMutatingControls) removeFieldMutatingControls(existingSlot);
        return true;
      }
      existingBar?.remove();
    }

    const pod = findTicketPodRoot();
    const header = pod && findHeaderBlock(pod);
    if (!header) return false;
    header.insertAdjacentElement('afterend', mountTicketTools());
    return true;
  }


  // -------------------- Tab title normalization --------------------
  // Folded in from attentus-cw-tab-title-normalize.user.js with toolkit-specific
  // IDs and a shared guard so the standalone script and toolkit do not both run
  // title observers during the transition.
  const TITLE_ENGINE_GUARD = '__attentusCwTabTitleNormalizeActive';
  const TITLE_ENGINE_DATA_ATTR = 'attCwTitleNormalizeOwner';
  const TITLE_ENGINE_OWNER = 'helpdesk-toolkit';
  const TITLE_SETTINGS_BUTTON_ID = 'att-cw-helpdesk-title-settings-btn';
  const TITLE_SETTINGS_OVERLAY_ID = 'att-cw-helpdesk-title-settings-overlay';
  const TITLE_K_COMPANY = 'att_tab_title_add_company';
  const TITLE_K_SB_RENAME = 'att_tab_title_rename_serviceboard';
  const TITLE_K_TE_TICKET = 'att_tab_title_timeentry_ticket';
  const TITLE_DEFAULTS = {
    [TITLE_K_COMPANY]: true,
    [TITLE_K_SB_RENAME]: true,
    [TITLE_K_TE_TICKET]: true
  };

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

  function claimTitleEngine() {
    const active = window[TITLE_ENGINE_GUARD];
    const domOwner = document.documentElement?.dataset?.[TITLE_ENGINE_DATA_ATTR] || '';
    if ((active?.owner && active.owner !== TITLE_ENGINE_OWNER) || (domOwner && domOwner !== TITLE_ENGINE_OWNER)) return false;
    if (active?.owner === TITLE_ENGINE_OWNER || domOwner === TITLE_ENGINE_OWNER) return false;

    window[TITLE_ENGINE_GUARD] = {
      owner: TITLE_ENGINE_OWNER,
      script: 'attentus-cw-helpdesk-toolkit',
      startedAt: Date.now()
    };
    if (document.documentElement?.dataset) document.documentElement.dataset[TITLE_ENGINE_DATA_ATTR] = TITLE_ENGINE_OWNER;
    return true;
  }

  function createTitleController() {
    if (!claimTitleEngine()) {
      return {
        isActive: false,
        schedule: () => {},
        handleDomMutation: () => {},
        handleRouteChange: () => {},
        openSettings: () => toast('Tab title settings are controlled by the standalone title normalizer')
      };
    }

    const titleSettings = { ...TITLE_DEFAULTS };
    let titleSettingsReady = (async () => {
      titleSettings[TITLE_K_COMPANY] = !!(await gmGet(TITLE_K_COMPANY, TITLE_DEFAULTS[TITLE_K_COMPANY]));
      titleSettings[TITLE_K_SB_RENAME] = !!(await gmGet(TITLE_K_SB_RENAME, TITLE_DEFAULTS[TITLE_K_SB_RENAME]));
      titleSettings[TITLE_K_TE_TICKET] = !!(await gmGet(TITLE_K_TE_TICKET, TITLE_DEFAULTS[TITLE_K_TE_TICKET]));
    })();

    const originalTitle = document.title;
    const titleNorm = value => String(value || '').replace(/\s+/g, ' ').trim();
    const titleVisible = (el) => !!el && el.nodeType === 1 && (el.offsetParent !== null || el.getClientRects().length > 0);
    const MIN_TICKET_DIGITS = 5;
    let lastSnapshotSig = '';
    let hiddenPoller = null;

    function titleParts(id, summary, company, includeCompany) {
      const parts = [];
      if (id) parts.push(`#${id}`);
      if (summary) parts.push(summary);
      if (includeCompany && company) parts.push(company);
      return parts.join(' - ').trim();
    }

    function isServiceBoardList() {
      return !!document.querySelector('table.srboard-grid tr.cw-ml-row');
    }

    function isTimeEntryPage() {
      const href = location.href.toLowerCase();
      if (/\btime[_-]?entry\b/.test(href) || /timeentry/.test(href)) return true;
      const labels = document.querySelectorAll('.GMDB3DUBBPG, .GMDB3DUBORG, .gwt-Label.mm_label, [id$="-label"]');
      for (const el of labels) {
        const text = titleNorm(el.textContent).toLowerCase();
        if (text.includes('time entry')) return true;
      }
      return !!(document.querySelector('input.cw_timeStart') || document.querySelector('input.cw_timeEnd'));
    }

    function ticketIdFromTitleUrl() {
      try {
        const url = new URL(location.href);
        const queryId = url.searchParams.get('service_recid')
          || url.searchParams.get('srRecID')
          || url.searchParams.get('serviceTicketId')
          || url.searchParams.get('recid');
        if (queryId && /^\d+$/.test(queryId) && queryId.length >= MIN_TICKET_DIGITS) return queryId;

        const match = url.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d+)(?:$|[/?#])/i);
        if (match?.[1] && match[1].length >= MIN_TICKET_DIGITS) return match[1];
      } catch {}
      return '';
    }

    function ticketIdFromTitleDom() {
      const candidates = document.querySelectorAll(
        '[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBNLI, .GMDB3DUBLHH, .GMDB3DUBIHH, .GMDB3DUBORG, .GMDB3DUBBPG'
      );
      for (const el of candidates) {
        if (!titleVisible(el)) continue;
        const match = titleNorm(el.textContent).match(/ticket\s*#\s*(\d+)/i);
        if (match?.[1] && match[1].length >= MIN_TICKET_DIGITS) return match[1];
      }
      return '';
    }

    function getTitleTicketId() {
      return ticketIdFromTitleUrl() || ticketIdFromTitleDom() || '';
    }

    function getTitleSummary() {
      const input = document.querySelector('input.cw_PsaSummaryHeader')
        || document.querySelector('input.cw_summary')
        || document.querySelector('input[placeholder*="summary" i]');
      if (input?.value) return titleNorm(input.value);

      const labels = document.querySelectorAll('[id$="-label"], .GMDB3DUBORG, .gwt-Label, .mm_label');
      for (const el of labels) {
        if (!titleVisible(el)) continue;
        const match = titleNorm(el.textContent).match(/^summary:\s*(.+)$/i);
        if (match) return titleNorm(match[1]);
      }
      return '';
    }

    function getTitleCompany() {
      const labels = document.querySelectorAll('[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBORG, .GMDB3DUBBPG');
      for (const el of labels) {
        if (!titleVisible(el)) continue;
        const match = titleNorm(el.textContent).match(/^\s*company:\s*(.+)$/i);
        if (match) return titleNorm(match[1]);
      }

      const input = document.querySelector('input.cw_company') || document.querySelector('input[placeholder*="company" i]');
      return input?.value ? titleNorm(input.value) : '';
    }

    function parseTitleTicketId(raw) {
      const match = String(raw || '').match(/(\d{5,})/);
      return match ? match[1] : null;
    }

    function getTicketIdFromChargeToOnce() {
      const input = document.querySelector('input.cw_ChargeToTextBox, input[id$="ChargeToTextBox"], input.GKV5JQ3DMVF.cw_ChargeToTextBox');
      if (!input) return null;

      let id = parseTitleTicketId(input.value);
      if (id) return id;

      const scope = input.closest('td,div') || document;
      const hidden = scope.querySelector('input[type="hidden"][value], input[type="hidden"][name*="ChargeTo"]');
      id = parseTitleTicketId(hidden?.value);
      if (id) return id;

      const activeId = input.getAttribute('aria-activedescendant');
      if (activeId) {
        const activeEl = document.getElementById(activeId);
        id = parseTitleTicketId(activeEl?.textContent);
        if (id) return id;
      }
      return null;
    }

    function getServiceBoardViewName() {
      const root = document.querySelector('.cw-toolbar-view-dropdown') || document;
      const input = root.querySelector('input.cw_CwComboBox') || root.querySelector('input[placeholder*="view" i]');
      const value = (input && (input.value || input.getAttribute('value'))) || '';
      return titleNorm(value);
    }

    const schedule = (() => {
      let pending = false;
      let lastRun = 0;
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
        if (document.hidden) { setTimeout(run, 0); return; }
        if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 400 });
        else if ('requestAnimationFrame' in window) requestAnimationFrame(run);
        else setTimeout(run, 0);
      };
    })();

    const snapshotSignature = snapshot => Object.values(snapshot).map(value => String(value ?? '')).join('|');

    function pageSnapshot() {
      const ticketId = getTitleTicketId();
      if (ticketId) {
        return { kind: 'ticket', id: ticketId, summary: getTitleSummary(), company: getTitleCompany(), url: location.pathname + location.search };
      }
      if (isTimeEntryPage()) {
        const timeTicketId = getTicketIdFromChargeToOnce() || ticketIdFromTitleUrl() || '';
        return { kind: 'time', id: timeTicketId, url: location.pathname + location.search };
      }
      if (isServiceBoardList()) {
        return { kind: 'board', view: getServiceBoardViewName(), url: location.pathname + location.search };
      }
      return { kind: 'other', url: location.pathname + location.search };
    }

    async function updateTitle() {
      const snapshot = pageSnapshot();
      const sig = snapshotSignature(snapshot);
      if (sig === lastSnapshotSig) return;
      lastSnapshotSig = sig;

      await titleSettingsReady;

      if (snapshot.kind === 'ticket') {
        const next = titleParts(snapshot.id, snapshot.summary, snapshot.company, !!titleSettings[TITLE_K_COMPANY]);
        if (next && document.title !== next) document.title = next;
        return;
      }

      if (snapshot.kind === 'time') {
        const next = titleSettings[TITLE_K_TE_TICKET] && snapshot.id ? `#${snapshot.id} - Time Entry` : 'Time Entry';
        if (document.title !== next) document.title = next;
        return;
      }

      if (snapshot.kind === 'board' && titleSettings[TITLE_K_SB_RENAME]) {
        const view = snapshot.view?.trim();
        if (view && document.title !== view) document.title = view;
        return;
      }

      if (!isServiceBoardList() && !document.title && document.title !== originalTitle) {
        document.title = originalTitle;
      }
    }

    function attachFieldListeners() {
      const selectors = [
        'input.cw_PsaSummaryHeader',
        'input.cw_summary',
        'input.cw_company',
        'input[placeholder*="summary" i]',
        'input[placeholder*="company" i]',
        '.cw-toolbar-view-dropdown input.cw_CwComboBox',
        '.cw-toolbar-view-dropdown input[type="text"]',
        'input.cw_ChargeToTextBox',
        'input[id$="ChargeToTextBox"]'
      ];
      document.querySelectorAll(selectors.join(',')).forEach(el => {
        ['input', 'change', 'keyup', 'keydown', 'blur'].forEach(eventName => {
          el.removeEventListener(eventName, schedule);
          el.addEventListener(eventName, schedule, { passive: true });
        });
      });
    }

    function handleDomMutation(mutations = []) {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          attachFieldListeners();
          schedule();
          return;
        }
        if (mutation.type === 'attributes') {
          const name = mutation.attributeName || '';
          if (name === 'value' || name === 'placeholder' || name === 'title' || name === 'aria-activedescendant') {
            attachFieldListeners();
            schedule();
            return;
          }
        }
      }
    }

    function handleRouteChange() {
      lastSnapshotSig = '';
      attachFieldListeners();
      schedule();
    }

    async function openTitleSettingsDialog() {
      await titleSettingsReady;
      document.getElementById(TITLE_SETTINGS_OVERLAY_ID)?.remove();

      const overlay = document.createElement('div');
      overlay.id = TITLE_SETTINGS_OVERLAY_ID;
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.35)',
        zIndex: 2147483646,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      });

      const modal = document.createElement('div');
      Object.assign(modal.style, {
        width: 'min(440px, 92vw)',
        background: '#fff',
        color: '#111827',
        borderRadius: '12px',
        boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        padding: '16px',
        font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
      });

      const addCompanyId = 'att-cw-helpdesk-title-add-company';
      const serviceBoardId = 'att-cw-helpdesk-title-service-board';
      const timeEntryId = 'att-cw-helpdesk-title-time-entry';
      modal.innerHTML = `
        <div style="font-weight:700; font-size:16px; margin-bottom:8px;">Tab Title Settings</div>
        <label style="display:flex; align-items:center; gap:8px; margin:8px 0;">
          <input type="checkbox" id="${addCompanyId}" ${titleSettings[TITLE_K_COMPANY] ? 'checked' : ''}>
          <span>Append company to ticket tabs</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin:8px 0;">
          <input type="checkbox" id="${serviceBoardId}" ${titleSettings[TITLE_K_SB_RENAME] ? 'checked' : ''}>
          <span>Rename Service Board tabs to the active View</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; margin:8px 0;">
          <input type="checkbox" id="${timeEntryId}" ${titleSettings[TITLE_K_TE_TICKET] ? 'checked' : ''}>
          <span>Add ticket # to Time Entry tabs when available</span>
        </label>
      `;

      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });

      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.textContent = 'Close';
      Object.assign(closeButton.style, { padding: '7px 11px', border: '1px solid #D1D5DB', borderRadius: '8px', background: '#fff', cursor: 'pointer' });
      closeButton.addEventListener('click', () => overlay.remove());

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.textContent = 'Save';
      Object.assign(saveButton.style, { padding: '7px 11px', border: '1px solid #111827', borderRadius: '8px', background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 600 });
      saveButton.addEventListener('click', async () => {
        const newAddCompany = !!document.getElementById(addCompanyId)?.checked;
        const newServiceBoard = !!document.getElementById(serviceBoardId)?.checked;
        const newTimeEntry = !!document.getElementById(timeEntryId)?.checked;

        await gmSet(TITLE_K_COMPANY, newAddCompany);
        await gmSet(TITLE_K_SB_RENAME, newServiceBoard);
        await gmSet(TITLE_K_TE_TICKET, newTimeEntry);

        titleSettings[TITLE_K_COMPANY] = newAddCompany;
        titleSettings[TITLE_K_SB_RENAME] = newServiceBoard;
        titleSettings[TITLE_K_TE_TICKET] = newTimeEntry;
        titleSettingsReady = Promise.resolve();
        lastSnapshotSig = '';
        overlay.remove();
        schedule();
        toast('Tab title settings saved');
      });

      row.append(closeButton, saveButton);
      modal.appendChild(row);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (!hiddenPoller) hiddenPoller = setInterval(() => updateTitle(), 1500);
      } else {
        if (hiddenPoller) { clearInterval(hiddenPoller); hiddenPoller = null; }
        schedule();
      }
    }, { passive: true });

    window.addEventListener('att:openviews-applied', () => schedule(), { passive: true });
    window.addEventListener('focus', () => schedule(), { passive: true });

    (async () => {
      await titleSettingsReady;
      attachFieldListeners();
      schedule();
    })();

    return {
      isActive: true,
      schedule,
      handleDomMutation,
      handleRouteChange,
      openSettings: openTitleSettingsDialog
    };
  }

  const titleController = createTitleController();

  window.attentusHelpdeskToolkit = {
    copyTriage,
    confirmAndApplyTriage,
    getTriageMode,
    setTriageMode,
    getToolkitSettings,
    setToolkitSettings,
    parseBoardShoutoutMappings,
    getBoardShoutout,
    showToolkitSettingsDialog,
    mountTicketTools,
    handleTriageButton,
    snapshotFields,
    applyFieldChanges,
    revertFieldChanges,
    clearContactInfo,
    confirmAndClearContactInfo,
    revertContactInfo,
    snapshotContactInfo,
    getTicketId,
    commitComboOnElement,
    openPopupAndGetContainer,
    findInputByLabel,
    showActionDialog,
    signatureHTML,
    signatureText,
    showTimeEntryClipboardSettings,
    ensureTimeEntryClipboard,
    isBoard,
    mountBoardTools,
    showBoardMappingSetup
  };

  function isTimeEntryPageContext() {
    const href = location.href.toLowerCase();
    if (/\btime[_-]?entry\b/.test(href) || /timeentry/.test(href)) return true;
    if (isTimeEntryTimesheetContext()) return true;
    if (document.querySelector('input.cw_timeStart, input.cw_timeEnd')) return true;
    return Array.from(document.querySelectorAll('.GMDB3DUBBPG, .GMDB3DUBORG, .gwt-Label.mm_label, [id$="-label"]'))
      .some(el => visible(el) && /time\s+entry/i.test(el.textContent || ''));
  }

  function isBoard() {
    if (isTimeEntryPageContext() || isTicketContextLoose()) return false;
    if (!document.querySelector('table.srboard-grid')) return false;
    if (!getVisibleBoardRows().length) return false;
    return visible(getBoardViewInput());
  }

  function isBoardContextLoose() {
    return isBoard();
  }

  function getToolkitPageContext() {
    const url = `${location.pathname}${location.search}`;
    const ticketId = getTicketId() || '';
    let kind = 'other';

    if (isTimeEntryPageContext()) kind = 'time';
    else if (isTicketContextLoose()) kind = 'ticket';
    else if (isBoardContextLoose()) kind = 'board';

    return { url, ticketId, kind, signature: [url, ticketId, kind].join('|') };
  }

  function removeToolkitContextGroups() {
    for (const id of [TICKET_GROUP_ID, LEGACY_TICKET_GROUP_ID, BOARD_GROUP_ID]) {
      const el = document.getElementById(id);
      if (el?.parentNode) el.parentNode.removeChild(el);
    }
    removeTimeEntryClipGroupIfAny();
  }

  function ensureGroupsForContext(context) {
    if (context.kind === 'ticket') {
      ensureBarPlaced();
      ensureTimeEntryClipboard();
      return;
    }
    if (context.kind === 'time') {
      ensureTimeEntryClipboard();
      return;
    }
    removeTimeEntryClipGroupIfAny();
    if (context.kind === 'board') {
      mountBoardTools();
      return;
    }
    document.getElementById(BOARD_GROUP_ID)?.remove();
  }

  let lastToolkitContextSignature = '';
  let contextRefreshPending = false;

  function refreshToolkitContext(reason = 'manual', mutations = []) {
    const context = getToolkitPageContext();
    const contextChanged = context.signature !== lastToolkitContextSignature;
    if (contextChanged) {
      log('context changed', { reason, context });
      lastToolkitContextSignature = context.signature;
      removeToolkitContextGroups();
      titleController.handleRouteChange();
    } else {
      titleController.handleDomMutation(mutations);
    }
    ensureGroupsForContext(context);
  }

  function scheduleToolkitContextRefresh(reason = 'scheduled', mutations = []) {
    if (contextRefreshPending) return;
    contextRefreshPending = true;
    queueMicrotask(() => {
      contextRefreshPending = false;
      refreshToolkitContext(reason, mutations);
    });
  }

  const observer = new MutationObserver((mutations) => {
    scheduleToolkitContextRefresh('mutation', mutations);
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['value', 'placeholder', 'title', 'aria-activedescendant']
  });

  ['pushState', 'replaceState'].forEach(key => {
    const original = history[key];
    history[key] = function () {
      const result = original.apply(this, arguments);
      scheduleToolkitContextRefresh(key);
      return result;
    };
  });

  window.addEventListener('popstate', () => scheduleToolkitContextRefresh('popstate'));
  window.addEventListener('hashchange', () => scheduleToolkitContextRefresh('hashchange'));
  refreshToolkitContext('initial');
  setTimeout(() => refreshToolkitContext('startup-200ms'), 200);
  setTimeout(() => refreshToolkitContext('startup-700ms'), 700);
})();
