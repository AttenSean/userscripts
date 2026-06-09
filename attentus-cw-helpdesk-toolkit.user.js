// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      0.1.0
// @description  Read-only ConnectWise help desk toolkit: ticket link copy, safe triage prompts, board shoutouts, time-entry clipboard helpers, contact copy, and tab title cleanup.
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
    defloc: 'att_clip_defloc',
    random: 'att_clip_random'
  };

  const REVIEW_URLS = {
    tacoma: 'https://www.attentus.tech/tacoma_reviews',
    seattle: 'https://www.attentus.tech/seattle_reviews',
    bellevue: 'https://www.attentus.tech/bellevue_reviews',
    renton: 'https://www.attentus.tech/renton_reviews'
  };

  const PRIORITY_LABELS = {
    P0: 'P0 - Critical',
    P1: 'P1 - High',
    P2: 'P2 - Medium',
    P3: 'P3 - Normal',
    P4: 'P4 - Low',
    PM: 'Maintenance'
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

  const txt = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const strip = (s) => String(s || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.getClientRects && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  function ensureStyles() {
    if (document.getElementById(`${APP}-style`)) return;
    const s = document.createElement('style');
    s.id = `${APP}-style`;
    s.textContent = `
      .${APP}-group{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin:4px 6px 4px 0;vertical-align:middle}
      .${APP}-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;padding:4px 8px;border:1px solid rgba(0,0,0,.22);border-radius:6px;background:#2563eb;color:#fff!important;font:12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;cursor:pointer;text-decoration:none;white-space:nowrap;min-height:24px;box-sizing:border-box}
      .${APP}-btn:hover{filter:brightness(1.06)}
      .${APP}-btn.secondary{background:#374151}
      .${APP}-btn.warn{background:#92400e}
      .${APP}-btn[aria-disabled="true"]{opacity:.55;cursor:not-allowed;background:#6b7280}
      .${APP}-select{padding:3px 6px;border-radius:6px;border:1px solid rgba(0,0,0,.25);font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:white;color:#111827;min-height:24px}
      .${APP}-toast{position:fixed;right:16px;bottom:16px;z-index:2147483646;background:#111827;color:#fff;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.24)}
      .${APP}-modal-bg{position:fixed;inset:0;z-index:2147483645;background:rgba(17,24,39,.35);display:flex;align-items:center;justify-content:center;padding:20px}
      .${APP}-modal{background:white;color:#111827;max-width:560px;width:100%;border-radius:12px;box-shadow:0 24px 80px rgba(0,0,0,.35);font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:16px}
      .${APP}-modal h2{font-size:16px;margin:0 0 10px}.${APP}-modal p{margin:8px 0}
      .${APP}-grid{display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center}.${APP}-grid input{padding:6px;border:1px solid #cbd5e1;border-radius:6px}
      .${APP}-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
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

  async function gmGet(key, defVal) {
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(key, defVal); } catch {}
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? defVal : JSON.parse(raw);
    } catch {}
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
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(safeText); return true; } catch (err) { log('navigator text clipboard failed', err); }
    }
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

  function makeGroup(id, label) {
    let g = document.getElementById(id);
    if (g) return g;
    g = document.createElement('span');
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

  function button(id, label, title, onClick, cls = '') {
    let b = document.getElementById(id);
    if (b) return b;
    b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = `${APP}-btn ${cls}`.trim();
    b.textContent = label;
    b.title = title || label;
    b.addEventListener('click', onClick);
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }
    });
    return b;
  }

  function getTicketId() {
    const search = new URLSearchParams(location.search || '');
    const keys = ['service_recid', 'recid', 'serviceticketid', 'srServiceRecID'];
    for (const key of keys) {
      const val = search.get(key);
      if (/^\d+$/.test(val || '')) return val;
    }
    const fromHref = String(location.href).match(/[?&](?:service_recid|recid|serviceticketid)=([0-9]+)/i);
    if (fromHref) return fromHref[1];
    const label = Array.from(document.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label,.cw_CwHTML'))
      .map(txt).find(t => /(?:service\s*ticket\s*#|ticket\s*#)\s*\d+/i.test(t));
    const fromLabel = label && label.match(/#\s*(\d+)/);
    return fromLabel ? fromLabel[1] : '';
  }

  function isTicketPage() {
    if (getTicketId()) return true;
    if (document.querySelector('.pod_ticketSummary, .pod_ticketHeaderActions')) return true;
    return Array.from(document.querySelectorAll('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label')).some(el => /service\s+ticket/i.test(txt(el)));
  }

  function isProjectTicket() {
    return Array.from(document.querySelectorAll('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label')).some(el => /project\s+ticket/i.test(txt(el)));
  }

  function isTimeSheetContext() {
    if (/timesheet/i.test(location.href)) return true;
    if (document.querySelector('.mytimesheetlist, .TimeSheet')) return true;
    return Array.from(document.querySelectorAll('.cw-main-banner .navigationEntry,.cw-main-banner .cw_CwLabel')).some(el => /open time sheets|time sheet/i.test(txt(el)));
  }

  function isTimeEntryContext() {
    if (isTimeSheetContext()) return false;
    if (/time(entry|_entry)|TimeEntry|time_recid/i.test(location.href)) return true;
    return Array.from(document.querySelectorAll('.navigationEntry,.cw_CwLabel,.gwt-Label,.mm_label')).some(el => /^time\s+entry$/i.test(txt(el)));
  }

  function findTicketActionMount() {
    const follow = Array.from(document.querySelectorAll('.cw_ToolbarButton,.mm_button,button,div[role="button"]')).find(el => /^follow$/i.test(txt(el)));
    if (follow && follow.parentElement) return follow.parentElement;
    const save = document.querySelector('.cw_ToolbarButton_Save');
    if (save && save.parentElement) return save.parentElement;
    const header = document.querySelector('.pod_ticketHeaderActions, .cw-main-toolbar, .cw_toolbar, .MainToolbar');
    return header || document.body;
  }

  function findTimeEntryMount() {
    const stamps = Array.from(document.querySelectorAll('.cw_ToolbarButton_TimeStamp'));
    for (const st of stamps) {
      const row = st.closest('tr');
      if (!row || /notes$/i.test(txt(row))) return st.parentElement || st;
    }
    const autoThreadHeader = Array.from(document.querySelectorAll('.mm_podHeader [id$="-label"], .pod_unknown_header [id$="-label"]'))
      .find(el => /thread:\s*auto time entries/i.test(txt(el)));
    if (autoThreadHeader) return autoThreadHeader.closest('.mm_podHeader,.pod_unknown_header') || autoThreadHeader;
    return document.querySelector('.pod_hosted_16_header, .pod_hosted_16') || null;
  }

  function readLabeledValue(labelRegex) {
    const labels = Array.from(document.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label,label,.cw_CwHTML'));
    for (const l of labels) {
      const text = txt(l).replace(/:$/, '');
      if (!labelRegex.test(text)) continue;
      const row = l.closest('tr, .cw_Container, .form-group, .gwt-HTMLPanel, .mm_field') || l.parentElement;
      if (!row) continue;
      const input = row.querySelector('input, textarea');
      if (input && 'value' in input && strip(input.value)) return strip(input.value);
      const candidates = Array.from(row.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label,.cw_CwHTML,span,div')).map(txt).filter(Boolean);
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
    const summary = readLabeledValue(/^summary$/i) || document.title.replace(/^.*?\bTicket\b/i, '').trim();
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
    const lines = [
      info.contact && `Contact: ${info.contact}`,
      info.email && `Email: ${info.email}`,
      info.phone && `Phone: ${info.phone}`,
      info.company && `Company: ${info.company}`
    ].filter(Boolean);
    if (!lines.length) { toast('No contact details found'); return; }
    const html = lines.map(esc).join('<br>');
    toast(await writeClipboard(html, lines.join('\n')) ? 'Copied contact details' : 'Copy failed');
  }

  async function copyTriage(kind) {
    const info = currentTicketInfo();
    const templates = {
      spam: {
        title: 'Spam/Phishing triage draft',
        steps: ['Review message headers/body for malicious indicators.', 'If confirmed: Board Help Desk, Status MUST ASSIGN, Type Email, Subtype Spam/Phishing, Tier 1, Priority 4.', 'Suggested summary: Spam/Phishing' + (info.contact ? ` (${info.contact})` : '')]
      },
      junk: {
        title: 'Junk triage draft',
        steps: ['Confirm ticket is non-actionable junk/noise.', 'If confirmed: move to Junk board using normal ConnectWise controls.', 'Add a short internal note if context may be needed later.']
      },
      cancel: {
        title: 'Closed/Cancelled triage draft',
        steps: ['Confirm the request should be cancelled/closed without action.', 'If confirmed: set Status to >Closed/Cancelled and Ticket Tier? to N/A - Cancelled Ticket.', 'Use normal ConnectWise Save controls after manual review.']
      }
    };
    const t = templates[kind] || templates.spam;
    const lines = [
      t.title,
      info.id && `Ticket #${info.id}: ${info.url}`,
      info.company && `Company: ${info.company}`,
      info.contact && `Contact: ${info.contact}`,
      info.summary && `Summary: ${info.summary}`,
      '',
      ...t.steps.map(step => `- ${step}`)
    ].filter(v => v !== false && v != null);
    const html = `<strong>${esc(t.title)}</strong><br>` + lines.slice(1).map(line => line ? esc(line) : '<br>').join('<br>');
    toast(await writeClipboard(html, lines.join('\n')) ? 'Copied triage draft' : 'Copy failed');
  }

  function mountTicketTools() {
    if (!isTicketPage() || isProjectTicket()) return;
    const mount = findTicketActionMount();
    if (!mount || document.getElementById(`${APP}-ticket-group`)) return;
    const g = makeGroup(`${APP}-ticket-group`, 'Helpdesk:');
    g.append(
      button(`${APP}-copy-ticket`, 'Copy Ticket', 'Copy a formatted ticket link', () => copyTicketLink(false)),
      button(`${APP}-copy-url`, 'URL', 'Copy only the ticket URL', () => copyTicketLink(true), 'secondary'),
      button(`${APP}-copy-contact`, 'Copy Contact', 'Copy detected contact details; does not clear or edit ConnectWise fields', copyContact, 'secondary'),
      button(`${APP}-triage-spam`, 'Spam/Phish Draft', 'Copy a spam/phishing triage checklist; does not edit or save the ticket', () => copyTriage('spam'), 'warn'),
      button(`${APP}-triage-junk`, 'Junk Draft', 'Copy a junk triage checklist; does not edit or save the ticket', () => copyTriage('junk'), 'warn'),
      button(`${APP}-triage-cancel`, 'Cancel Draft', 'Copy a closed/cancelled triage checklist; does not edit or save the ticket', () => copyTriage('cancel'), 'warn')
    );
    mount.appendChild(g);
  }

  function signatureHTML(name) {
    return `<div style="margin:0;line-height:1.35"><div>Thank you,</div><div><strong>${esc(name)}</strong></div><div>Attentus Technologies</div><div><strong>Support:</strong> (253) 218-6015 x1</div><div>Call or Text Us: (253) 218-6015</div></div>`;
  }

  function signatureText(name) {
    return ['Thank you,', name, 'Attentus Technologies', 'Support: (253) 218-6015 x1', 'Call or Text Us: (253) 218-6015'].join('\n');
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
    if (document.getElementById(`${APP}-settings-bg`)) return;
    const values = {
      name: await gmGet(KEYS.name, DEFAULTS.name),
      headline: await gmGet(KEYS.headline, DEFAULTS.headline),
      prefix: await gmGet(KEYS.prefix, DEFAULTS.prefix),
      link: await gmGet(KEYS.link, DEFAULTS.linkText),
      suffix: await gmGet(KEYS.suffix, DEFAULTS.suffix),
      closing: await gmGet(KEYS.closing, DEFAULTS.closing),
      defloc: await gmGet(KEYS.defloc, DEFAULTS.defaultLocation),
      random: await gmGet(KEYS.random, DEFAULTS.randomizeLocation)
    };
    const bg = document.createElement('div');
    bg.id = `${APP}-settings-bg`;
    bg.className = `${APP}-modal-bg`;
    bg.innerHTML = `
      <div class="${APP}-modal" role="dialog" aria-modal="true" aria-label="Clipboard settings">
        <h2>Clipboard settings</h2>
        <div class="${APP}-grid">
          <label>Name</label><input id="${APP}-set-name" value="${esc(values.name)}">
          <label>Headline</label><input id="${APP}-set-headline" value="${esc(values.headline)}">
          <label>Prefix</label><input id="${APP}-set-prefix" value="${esc(values.prefix)}">
          <label>Link text</label><input id="${APP}-set-link" value="${esc(values.link)}">
          <label>Suffix</label><input id="${APP}-set-suffix" value="${esc(values.suffix)}">
          <label>Closing</label><input id="${APP}-set-closing" value="${esc(values.closing)}">
          <label>Default location</label><select id="${APP}-set-defloc"><option value="bellevue">Bellevue</option><option value="renton">Renton</option><option value="seattle">Seattle</option><option value="tacoma">Tacoma</option></select>
          <label>Randomize</label><input id="${APP}-set-random" type="checkbox">
        </div>
        <p>This only changes local userscript settings and clipboard text.</p>
        <div class="${APP}-actions"><button id="${APP}-set-cancel" class="${APP}-btn secondary">Cancel</button><button id="${APP}-set-save" class="${APP}-btn">Save</button></div>
      </div>`;
    document.body.appendChild(bg);
    bg.querySelector(`#${APP}-set-defloc`).value = values.defloc;
    bg.querySelector(`#${APP}-set-random`).checked = !!values.random;
    bg.querySelector(`#${APP}-set-cancel`).addEventListener('click', () => bg.remove());
    bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
    bg.querySelector(`#${APP}-set-save`).addEventListener('click', async () => {
      await gmSet(KEYS.name, bg.querySelector(`#${APP}-set-name`).value.trim() || DEFAULTS.name);
      await gmSet(KEYS.headline, bg.querySelector(`#${APP}-set-headline`).value);
      await gmSet(KEYS.prefix, bg.querySelector(`#${APP}-set-prefix`).value);
      await gmSet(KEYS.link, bg.querySelector(`#${APP}-set-link`).value);
      await gmSet(KEYS.suffix, bg.querySelector(`#${APP}-set-suffix`).value);
      await gmSet(KEYS.closing, bg.querySelector(`#${APP}-set-closing`).value);
      await gmSet(KEYS.defloc, bg.querySelector(`#${APP}-set-defloc`).value);
      await gmSet(KEYS.random, bg.querySelector(`#${APP}-set-random`).checked);
      bg.remove();
      toast('Settings saved');
    });
  }

  async function mountTimeEntryTools() {
    if (!isTimeEntryContext()) return;
    const mount = findTimeEntryMount();
    if (!mount || document.getElementById(`${APP}-time-group`)) return;
    const name = await gmGet(KEYS.name, DEFAULTS.name);
    const g = makeGroup(`${APP}-time-group`, 'Clipboard:');
    const select = document.createElement('select');
    select.id = `${APP}-review-loc`;
    select.className = `${APP}-select`;
    Object.keys(REVIEW_URLS).forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc;
      opt.textContent = loc[0].toUpperCase() + loc.slice(1);
      select.appendChild(opt);
    });
    select.value = await gmGet(KEYS.defloc, DEFAULTS.defaultLocation);
    g.append(
      button(`${APP}-sig`, 'Signature', 'Copy signature', async () => toast(await writeClipboard(signatureHTML(await gmGet(KEYS.name, DEFAULTS.name)), signatureText(await gmGet(KEYS.name, DEFAULTS.name))) ? 'Copied signature' : 'Copy failed')),
      button(`${APP}-review`, 'Review + Sig', 'Copy review request and signature', async () => {
        const review = await reviewContent(select.value);
        const currentName = await gmGet(KEYS.name, DEFAULTS.name);
        const html = `${review.html}<br>${signatureHTML(currentName)}`;
        const text = `${review.text}\n\n${signatureText(currentName)}`;
        toast(await writeClipboard(html, text) ? `Copied review (${review.loc})` : 'Copy failed');
      }),
      select,
      button(`${APP}-clip-settings`, '⚙', 'Clipboard settings', openClipboardSettings, 'secondary')
    );
    mount.appendChild(g);
    log('mounted time entry tools for', name);
  }

  function isBoard() {
    return !!document.querySelector('table.srboard-grid tr.cw-ml-row');
  }

  function boardRows() {
    return Array.from(document.querySelectorAll('table.srboard-grid tr.cw-ml-row')).filter(visible);
  }

  function cellText(row, index) {
    if (index == null || index < 0) return '';
    return txt(row.querySelector(`td[cellindex="${index}"]`));
  }

  function headerMap() {
    const map = {};
    const headers = Array.from(document.querySelectorAll('table.srboard-grid th, table.srboard-grid td.cw-ml-header, table.srboard-grid .x-grid3-hd-inner'));
    headers.forEach((h, idx) => {
      const t = txt(h).toLowerCase();
      if (/ticket|sr\s*#|service/.test(t) && map.ticket == null) map.ticket = idx;
      if (/summary|description/.test(t) && map.summary == null) map.summary = idx;
      if (/company/.test(t) && map.company == null) map.company = idx;
      if (/status/.test(t) && map.status == null) map.status = idx;
      if (/resource|assigned/.test(t) && map.resource == null) map.resource = idx;
      if (/priority|severity/.test(t) && map.priority == null) map.priority = idx;
      if (/contact/.test(t) && map.contact == null) map.contact = idx;
    });
    return map;
  }

  function detectMapFromRows() {
    const map = headerMap();
    const row = boardRows()[0];
    if (!row) return map;
    const cells = Array.from(row.querySelectorAll('td[cellindex]'));
    if (map.ticket == null) {
      const t = cells.find(c => /^\d{5,}$/.test(txt(c)) || c.querySelector('a[href*="service_recid"]'));
      if (t) map.ticket = Number(t.getAttribute('cellindex'));
    }
    if (map.status == null) {
      const s = cells.find(c => STATUS_ORDER.some(st => strip(txt(c)).toLowerCase() === st.toLowerCase()));
      if (s) map.status = Number(s.getAttribute('cellindex'));
    }
    if (map.priority == null) {
      const p = cells.find(c => /\bP[0-4]\b|maintenance/i.test(txt(c)) || c.querySelector('img[src^="data:image"]'));
      if (p) map.priority = Number(p.getAttribute('cellindex'));
    }
    return map;
  }

  function priorityFromText(s) {
    const text = strip(s).toUpperCase();
    const match = text.match(/\bP[0-4]\b/);
    if (match) return match[0];
    if (/MAINT|MAINTENANCE/.test(text)) return 'PM';
    return 'P3';
  }

  function ticketFromRow(row, map) {
    const direct = cellText(row, map.ticket).match(/\d{5,}/);
    const link = row.querySelector('a[href*="service_recid="]');
    const hrefId = link && link.href.match(/[?&]service_recid=(\d+)/i);
    const id = direct ? direct[0] : (hrefId ? hrefId[1] : '');
    return {
      id,
      url: id ? `${location.origin}/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=${encodeURIComponent(id)}` : '',
      summary: cellText(row, map.summary),
      company: cellText(row, map.company),
      contact: cellText(row, map.contact),
      status: cellText(row, map.status),
      resource: cellText(row, map.resource),
      priority: priorityFromText(cellText(row, map.priority))
    };
  }

  async function copyBoardShoutout(overviewOnly = false) {
    const rws = boardRows();
    if (!rws.length) { toast('No visible board rows'); return; }
    const map = detectMapFromRows();
    const tickets = rws.map(r => ticketFromRow(r, map));
    const unassigned = tickets.filter(t => !strip(t.resource));
    const responses = tickets.filter(t => /client has responded/i.test(t.status));
    const buckets = {};
    unassigned.forEach(t => { buckets[t.priority] = (buckets[t.priority] || 0) + 1; });

    const html = [];
    const text = [];
    html.push(`<strong>HD Board Health Update</strong>${unassigned.length ? ` (${unassigned.length} unassigned)` : ''}<br><br>`);
    text.push(`HD Board Health Update${unassigned.length ? ` (${unassigned.length} unassigned)` : ''}`, '');
    const priorities = ['P0', 'P1', 'P2', 'P3', 'P4', 'PM'].filter(p => buckets[p]);
    if (priorities.length) {
      html.push('<table border="1" cellpadding="4" cellspacing="0"><thead><tr><th>Priority</th><th>Unassigned tickets</th></tr></thead><tbody>');
      text.push('Priority vs Unassigned');
      priorities.forEach(p => {
        html.push(`<tr><td>${esc(PRIORITY_LABELS[p] || p)}</td><td>${buckets[p]}</td></tr>`);
        text.push(`${PRIORITY_LABELS[p] || p}: ${buckets[p]}`);
      });
      html.push('</tbody></table>');
    }
    if (responses.length) {
      const counts = responses.reduce((acc, t) => { const key = strip(t.resource) || 'Unassigned'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
      html.push('<br><br><strong>Tickets with Responses</strong><br>');
      text.push('', 'Tickets with Responses');
      Object.keys(counts).sort((a, b) => a.localeCompare(b)).forEach(name => {
        html.push(`• ${esc(name)}, ${counts[name]}<br>`);
        text.push(`  • ${name}, ${counts[name]}`);
      });
    }
    if (!overviewOnly) {
      const important = tickets.filter(t => /P[0-2]/.test(t.priority) || /client has responded/i.test(t.status) || !strip(t.resource)).slice(0, 30);
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

  function mountBoardTools() {
    if (!isBoard() || document.getElementById(`${APP}-board-group`)) return;
    const viewInput = document.querySelector('.cw-toolbar-view-dropdown input.cw_CwComboBox, .cw-toolbar-view-dropdown [id$="-input"].cw_CwComboBox');
    const mount = (viewInput && viewInput.closest('.cw-toolbar-view-dropdown, td, div')) || document.querySelector('.cw_toolbar,.cw-main-toolbar') || document.body;
    const g = makeGroup(`${APP}-board-group`, 'HD Board:');
    g.append(
      button(`${APP}-board-overview`, 'Health Update', 'Copy unassigned/response overview from visible rows', () => copyBoardShoutout(true)),
      button(`${APP}-board-tickets`, 'Shoutout', 'Copy overview plus notable visible tickets', () => copyBoardShoutout(false), 'secondary')
    );
    mount.appendChild(g);
  }

  function normalizeTitle() {
    const id = getTicketId();
    if (id && !/^Ticket\s+#?\d+/i.test(document.title)) {
      const info = currentTicketInfo();
      const bits = [`Ticket #${id}`, info.company, info.summary].filter(Boolean);
      document.title = bits.join(' - ');
      return;
    }
    if (isTimeEntryContext() && !/^Time Entry/i.test(document.title)) {
      const ticket = id ? ` for #${id}` : '';
      document.title = `Time Entry${ticket} - ConnectWise`;
    }
  }

  let tickQueued = false;
  function tick() {
    if (tickQueued) return;
    tickQueued = true;
    setTimeout(async () => {
      tickQueued = false;
      ensureStyles();
      normalizeTitle();
      mountTicketTools();
      await mountTimeEntryTools();
      mountBoardTools();
    }, 100);
  }

  ensureStyles();
  tick();
  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', tick);
  window.addEventListener('popstate', tick);
  setInterval(tick, 2500);
})();
