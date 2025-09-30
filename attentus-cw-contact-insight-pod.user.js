// ==UserScript==
// @name         attentus-cw-contact-insight-pod
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.18.0
// @description  Contact Insight pod on Service Ticket pages. Resolves contactRecId from Rails SVM, fetches Contact Notes via NotesViewModelAction. Shows title, type badges, and notes UI (auto-open if 1, toggle otherwise). SPA-safe, with board/ticket guardrails and small caches.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// ==/UserScript==

(() => {
  'use strict';

  /** ─────────────────────────────
   * Utilities / globals
   * ───────────────────────────── */
  const q  = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const vis = (el) => !!(el && el.offsetParent && el.getClientRects().length);
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const GMget = async (k, d) => (typeof GM !== 'undefined' && GM.getValue ? GM.getValue(k, d) : GM_getValue(k, d));
  const GMset = async (k, v) => (typeof GM !== 'undefined' && GM.setValue ? GM.setValue(k, v) : GM_setValue(k, v));
  const expose = (k, v) => { try { window[k] = v; } catch {} try { unsafeWindow[k] = v; } catch {} };

  const VER = '1.22.0';
  console.info('[att-contact-insight] loaded v%s', VER);
  expose('__ATT_CI_VER__', VER);
  expose('AttentusContactInsightPing', () => 'OK v' + VER);

  // tiny CSS for fade-in
  (function addCIStyle(){
    if (document.getElementById('att-ci-style')) return;
    const s = document.createElement('style');
    s.id = 'att-ci-style';
    s.textContent = `
      #attentus-contact-insight-box [data-field="jobtitle"],
      #attentus-contact-insight-box [data-field="badges"] { transition: opacity .15s ease-in; }
      #attentus-contact-insight-box .ci-fade0 { opacity: 0.25; }
      #attentus-contact-insight-box .ci-fade1 { opacity: 1; }
    `;
    document.documentElement.appendChild(s);
  })();

  /** ─────────────────────────────
   * Debug
   * ───────────────────────────── */
  const K_DEBUG = 'attentus:cw:contactInsight:debug';
  let DEBUG_ENABLED = false;
  const dbg = (...args) => { if (DEBUG_ENABLED) console.debug('[att-contact-insight]', ...args); };
  (async () => { DEBUG_ENABLED = !!(await GMget(K_DEBUG, false)); dbg('debug enabled'); })();

  /** ─────────────────────────────
   * Page gating (strong guards)
   * ───────────────────────────── */
  function getTicketIdFromHeader() {
    const hdr = q('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header');
    if (!hdr || !vis(hdr)) return null;

    // prefer explicit label node
    const lbl = document.getElementById(hdr.id + '-label') || hdr.nextElementSibling;

    // fallback: search nearby text for "Ticket # <id>"
    const scanNodes = [lbl, hdr, hdr.parentElement, hdr.parentElement?.nextElementSibling].filter(Boolean);
    for (const n of scanNodes) {
      const text = norm(n.textContent || '');
      const m = text.match(/\bTicket\s*#\s*(\d{3,})\b/i);
      if (m) return m[1];
    }
    return null;
  }
  function getTicketIdFromUrl() {
    try {
      const u = new URL(location.href);
      const p = u.searchParams;
      const idQ = p.get('service_recid') || p.get('srRecID') || p.get('recid');
      if (idQ && /^\d{3,}$/.test(idQ)) return idQ;
      const m = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{3,})/i);
      return m ? m[1] : null;
    } catch { return null; }
  }
  function getTicketId() {
    return getTicketIdFromHeader() || getTicketIdFromUrl();
  }

  // Treat as ticket page if we either have a ticket id (header OR URL) OR we can
  // already see a ticket header pod. Service Board won't satisfy either.
  function isTicketPage() {
    return !!(getTicketId() || q('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header'));
  }

/** ─────────────────────────────
 * Anchor: Company pod + robust row detection
 * ───────────────────────────── */

// 1) Company pod header/body (from map + fallbacks)
function findCompanyPodHeader() {
  const el = q('.mm_podHeader.pod_service_ticket_company_header, .pod_service_ticket_company_header');
  return el && vis(el) ? el : null;
}
function findCompanyPodBody() {
  // Body often renders before/after header depending on SPA timing
  const body = q('.pod_service_ticket_company');
  return body && vis(body) ? body : null;
}

// Find the container we should scan within (body if possible, else the region after the header until next pod)
function getCompanyPodContainer() {
  const body = findCompanyPodBody();
  if (body) return body;
  const header = findCompanyPodHeader();
  if (!header) return null;
  // Collect siblings until the next pod header
  const frag = document.createElement('div');
  for (let n = header.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList?.contains('mm_podHeader')) break;
    frag.appendChild(n.cloneNode(true)); // safe clone to scan structure/text without messing layout
  }
  return frag.childNodes.length ? frag : null;
}

// Utility: normalize label text (strip punctuation/colon)
const labelNorm = (el) => (norm(el.textContent || '')
  .replace(/[:：]\s*$/, '')
  .toLowerCase());

// 2) Robust label matchers (handles “Email Address”, “E-mail”, localized forms, etc.)
function findRowByLooseLabel(root, want) {
  if (!root) return null;
  const wantRx = want === 'email'
    ? /^(e[-\s]?mail|email|email address|correo|mail)$/i
    : /^(contact|primary contact|kontakt|contato)$/i;

  // Prefer explicit label elements first
  const labCandidates = qa('[id$="-label"], .mm_label, .cw_CwLabel, label, .gwt-Label', root)
    .filter(vis);

  for (const lab of labCandidates) {
    const t = labelNorm(lab);
    if (wantRx.test(t)) {
      const row = lab.closest('tr') || lab.closest('.pod-element-row') || lab.parentElement;
      if (row && vis(row)) return row;
    }
  }

  // Fallback: cells/divs that *start with* the desired label
  const loose = qa('td, div, span', root).filter(el => {
    if (!vis(el)) return false;
    const t = labelNorm(el);
    return (want === 'email'
      ? /^e[-\s]?mail/.test(t) || /^email address/.test(t)
      : /^contact/.test(t) || /^primary contact/.test(t));
  });
  for (const el of loose) {
    const row = el.closest('tr') || el.closest('.pod-element-row') || el.parentElement;
    if (row && vis(row)) return row;
  }
  return null;
}

// 3) Value-first heuristics (when label is missing/hidden)
function findRowByEmailValue(root) {
  if (!root) return null;

  // mailto link is the strongest signal
  const mailto = qa('a[href^="mailto:"], a[href^="MAILTO:"], a[title*="@"]', root).find(vis);
  if (mailto) {
    const row = mailto.closest('tr') || mailto.closest('.pod-element-row');
    if (row && vis(row)) return row;
  }

  // raw email-looking text node in a value cell
  const emailRx = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const textCells = qa('td, div, span', root).filter(el => vis(el) && emailRx.test(el.textContent || ''));
  for (const cell of textCells) {
    const row = cell.closest('tr') || cell.closest('.pod-element-row');
    if (row && vis(row)) return row;
  }

  // contact link (often navigates to contact detail)
  const contactish = qa('a[href*="contact"], a[title*="Contact"], a:has(> .mm_icon_user)', root).find(vis);
  if (contactish) {
    const row = contactish.closest('tr') || contactish.closest('.pod-element-row');
    if (row && vis(row)) return row;
  }
  return null;
}

// 4) Public API used by the script
function companyPodRegionSiblings() {
  // kept for backward compat — we now prefer getCompanyPodContainer()
  const header = findCompanyPodHeader();
  if (!header) return null;
  const region = [];
  for (let n = header.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList?.contains('mm_podHeader')) break; // stop at next pod
    region.push(n);
  }
  return region.length ? region : null;
}

function findCompanyRowByLabel(label) {
  // preserve existing signature; use hardened matcher internally
  const container = getCompanyPodContainer();
  if (!container) return null;
  const want = label.toLowerCase();
  if (want === 'email') {
    return findRowByLooseLabel(container, 'email') || findRowByEmailValue(container);
  }
  if (want === 'contact') {
    return findRowByLooseLabel(container, 'contact') || findRowByEmailValue(container);
  }
  return null;
}

const findEmailRow   = () => findCompanyRowByLabel('email');
const findContactRow = () => findCompanyRowByLabel('contact');
const findAnchorRow  = () => findEmailRow() || findContactRow();


  /** ─────────────────────────────
   * Rails helpers
   * ───────────────────────────── */
  const normPath = () => (location.pathname.match(/\/v\d+_\d+/) || ['', ''])[0];
  const cwBase   = () => location.origin + normPath();

  async function postRails(url, actionMessage) {
    const body = new URLSearchParams({
      actionMessage: JSON.stringify(actionMessage),
      clientTimezoneOffset: String(-new Date().getTimezoneOffset()),
      clientTimezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    }).toString();
    const r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function fetchTicketSVM(ticketId) {
    const url = `${cwBase()}/services/system_io/actionprocessor/Service/GetServiceTicketDetailViewAction.rails`;
    const actionMessage = {
      payload: JSON.stringify({ serviceRecId: Number(ticketId) }),
      payloadClassName: 'GetServiceTicketDetailViewAction',
      project: 'ServiceCommon'
    };
    const j = await postRails(url, actionMessage);
    const svm = j?.data?.action?.serviceTicketViewModel || null;
    dbg('SVM fetched?', !!svm);
    return svm;
  }

  function resolveContactRecIdFromSVM(svm) {
    const pick = (v) => (v && Number(v) > 0) ? String(v) : null;
    if (!svm) return null;
    let id =
      pick(svm?.initialDescriptionPod?.discussion?.contactRecId) ||
      pick(svm?.companyPodViewModel?.contact?.core_Entity_Contact_ID) ||
      pick(svm?.companyPodViewModel?.contactRecId) ||
      pick(svm?.companyPod?.contactViewModel?.contactRecId) ||
      pick(svm?.companyPod?.companyViewModel?.primaryContactRecId) ||
      pick(svm?.companyPod?.companyViewModel?.defaultContactRecId) ||
      pick(svm?.companyPod?.companyViewModel?.contactRecId) ||
      pick(svm?.contactPod?.contactViewModel?.contactRecId);

    if (id) return id;

    const mex = svm?.resourcePod?.resourceViewModel?.meetingExternals || [];
    const primary = mex.find(m => m?.isPrimaryContact || /primary/i.test(m?.type || ''));
    if (primary?.contactRecID) return String(primary.contactRecID);
    const first = mex.find(m => m?.contactRecID);
    if (first?.contactRecID) return String(first.contactRecID);
    return null;
  }

  function resolveContactMetaFromSVM(svm) {
    const meta = { title: '', type: '' };
    try {
      meta.title =
        svm?.companyPodViewModel?.contact?.title ||
        svm?.companyPod?.contactViewModel?.title ||
        svm?.contactPod?.contactViewModel?.title || '';
      meta.type =
        svm?.companyPodViewModel?.contact?.type ||
        svm?.companyPod?.contactViewModel?.type ||
        svm?.contactPod?.contactViewModel?.type || '';
    } catch {}
    return meta;
  }

  async function fetchContactNotes(contactRecId) {
    const url = `${cwBase()}/services/system_io/actionprocessor/ServerCommon/NotesViewModelAction.rails`;
    const actionMessage = {
      payload: JSON.stringify({ recordID: Number(contactRecId), screenID: 'ct300' }),
      payloadClassName: 'NotesViewModelAction',
      project: 'ServerCommon'
    };
    const j = await postRails(url, actionMessage);
    const notes = j?.data?.action?.notesViewModel?.notes || [];
    const clean = notes.filter(n => n?.note).map(n => ({
      type: n.noteTypeName || n.noteType?.name || '',
      note: n.note || '',
      updated: n.lastUpdate ? new Date(n.lastUpdate).toLocaleDateString() : '',
      by: n.updatedBy || ''
    }));
    return clean;
  }

  /** ─────────────────────────────
   * Optional meta via hidden flyout (fallback)
   * ───────────────────────────── */
  function getContactButton() { return qa('.cw_ToolbarButton_User').find(el => vis(el)) || null; }
  function contactActionEnabled() {
    const btn = getContactButton(); if (!btn) return false;
    const inner = q('.mm_button', btn);
    const tabBlocked   = inner && inner.getAttribute('tabindex') === '-1';
    const ariaBlocked  = (btn.getAttribute('aria-disabled') === 'true') || (inner && inner.getAttribute('aria-disabled') === 'true');
    const classBlocked = btn.className && /\bdisabled\b/i.test(btn.className);
    return !(tabBlocked || ariaBlocked || classBlocked);
  }
  function ensureStealthStyle() {
    if (document.getElementById('attentus-stealth-style')) return;
    const s = document.createElement('style');
    s.id = 'attentus-stealth-style';
    s.textContent = `body.att-silent-scrape .cw-gxt-wnd{visibility:hidden !important;pointer-events:none !important;opacity:0 !important}`;
    document.documentElement.appendChild(s);
  }
  const anyContactDialog = () => q('.cw-gxt-wnd .pnlContactDialog');
  const anyCloseIcon     = () => q('.cw-gxt-wnd .x-panel-toolbar .mm_icon');

  async function openContactFlyout() {
    const btn = getContactButton();
    if (!btn || !contactActionEnabled()) return false;
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) { if (anyContactDialog()) return true; await sleep(80); }
    return false;
  }
  async function closeContactFlyout() {
    const x = anyCloseIcon();
    if (x) x.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true }));
    await sleep(60);
    document.body.click();
    await sleep(50);
  }
  function readMetaFromOpenFlyout() {
    const dlg = anyContactDialog();
    if (!dlg) return { title:'', type:'' };
    const title = (q('.title .gwt-Label', dlg)?.textContent || '').trim();
    const type  = (q('.contactType .gwt-Label', dlg)?.getAttribute('title') || q('.contactType .gwt-Label', dlg)?.textContent || '').trim();
    return { title, type };
  }

  let FLYOUT_BUSY = false;
  const META_CACHE_MS = 30 * 60 * 1000;
  const metaCacheByContact = new Map(); // id -> {title, type, ts}

  async function ensureContactMeta(contactRecId, metaSeed = {}) {
    const cached = metaCacheByContact.get(contactRecId);
    if (cached && (Date.now() - cached.ts) < META_CACHE_MS) return cached;

    let title = metaSeed.title || '';
    let type  = metaSeed.type || '';

    if (!title || !type) {
      if (FLYOUT_BUSY) return { title, type, ts: Date.now() };
      try {
        ensureStealthStyle();
        document.body.classList.add('att-silent-scrape');
        FLYOUT_BUSY = true;
        const opened = await openContactFlyout();
        if (opened) {
          await sleep(120);
          const fromFly = readMetaFromOpenFlyout();
          title = title || fromFly.title || '';
          type  = type  || fromFly.type  || '';
        }
      } finally {
        await closeContactFlyout();
        setTimeout(() => document.body.classList.remove('att-silent-scrape'), 30);
        FLYOUT_BUSY = false;
      }
    }

    const snap = { title, type, ts: Date.now() };
    metaCacheByContact.set(contactRecId, snap);
    return snap;
  }

  /** ─────────────────────────────
   * UI elements
   * ───────────────────────────── */
  function badgeEl(text, { kind='neutral', asButton=false, title='' } = {}) {
    const el = asButton ? document.createElement('button') : document.createElement('span');
    el.textContent = text;
    if (title) el.title = title;
    if (asButton) { el.type = 'button'; el.style.cursor = 'pointer'; }
    Object.assign(el.style, {
      fontSize:'11px', padding:'2px 6px', borderRadius:'999px', border:'1px solid',
      fontWeight:'600', userSelect:'none', background:'#fff'
    });
    const palettes = {
      decision: { bg:'#fff7ed', border:'#fdba74', text:'#9a3412' },
      owner:    { bg:'#ecfeff', border:'#67e8f9', text:'#155e75' },
      selective:{ bg:'#f0fdf4', border:'#86efac', text:'#14532d' },
      neutral:  { bg:'#f8fafc', border:'#cbd5e1', text:'#334155' },
      info:     { bg:'#eef2ff', border:'#c7d2fe', text:'#3730a3' }
    };
    const p = palettes[kind] || palettes.neutral;
    Object.assign(el.style, { background:p.bg, borderColor:p.border, color:p.text });
    return el;
  }
  function noteCard(n) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { border:'1px solid rgba(0,0,0,.08)', borderRadius:'8px', padding:'8px 10px', background:'#fafafa' });
    const meta = document.createElement('div');
    meta.style.fontSize = '11px'; meta.style.opacity = '0.85'; meta.style.marginBottom = '6px';
    meta.textContent = [n.type, n.updated, n.by].filter(Boolean).join(' • ');
    const note = document.createElement('div');
    note.style.whiteSpace = 'pre-wrap'; note.style.wordBreak = 'break-word';
    note.textContent = n.note;
    wrap.append(meta, note);
    return wrap;
  }

function ensureInsightBox(afterRow) {
  if (!(afterRow && afterRow.parentElement)) return null;

  const id = 'attentus-contact-insight-box';
  const exist = document.getElementById(id);

  // If we already have a box, re-home it to be directly after the current anchor
  if (exist && exist.isConnected) {
    if (afterRow.tagName === 'TR') {
      const currTr = exist.closest('tr');
      if (!currTr || currTr.previousElementSibling !== afterRow) {
        const tr = currTr || document.createElement('tr');
        const td = currTr ? currTr.firstElementChild : document.createElement('td');
        if (!currTr) {
          td.colSpan = Math.max(2, afterRow.children.length || 2);
          tr.appendChild(td);
          td.appendChild(exist);
        }
        afterRow.insertAdjacentElement('afterend', tr);
      }
    } else {
      const currContainer = exist.parentElement;
      if (currContainer && currContainer.previousElementSibling !== afterRow) {
        afterRow.insertAdjacentElement('afterend', exist);
      }
    }
    return exist;
  }

  // Create new container after the anchor
  let host;
  if (afterRow.tagName === 'TR' || afterRow.classList.contains('pod-element-row')) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = Math.max(2, afterRow.children.length || 2);
    tr.appendChild(td);
    afterRow.insertAdjacentElement('afterend', tr);
    host = td;
  } else {
    // Non-table layout fallback
    const slot = document.createElement('div');
    afterRow.insertAdjacentElement('afterend', slot);
    host = slot;
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
    background:'rgba(15,23,42,0.04)',
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
    width:'22px',
    height:'22px',
    lineHeight:'20px',
    textAlign:'center',
    border:'1px solid rgba(0,0,0,0.25)',
    borderRadius:'999px',
    background:'#fff',
    gridColumn:'3',
    justifySelf:'end',
    cursor:'pointer'
  });
  refresh.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation(); await forceRender(true);
  });

  const badges = document.createElement('div');
  badges.dataset.field = 'badges';
  Object.assign(badges.style, {
    gridColumn:'1 / -1',
    display:'flex',
    flexWrap:'wrap',
    gap:'6px',
    alignItems:'center'
  });

  const notesWrap = document.createElement('div');
  notesWrap.dataset.role = 'notes-wrap';
  Object.assign(notesWrap.style, {
    gridColumn:'1 / -1',
    display:'none',
    marginTop:'6px'
  });
  notesWrap.innerHTML = `
    <div style="font-weight:600;margin:2px 0 6px;">Contact Notes</div>
    <div data-role="notes-content" style="display:grid;gap:10px;"></div>
    <div data-role="notes-footer" style="margin-top:6px;display:none;"></div>
  `;

  const status = document.createElement('div');
  status.dataset.role = 'attentus-status';
  Object.assign(status.style, {
    gridColumn:'1 / -1',
    fontSize:'11px',
    color:'#64748b',
    marginTop:'6px',
    display: DEBUG_ENABLED ? 'block' : 'none'
  });

  box.append(heading, titleLine, refresh, badges, notesWrap, status);
  host.appendChild(box);
  return box;
}


  function unmountInsightBox() {
    const box = document.getElementById('attentus-contact-insight-box');
    if (box) { const tr = box.closest('tr'); if (tr) tr.remove(); else box.remove(); }
  }

  function setStatus({ ticketId, source, contactRecId, candidates, notesCount }) {
    const box = document.getElementById('attentus-contact-insight-box');
    if (!box) return;
    const el = q('[data-role="attentus-status"]', box);
    if (!el) return;
    el.style.display = DEBUG_ENABLED ? 'block' : 'none';
    if (!DEBUG_ENABLED) return;
    const parts = [];
    if (ticketId) parts.push(`ticket:${ticketId}`);
    if (typeof source === 'string') parts.push(`source:${source}`);
    if (contactRecId) parts.push(`id:${contactRecId}`);
    if (typeof candidates === 'number') parts.push(`candidates:${candidates}`);
    if (typeof notesCount === 'number') parts.push(`notes:${notesCount}`);
    el.textContent = parts.join(' • ');
  }

  /** ─────────────────────────────
   * Notes UI
   * ───────────────────────────── */
  const notesCacheByContact = new Map(); // contactId -> { notes, ts }
  const NOTES_CACHE_MS = 2 * 60 * 1000;

  async function setupNotesUI(contactRecId) {
    const box = document.getElementById('attentus-contact-insight-box'); if (!box) return 0;
    const badges = q('[data-field="badges"]', box); if (!badges) return 0;
    const wrap   = q('[data-role="notes-wrap"]', box);
    const content= q('[data-role="notes-content"]', wrap);
    const footer = q('[data-role="notes-footer"]', wrap);

    let notes = [];
    const cache = notesCacheByContact.get(contactRecId);
    if (cache && (Date.now() - cache.ts) < NOTES_CACHE_MS) {
      notes = cache.notes;
    } else {
      try {
        notes = await fetchContactNotes(contactRecId);
        notesCacheByContact.set(contactRecId, { notes, ts: Date.now() });
      } catch (e) { dbg('notes fetch error', e); notes = []; }
    }

    wrap.style.display = 'none';
    content.textContent = '';
    footer.textContent = '';

    // remove/replace button safely
    const existingBtn = q('[data-role="attentus-notes-toggle"]', badges);
    if (existingBtn && existingBtn.parentNode) existingBtn.parentNode.removeChild(existingBtn);

    if (!notes.length) return 0;

    const notesBtn = badgeEl(`Notes (${notes.length})`, { kind:'info', asButton:true, title:'Show/Hide recent contact notes' });
    notesBtn.dataset.role = 'attentus-notes-toggle';
    badges.prepend(notesBtn);
    Object.assign(notesBtn.style, {
      background: '#fff7db', borderColor: '#f59e0b', color: '#111827', fontWeight: '600', padding: '3px 8px',
      boxShadow: '0 1px 0 rgba(0,0,0,.05), 0 0 0 3px rgba(245,158,11,.20) inset'
    });
    notesBtn.textContent = `📝 Notes (${notes.length})`;

    notesBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const showing = wrap.style.display !== 'none';
      wrap.style.display = showing ? 'none' : 'block';
    });

    notes.forEach(n => content.appendChild(noteCard(n)));


    const shouldOpen = notes.length === 1;
    wrap.style.display = shouldOpen ? 'block' : 'none';
    return notes.length;
  }

  /** ─────────────────────────────
   * Badges logic (idempotent)
   * ───────────────────────────── */
  function applyTypeBadges(badgesEl, rawType) {
    if (!badgesEl) return;
    badgesEl.querySelectorAll('[data-att-badge]').forEach(n => n.remove()); // wipe our badges only
    const add = (label, kind) => {
      const b = badgeEl(label, { kind });
      b.setAttribute('data-att-badge','');
      badgesEl.appendChild(b);
    };

    const lc = String(rawType || '').toLowerCase();
    const isOwner          = /\bowner\b/.test(lc) || /\ba\.\s*owner\b/.test(lc);
    const isPrimaryDM      = /\bprimary\s*decision\s*maker\b/.test(lc) || /\bb\.\s*primary\s*decision\s*maker\b/.test(lc);
    const isSecondaryDM    = /\bsecondary\s*decision\s*maker\b/.test(lc) || /\bc\.\s*secondary\s*decision\s*maker\b/.test(lc);
    const isSelective      = /\bselective\s*approver\b/.test(lc) || /\bs\.\s*selective\s*approver\b/.test(lc);
    const isPrimaryContact = /\bprimary\s*contact\b/.test(lc);
    const isSecondaryCont  = /\bsecondary\s*contact\b/.test(lc);
    const isEmployee       = /\bmanaged\s*employee\b/.test(lc) || /\bemployee\b/.test(lc);
    const isContractor     = /\bcontractor\b/.test(lc);
    const isVendor         = /\bvendor\b/.test(lc);

    const anyDM = isOwner || isPrimaryDM || isSecondaryDM;
    if (anyDM) add('Decision Maker', 'decision');
    if (isOwner) add('Owner', 'owner');
    if (!anyDM) {
      if (isSelective)            add('Selective Approver', 'selective');
      else if (isPrimaryContact)  add('Primary Contact',  'neutral');
      else if (isSecondaryCont)   add('Secondary Contact','neutral');
      else if (isEmployee)        add('Employee',         'neutral');
      else if (isContractor)      add('Contractor',       'neutral');
      else if (isVendor)          add('Vendor',           'neutral');
    }
  }

  /** ─────────────────────────────
   * Render & orchestration
   * ───────────────────────────── */
  const hasDataByTicket = new Map();        // ticketId -> boolean
  let currentTicketId = '';

  async function renderInsight({ ticketId, contactRecId, metaSource }) {
    if (!isTicketPage()) { unmountInsightBox(); return; }
    const anchor = findAnchorRow(); if (!anchor) { dbg('anchor not ready'); return; }
    const box = ensureInsightBox(anchor); if (!box) return;

    const badges = q('[data-field="badges"]', box);
    const titleLine = q('[data-field="jobtitle"]', box);

    // reset per render
    badges.classList.remove('ci-fade0','ci-fade1');
    titleLine.classList.remove('ci-fade0','ci-fade1');
    // do NOT wipe badges textContent (so Notes button survives). We only clear our badges in applyTypeBadges.

    const tid = ticketId || getTicketId();
    if (!contactRecId) {
      setStatus({ ticketId: tid, source: 'none', contactRecId: null, candidates: 0, notesCount: 0 });
      hasDataByTicket.set(tid, true);
      return;
    }

    // skeleton title (only)
    titleLine.style.display = 'block';
    titleLine.textContent = '…';
    titleLine.classList.add('ci-fade0');

    // 1) render notes immediately
    let notesCount = 0;
    try { notesCount = await setupNotesUI(contactRecId); } catch(e) { dbg('notes ui err', e); }

    // 2) fetch meta and apply (append badges; keep notes button)
    (async () => {
      try {
        const snap = await ensureContactMeta(contactRecId, metaSource || {});
        // title
        if (snap.title) {
          titleLine.textContent = `Title: ${snap.title}`;
          titleLine.title = snap.title;
          titleLine.style.display = 'block';
          titleLine.classList.remove('ci-fade0');
          requestAnimationFrame(()=>titleLine.classList.add('ci-fade1'));
        } else {
          titleLine.textContent = '';
          titleLine.style.display = 'none';
        }
        // badges
        if (snap.type) {
          applyTypeBadges(badges, snap.type);
          badges.classList.remove('ci-fade0');
          requestAnimationFrame(()=>badges.classList.add('ci-fade1'));
        } else {
          applyTypeBadges(badges, ''); // wipe our badges if any
        }
      } catch(e) {
        dbg('meta load err', e);
        titleLine.textContent = '';
        titleLine.style.display = 'none';
        applyTypeBadges(q('[data-field="badges"]', box), ''); // wipe our badges
      }
      setStatus({ ticketId: tid, source: metaSource?._source || 'svm', contactRecId, candidates: contactRecId ? 1 : 0, notesCount });
      hasDataByTicket.set(tid, true);
    })();
  }

  async function maybeRender(force = false) {
    if (!isTicketPage()) { currentTicketId = ''; unmountInsightBox(); return; }

    const tid = getTicketId();
    if (!tid) return;

    // ensure anchor belongs to the ticket page (prevents service-board injection)
    let anchor = findAnchorRow();
    if (!anchor) {
      dbg('anchor not ready — waiting');
      anchor = await waitForAnchorRow(8000);
      if (!anchor) { dbg('anchor not found after wait'); return; }
    }

    if (!force && hasDataByTicket.get(tid)) { ensureInsightBox(findAnchorRow()); return; }

    try {
      const svm = await fetchTicketSVM(tid);
      const id = resolveContactRecIdFromSVM(svm);
      const metaSeed = resolveContactMetaFromSVM(svm); metaSeed._source = 'svm';
      await renderInsight({ ticketId: tid, contactRecId: id || null, metaSource: metaSeed });
    } catch (e) {
      dbg('maybeRender error', e);
      await renderInsight({ ticketId: tid, contactRecId: null, metaSource: {_source:'error'} });
    }
  }

  async function forceRender(clearTicketCache = false) {
    if (!isTicketPage()) { currentTicketId = ''; unmountInsightBox(); return; }
    const tid = getTicketId();
    if (!tid) return;
    if (clearTicketCache) hasDataByTicket.delete(tid);
    await maybeRender(true);
  }

  function waitForAnchorRow(maxMs = 10000) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const tick = () => {
        if (!isTicketPage()) return resolve(null);
        const row = findAnchorRow();
        if (row) return resolve(row);
        if (Date.now() - t0 >= maxMs) return resolve(null);
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  /** ─────────────────────────────
   * Observers & routing (strong guards)
   * ───────────────────────────── */
  function onRouteChangeInternal() {
    if (!isTicketPage()) {
      currentTicketId = '';
      unmountInsightBox();
      return;
    }

    // Always start an anchor waiter on route changes
    waitForAnchorRow(8000).then(() => {
      if (isTicketPage()) maybeRender(false);
    });

    const tid = getTicketId(); // CHANGED: consider URL-derived IDs too
    if (tid && tid !== currentTicketId) {
      currentTicketId = tid;
      hasDataByTicket.delete(tid);

      // clear stale title/badges to avoid ghost carryover
      const box = document.getElementById('attentus-contact-insight-box');
      if (box) {
        const title = q('[data-field="jobtitle"]', box);
        const badges = q('[data-field="badges"]', box);
        if (title) { title.textContent = ''; title.style.display = 'none'; }
        if (badges) badges.textContent = '';
      }

      maybeRender(true);
    } else {
      // fire a few nudges only when on a ticket
      [0, 200, 600, 1200].forEach(ms =>
        setTimeout(() => { if (isTicketPage()) maybeRender(false); }, ms)
      );
    }
  }

  const onRouteChange = () => queueMicrotask(onRouteChangeInternal);

  // Reset when the ticket header text changes (ticket switch)
  (function watchTicketHeader() {
    const moHeader = new MutationObserver(() => {
      if (!isTicketPage()) { currentTicketId = ''; unmountInsightBox(); return; }
      const tid = getTicketId(); // CHANGED: use getTicketId (header or URL)
      if (tid && tid !== currentTicketId) {
        currentTicketId = tid;
        hasDataByTicket.delete(tid);
        maybeRender(true);
      }
    });
    moHeader.observe(document.documentElement, { subtree:true, childList:true, characterData:true });
  })();

  // General DOM observer (ignore inside our box; only when on ticket and have current id)
  const mo = new MutationObserver((mlist) => {
    if (!isTicketPage()) return;
    if (!currentTicketId) return;
    const relevant = mlist.some(m => {
      const t = m.target && m.target.nodeType === 1 ? m.target : null;
      return !(t && t.closest && t.closest('#attentus-contact-insight-box'));
    });
    if (!relevant) return;
    setTimeout(() => { if (isTicketPage()) maybeRender(false); }, 200);
  });
  mo.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:['aria-busy','hidden'] });

  // SPA hooks
  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); onRouteChange(); return r; };
  });
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(() => maybeRender(false), 120); });
  window.addEventListener('focus', () => setTimeout(() => maybeRender(false), 120), { passive:true });

  // Kickoff
  onRouteChange();

  /** ─────────────────────────────
   * Debug / Menu
   * ───────────────────────────── */
  const _debugApi = {
    enable:  async (v) => { const vv = (v === undefined) ? true : !!v; await GMset(K_DEBUG, vv); DEBUG_ENABLED = vv; console.info('[att-contact-insight] debug', vv); const st = q('#attentus-contact-insight-box [data-role="attentus-status"]'); if (st) st.style.display = vv ? 'block' : 'none'; },
    disable: async ()   => { await GMset(K_DEBUG, false); DEBUG_ENABLED = false; console.info('[att-contact-insight] debug', false); const st = q('#attentus-contact-insight-box [data-role="attentus-status"]'); if (st) st.style.display = 'none'; },
    refresh: async ()   => { await forceRender(true); }
  };
  expose('AttentusContactInsightDebug', _debugApi);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Contact Insight: Toggle Debug', async () => {
      const cur = !!(await GMget(K_DEBUG, false));
      await _debugApi.enable(!cur);
    });
    GM_registerMenuCommand('Contact Insight: Refresh', () => _debugApi.refresh());
  }
})();
