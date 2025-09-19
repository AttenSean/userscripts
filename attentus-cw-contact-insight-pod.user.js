// ==UserScript==
// @name         attentus-cw-contact-insight-pod
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.16
// @description  Compact Contact Insight pod under Company > Email. Badges (title + type hierarchy), Notes badge with count that toggles inline notes panel, tiny refresh. Mounted exactly like the original pod (own <tr> after Email) to avoid any label/field shifting. Stealth-scrape with throttling + cache.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// ==/UserScript==

(() => {
  'use strict';

  /** ---------- utils ---------- */
  const q  = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const vis = (el) => !!(el && el.offsetParent && el.getClientRects().length);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, { timeout = 15000, interval = 120 } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(interval); }
    return null;
  };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  const GMget = async (k) => (typeof GM !== 'undefined' && GM.getValue) ? GM.getValue(k) : GM_getValue(k);
  const GMset = async (k, v) => (typeof GM !== 'undefined' && GM.setValue) ? GM.setValue(k, v) : GM_setValue(k, v);

  /** ---------- ticket gating ---------- */
  const MIN_TICKET_DIGITS = 5;
  function getTicketId() {
    try {
      const u = new URL(location.href);
      const qid = u.searchParams.get('service_recid') || u.searchParams.get('srRecID') || u.searchParams.get('recid');
      if (qid && /^\d+$/.test(qid) && qid.length >= MIN_TICKET_DIGITS) return qid;
      const pm = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{5,})/i);
      if (pm && pm[1]) return pm[1];
    } catch {}
    const labels = document.querySelectorAll('[id$="-label"], .gwt-Label, .mm_label, .cw_CwLabel');
    for (const el of labels) {
      if (!vis(el)) continue;
      const m = norm(el.textContent).match(/ticket\s*#\s*(\d{5,})/i);
      if (m) return m[1];
    }
    return '';
  }
  const isTicketPage = () => !!getTicketId();

  /** ---------- storage ---------- */
  const STORAGE_PREFIX = 'attentus:cw:contactInsight:';
  const storageKeyFor = ({ email, ticketId, name }) =>
    `${STORAGE_PREFIX}${(email || '').toLowerCase() || `t-${ticketId || ''}|n-${(name || '').toLowerCase()}`}`;

  /** ---------- contact button / flyout ---------- */
  const getContactButton = () => qa('.cw_ToolbarButton_User').find(el => vis(el)) || null;
  const contactActionEnabled = () => {
    const btn = getContactButton(); if (!btn) return false;
    const inner = q('.mm_button', btn);
    const tabBlocked   = inner && inner.getAttribute('tabindex') === '-1';
    const ariaBlocked  = (btn.getAttribute('aria-disabled') === 'true') || (inner && inner.getAttribute('aria-disabled') === 'true');
    const classBlocked = btn.className && /\bdisabled\b/i.test(btn.className);
    return !(tabBlocked || ariaBlocked || classBlocked);
  };

  function ensureStealthStyle() {
    let s = document.getElementById('attentus-stealth-style');
    if (s) return s;
    s = document.createElement('style');
    s.id = 'attentus-stealth-style';
    s.textContent = `body.att-silent-scrape .cw-gxt-wnd{visibility:hidden !important;pointer-events:none !important;opacity:0 !important}`;
    document.documentElement.appendChild(s);
    return s;
  }

  const anyContactDialog = () => q('.cw-gxt-wnd .pnlContactDialog');
  const anyCloseIcon     = () => q('.cw-gxt-wnd .x-panel-toolbar .mm_icon');

  async function openContactFlyout() {
    const btn = await until(() => getContactButton());
    if (!btn || !contactActionEnabled()) return false;
    btn.click();
    const dlg = await until(() => anyContactDialog(), { timeout: 6000 });
    return !!dlg;
  }
  async function closeContactFlyout() {
    const x = anyCloseIcon();
    if (x) { x.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true })); await sleep(80); }
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
    await sleep(60);
    document.body.click();
    await sleep(50);
    return true;
  }

  function readFromOpenFlyout() {
    const dialog = anyContactDialog();
    if (!dialog) return null;
    const pick = (sel) => { const el = q(sel, dialog); return el && el.textContent ? el.textContent.trim() : ''; };
    const details = {
      name:    pick('.contactName .gwt-Label'),
      company: pick('.companyName .gwt-Label'),
      title:   pick('.title .gwt-Label'),
      type:    pick('.contactType .gwt-Label'),
      email:   pick('.emailContacts .GMDB3DUBF2C, .emailContacts .gwt-Label.GMDB3DUBF2C, .emailContacts .gwt-Label'),
    };
    const a = dialog.querySelector('a[href*="ContactId="], a[href*="/contacts/"]');
    if (a) {
      try {
        const u = new URL(a.getAttribute('href'), location.href);
        const id = u.searchParams.get('ContactId') || (u.pathname.match(/(\d{3,})$/) || [])[1];
        if (id) details._contactRecId = id;
      } catch {}
    }
    return details;
  }

  let SCRAPE_IN_PROGRESS = false;
  const SCRAPE_THROTTLE_MS = 30 * 60 * 1000;
  const lastSuccessfulScrapeById = new Map();

  async function scrapeContactDetailsStealth(identity, { force=false } = {}) {
    const lastOk = lastSuccessfulScrapeById.get(identity) || 0;
    if (!force && (Date.now() - lastOk) < SCRAPE_THROTTLE_MS) return { blocked:false, data:null, throttled:true };
    if (SCRAPE_IN_PROGRESS) return { blocked:false, data:null };
    SCRAPE_IN_PROGRESS = true;
    ensureStealthStyle();
    document.body.classList.add('att-silent-scrape');
    const alreadyOpen = !!anyContactDialog();
    try {
      if (!alreadyOpen) {
        if (!contactActionEnabled()) return { blocked:true, data:null };
        const ok = await openContactFlyout();
        if (!ok) return { blocked:false, data:null };
      }
      await sleep(160);
      const data = readFromOpenFlyout();
      if (data && (data.title || data.type || data.email || data.name)) lastSuccessfulScrapeById.set(identity, Date.now());
      return { blocked:false, data };
    } finally {
      if (!alreadyOpen) await closeContactFlyout();
      setTimeout(() => document.body.classList.remove('att-silent-scrape'), 30);
      SCRAPE_IN_PROGRESS = false;
    }
  }

  /** ---------- Email row / identity ---------- */
  function findCompanyEmailRow() {
    const nodes = qa('.gwt-Label, label, td, div').filter(el => {
      if (!vis(el)) return false;
      if (el.closest('.cw-gxt-wnd')) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'email' || t === 'email:';
    });
    for (const el of nodes) {
      const row = el.closest('tr');
      if (row && vis(row)) return row;
    }
    return null;
  }
  function getEmailCell() {
    const row = findCompanyEmailRow(); if (!row) return null;
    return row.querySelector('td:nth-child(2), td + td, .gwt-Label + .gwt-Label') || null;
  }
  function identityFromUI() {
    const cell = getEmailCell();
    if (cell) {
      const t = norm(cell.textContent);
      if (/\S+@\S+/.test(t)) return t.toLowerCase();
    }
    const btn = getContactButton();
    if (btn) {
      const host = btn.closest('.GMDB3DUBFRG, .GMDB3DUBHFJ, .x-panel, .gwt-Panel, .mm_button') || btn.parentElement;
      if (host) {
        const cand = qa('.gwt-Label, .mm_label, input[type="text"]', host.parentElement || document.body)
          .filter(el => vis(el)).slice(0, 12)
          .map(el => ('value' in el ? el.value : el.textContent) || '').map(norm)
          .find(t => t && !/email|phone|company|site time zone/i.test(t) && t.length > 1);
        if (cand) return cand.toLowerCase();
      }
    }
    return '';
  }

  /** ---------- CW rails helpers ---------- */
  function cwBase() {
    const m = location.pathname.match(/\/v\d+_\d+/);
    return `${location.origin}${m ? m[0] : ''}`;
  }
  async function postRails(url, payload) {
    const body = new URLSearchParams({
      actionMessage: JSON.stringify(payload),
      clientTimezoneOffset: String(-new Date().getTimezoneOffset()),
      clientTimezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    }).toString();
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /** ---------- contactRecId + notes ---------- */
  async function getContactRecIdFromTicketByEmail(ticketId, emailLower) {
    const url = `${cwBase()}/services/system_io/actionprocessor/Service/GetServiceTicketDetailViewAction.rails`;
    const payload = {
      payload: JSON.stringify({ serviceRecId: Number(ticketId) }),
      payloadClassName: 'GetServiceTicketDetailViewAction',
      project: 'ServiceCommon'
    };
    const json = await postRails(url, payload);
    const svm = json?.data?.action?.serviceTicketViewModel || {};
    const mex = svm?.resourcePod?.resourceViewModel?.meetingExternals || [];
    const hit = mex.find(m => (m?.email || '').toLowerCase() === emailLower);
    if (hit?.contactRecID) return String(hit.contactRecID);
    const first = mex.find(m => m?.contactRecID);
    if (first?.contactRecID) return String(first.contactRecID);
    const alt = svm?.initialDescriptionPod?.discussion?.contactRecId;
    return alt && Number(alt) > 0 ? String(alt) : null;
  }
  async function fetchContactNotes(contactRecId) {
    const url = `${cwBase()}/services/system_io/actionprocessor/ServerCommon/NotesViewModelAction.rails`;
    const actionMessage = {
      payload: JSON.stringify({ recordID: Number(contactRecId), screenID: 'ct300' }),
      payloadClassName: 'NotesViewModelAction',
      project: 'ServerCommon',
    };
    const json = await postRails(url, actionMessage);
    const notes = json?.data?.action?.notesViewModel?.notes || [];
    return notes.filter(n => n?.note).map(n => ({
      type: n.noteTypeName || n.noteType?.name || '',
      note: n.note || '',
      updated: n.lastUpdate ? new Date(n.lastUpdate).toLocaleDateString() : '',
      by: n.updatedBy || ''
    }));
  }

  /** ---------- PUBLICATION LAYER ---------- */
  const _registry = new Map();
  const _subs = new Set();
  function publish(ticketId, details) {
    if (!ticketId) return;
    _registry.set(ticketId, details || null);
    const box = document.getElementById('attentus-contact-insight-box');
    if (box) {
      if (details?.title) box.dataset.title = details.title; else delete box.dataset.title;
      if (details?.type)  box.dataset.type  = details.type;  else delete box.dataset.type;
    }
    document.dispatchEvent(new CustomEvent('attentus:contact-insight', { detail: { ticketId, details } }));
    _subs.forEach(fn => { try { fn({ ticketId, details }); } catch {} });
  }
  window.AttentusContactInsight = window.AttentusContactInsight || {
    get(ticketId) { return ticketId ? (_registry.get(ticketId) || null) : null; },
    getCurrent()  { const t = getTicketId(); return t ? (_registry.get(t) || null) : null; },
    subscribe(fn) { if (typeof fn === 'function') { _subs.add(fn); return () => _subs.delete(fn); } return () => {}; }
  };

  /** ---------- UI (compact; ORIGINAL mount behavior) ---------- */
  function ensureInsightBox(afterRow) {
    qa('.att-contact-insight-slot').forEach(n => n.remove());

    const id = 'attentus-contact-insight-box';
    const exist = document.getElementById(id);
    if (exist && exist.isConnected) return exist;

    // ORIGINAL: its own <tr> right after the Email row
    let container;
    if (afterRow && afterRow.tagName === 'TR' && afterRow.parentElement) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = Math.max(2, afterRow.children.length);
      tr.appendChild(td);
      afterRow.insertAdjacentElement('afterend', tr);
      container = td;
    } else {
      container = document.createElement('div');
      afterRow?.insertAdjacentElement('afterend', container);
    }

    const box = document.createElement('div');
    box.id = id;
    box.setAttribute('role','region');
    box.setAttribute('aria-label','Contact Insight');
    Object.assign(box.style, {
      marginTop:'6px',
      padding:'8px',
      border:'1px solid rgba(0,0,0,0.12)',
      borderRadius:'10px',
      background:'rgba(15, 23, 42, 0.04)',
      boxShadow:'0 1px 2px rgba(0,0,0,0.06)',
      fontSize:'12px',
      lineHeight:'1.35',
      display:'grid',
      gridTemplateColumns:'auto 1fr auto',
      gap:'4px 8px',
      alignItems:'center'
    });

    const heading = document.createElement('div');
    heading.textContent = 'Contact Insight';
    heading.style.fontWeight = '600';
    heading.style.gridColumn = '1';

    // NEW: job title line (right side of header row)
    const titleLine = document.createElement('div');
    titleLine.dataset.field = 'jobtitle';
    Object.assign(titleLine.style, {
      gridColumn:'2',
      justifySelf:'start',
      fontSize:'11px',
      color:'#475569',
      whiteSpace:'nowrap',
      overflow:'hidden',
      textOverflow:'ellipsis',
      display:'none'
    });

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.title = 'Refresh';
    refresh.textContent = '↻';
    refresh.dataset.role = 'attentus-refresh';
    Object.assign(refresh.style, {
      width:'22px', height:'22px', lineHeight:'20px', textAlign:'center',
      border:'1px solid rgba(0,0,0,0.2)',
      borderRadius:'999px', background:'#fff', cursor:'pointer', display:'none',
      gridColumn:'3', justifySelf:'end'
    });
    refresh.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await forceRender(true); });

    const badges = document.createElement('div');
    badges.dataset.field = 'badges';
    Object.assign(badges.style, { gridColumn:'1 / -1', display:'flex', flexWrap:'wrap', gap:'6px', alignItems:'center' });

    const notesWrap = document.createElement('div');
    notesWrap.dataset.role = 'notes-wrap';
    Object.assign(notesWrap.style, { gridColumn:'1 / -1', display:'none', marginTop:'6px' });
    notesWrap.innerHTML = `
      <div style="font-weight:600;margin:2px 0 6px;">Contact Notes</div>
      <div data-role="notes-content" style="display:grid;gap:10px;"></div>
      <div data-role="notes-footer" style="margin-top:6px;display:none;"></div>
    `;

    box.append(heading, titleLine, refresh, badges, notesWrap);
    container.appendChild(box);
    return box;
  }
  function unmountInsightBox() {
    const box = document.getElementById('attentus-contact-insight-box');
    if (box) { const tr = box.closest('tr'); if (tr) tr.remove(); else box.remove(); }
  }
  function setRefreshVisible(v) {
    const btn = q('#attentus-contact-insight-box [data-role="attentus-refresh"]');
    if (!btn) return;
    btn.style.display = v ? 'inline-block' : 'none';
    btn.disabled = !v;
  }

  // badges (base + palettes)
  function badgeEl(text, { kind='neutral', asButton=false, title='' } = {}) {
    const el = asButton ? document.createElement('button') : document.createElement('span');
    el.textContent = text;
    if (title) el.title = title;
    if (asButton) {
      el.type = 'button';
      el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    }
    Object.assign(el.style, { fontSize:'11px', padding:'2px 6px', borderRadius:'999px', border:'1px solid', fontWeight:'600', userSelect:'none', background:'#fff', cursor: asButton ? 'pointer' : 'default' });
    const palettes = {
      decision: { bg:'#fff7ed', border:'#fdba74', text:'#9a3412' }, // orange
      owner:    { bg:'#ecfeff', border:'#67e8f9', text:'#155e75' }, // cyan
      selective:{ bg:'#f0fdf4', border:'#86efac', text:'#14532d' }, // green
      neutral:  { bg:'#f8fafc', border:'#cbd5e1', text:'#334155' }, // slate
      info:     { bg:'#eef2ff', border:'#c7d2fe', text:'#3730a3' }  // indigo
    };
    const p = palettes[kind] || palettes.neutral;
    Object.assign(el.style, { background:p.bg, borderColor:p.border, color:p.text });
    return el;
  }
  function noteCard(n) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { border:'1px solid rgba(0,0,0,.08)', borderRadius:'8px', padding:'8px 10px', background:'#fafafa' });
    const meta = document.createElement('div');
    meta.style.fontSize = '11px'; meta.style.opacity = '0.8'; meta.style.marginBottom = '6px';
    meta.textContent = [n.type, n.updated, n.by].filter(Boolean).join(' • ');
    const note = document.createElement('div');
    note.style.whiteSpace = 'pre-wrap'; note.style.wordBreak = 'break-word';
    note.textContent = n.note;
    wrap.append(meta, note);
    return wrap;
  }

  /** ---------- Notes helpers ---------- */
  const notesCacheByContact = new Map(); // contactId -> { notes, ts }

  async function setupNotesUI(details) {
    const box = document.getElementById('attentus-contact-insight-box'); if (!box) return;
    const badges = q('[data-field="badges"]', box); if (!badges) return;
    const wrap   = q('[data-role="notes-wrap"]', box);
    const content= q('[data-role="notes-content"]', wrap);
    const footer = q('[data-role="notes-footer"]', wrap);

    const ticketId = getTicketId();
    const emailLower = (details?.email || (getEmailCell()?.textContent || '')).trim().toLowerCase();
    let contactId = null;

    if (ticketId && emailLower) {
      try { contactId = await getContactRecIdFromTicketByEmail(ticketId, emailLower); } catch {}
    }
    if (!contactId) {
      const identity = details?.email || details?.name || emailLower || '';
      const { blocked, data } = await scrapeContactDetailsStealth(identity, { force:true });
      if (!blocked && data?._contactRecId) contactId = data._contactRecId;
    }
    if (!contactId) return;

    let notes = [];
    const cache = notesCacheByContact.get(contactId);
    if (cache && (Date.now() - cache.ts) < 5 * 60 * 1000) {
      notes = cache.notes;
    } else {
      try {
        notes = await fetchContactNotes(contactId);
        notesCacheByContact.set(contactId, { notes, ts: Date.now() });
      } catch { notes = []; }
    }
    if (!notes.length) return;

    const notesBtn = badgeEl(`Notes (${notes.length})`, { kind:'info', asButton:true, title:'Show/Hide recent contact notes' });
    notesBtn.dataset.role = 'attentus-notes-toggle';
    badges.prepend(notesBtn);

    wrap.style.display = 'none';
    content.textContent = '';
    notes.forEach(n => content.appendChild(noteCard(n)));
    footer.textContent = '';
    const openBtn = document.createElement('button');
    openBtn.type = 'button'; openBtn.textContent = 'Open full contact notes';
    Object.assign(openBtn.style, { fontSize:'11px', padding:'4px 8px', borderRadius:'999px', border:'1px solid rgba(0,0,0,.2)', background:'#fff', cursor:'pointer' });
    openBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const lbl = qa('.gwt-Label[title="Contact"]').find(el => vis(el));
      if (lbl) lbl.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    });
    footer.appendChild(openBtn);
    footer.style.display = 'block';

    notesBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const showing = wrap.style.display !== 'none';
      wrap.style.display = showing ? 'none' : 'block';
      notesBtn.setAttribute('aria-expanded', String(!showing));
    });
  }

  /** ---------- render (title line + badges + notes) ---------- */
  const hasDataByTicket = new Map();

  async function renderInsight(details, { blocked=false, throttled=false } = {}) {
    if (!isTicketPage()) { unmountInsightBox(); return false; }
    const row = findCompanyEmailRow(); if (!row) return false;

    const box = ensureInsightBox(row);
    setRefreshVisible(contactActionEnabled());

    const badges = q('[data-field="badges"]', box);
    const titleLine = q('[data-field="jobtitle"]', box);
    badges.textContent = '';
    titleLine.textContent = '';
    titleLine.style.display = 'none';
    box.removeAttribute('data-title'); box.removeAttribute('data-type');

    const ticketId = getTicketId();

    if (blocked || (throttled && !details) || !details) {
      publish(ticketId, null);
      return true;
    }

    const { title, type, email, name } = details;

    // Title is NOT a badge — subtle header-line text
    if (title) {
      titleLine.textContent = `Title: ${title}`;
      titleLine.title = title;
      titleLine.style.display = 'block';
    }

    // ----- Type hierarchy badges -----
    const tRaw = type || '';
    const isOwner          = /\ba\.\s*owner\b/i.test(tRaw) || /\bowner\b/i.test(tRaw);
    const isPrimaryDM      = /\bb\.\s*primary\s*decision\s*maker\b/i.test(tRaw);
    const isSecondaryDM    = /\bc\.\s*secondary\s*decision\s*maker\b/i.test(tRaw);
    const isSelective      = /\bs\.\s*selective\s*approver\b|\bselective\s*approver\b/i.test(tRaw);
    const isPrimaryContact = /\bprimary\s*contact\b/i.test(tRaw);
    const isSecondaryCont  = /\bsecondary\s*contact\b/i.test(tRaw);
    const isEmployee       = /\bmanaged\s*employee\b/i.test(tRaw) || /\bemployee\b/i.test(tRaw);
    const isContractor     = /\bcontractor\b/i.test(tRaw);
    const isVendor         = /\bvendor\b/i.test(tRaw);

    const anyDM = isOwner || isPrimaryDM || isSecondaryDM;
    if (anyDM) badges.appendChild(badgeEl('Decision Maker', { kind:'decision' }));
    if (isOwner) badges.appendChild(badgeEl('Owner', { kind:'owner' }));
    if (!anyDM) {
      if (isSelective)            badges.appendChild(badgeEl('Selective Approver', { kind:'selective' }));
      else if (isPrimaryContact)  badges.appendChild(badgeEl('Primary Contact',  { kind:'neutral' }));
      else if (isSecondaryCont)   badges.appendChild(badgeEl('Secondary Contact',{ kind:'neutral' }));
      else if (isEmployee)        badges.appendChild(badgeEl('Employee',         { kind:'neutral' }));
      else if (isContractor)      badges.appendChild(badgeEl('Contractor',       { kind:'neutral' }));
      else if (isVendor)          badges.appendChild(badgeEl('Vendor',           { kind:'neutral' }));
    }
    // ----------------------------------

    try { if (email || name) await GMset(storageKeyFor({ email, ticketId, name }), details); } catch {}
    publish(ticketId, details);

    try { await setupNotesUI(details); } catch {}

    hasDataByTicket.set(ticketId, true);
    return true;
  }

  /** ---------- orchestrator ---------- */
  const lastRenderedIdentityByTicket = new Map();
  let isBusy = false;
  let ignoreMutationsUntil = 0;

  async function maybeRender(force = false) {
    if (!isTicketPage()) { unmountInsightBox(); return; }
    const ticketId = getTicketId();
    setRefreshVisible(contactActionEnabled());

    if (!contactActionEnabled()) {
      const row = findCompanyEmailRow();
      if (row) { ensureInsightBox(row); await renderInsight(null, { blocked:true }); }
      return;
    }

    const idUI = identityFromUI();
    const lastId = lastRenderedIdentityByTicket.get(ticketId) || '';

    if (!idUI) {
      const row = findCompanyEmailRow();
      if (row) { ensureInsightBox(row); await renderInsight(null, {}); }
      return;
    }

    if (!force && idUI === lastId) return;
    if (isBusy) return;
    isBusy = true;

    try {
      const tryRenderCache = async () => {
        if (/\S+@\S+/.test(idUI)) {
          const cached = await GMget(storageKeyFor({ email:idUI, ticketId })) || null;
          if (cached) { await renderInsight(cached, {}); return true; }
        }
        return false;
      };

      if (!force && await tryRenderCache()) {
        lastRenderedIdentityByTicket.set(ticketId, idUI);
        hasDataByTicket.set(ticketId, true);
        ignoreMutationsUntil = Date.now() + 800;
        return;
      }

      const { blocked, data, throttled } = await scrapeContactDetailsStealth(idUI, { force });

      if (throttled && !data) {
        const usedCache = await tryRenderCache();
        if (!usedCache) await renderInsight(null, { throttled:true });
        lastRenderedIdentityByTicket.set(ticketId, idUI);
        ignoreMutationsUntil = Date.now() + 800;
        return;
      }

      await renderInsight(data, { blocked, throttled:false });
      lastRenderedIdentityByTicket.set(ticketId, idUI);
      if (data) hasDataByTicket.set(ticketId, true);
      ignoreMutationsUntil = Date.now() + 800;
    } finally {
      isBusy = false;
    }
  }

  async function forceRender(resetThrottle = false) {
    if (!isTicketPage()) return;
    const ticketId = getTicketId();
    const id = identityFromUI();
    if (resetThrottle && id) lastSuccessfulScrapeById.delete(id);
    lastRenderedIdentityByTicket.delete(ticketId);
    hasDataByTicket.delete(ticketId);
    await maybeRender(true);
  }

  /** ---------- observer & routing ---------- */
  let debounced = null;
  const schedule = (fn, ms = 300) => { if (debounced) clearTimeout(debounced); debounced = setTimeout(() => { debounced=null; fn(); }, ms); };

  const mo = new MutationObserver((mlist) => {
    if (Date.now() < ignoreMutationsUntil) return;
    const relevant = mlist.some(m => !(m.target && m.target.closest && m.target.closest('.cw-gxt-wnd')));
    if (!relevant) return;
    schedule(() => {
      if (!isTicketPage()) { unmountInsightBox(); return; }
      const tid = getTicketId();
      const idUI = identityFromUI();
      const lastId = lastRenderedIdentityByTicket.get(tid) || '';
      if (!idUI || idUI !== lastId || !hasDataByTicket.get(tid)) {
        maybeRender(false);
      }
    }, 200);
  });

  function onRouteChange() {
    if (!isTicketPage()) { unmountInsightBox(); return; }
    until(() => getEmailCell() || getContactButton(), { timeout: 15000 }).then(() => { maybeRender(false); });
  }
  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(onRouteChange); return r; };
  });
  window.addEventListener('popstate', onRouteChange);

  mo.observe(document.body, { childList:true, subtree:true, characterData:true });
  onRouteChange();
})();
