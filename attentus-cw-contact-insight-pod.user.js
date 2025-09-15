// ==UserScript==
// @name         attentus-cw-contact-insight-pod
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.10.1
// @description  Ticket-only contact insight under Company pod Email. No-flash stealth scrape. Publishes a stable API for other userscripts (title/type). Uses cache when throttled, and never overwrites shown data with a hint. Should only re-run on contact change.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-contact-insight-pod.user.js
// ==/UserScript==

(() => {
  'use strict';

  /** ---------- utils ---------- */
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const vis = (el) => !!(el && el.offsetParent && el.getClientRects().length);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const until = async (fn, { timeout = 15000, interval = 120 } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { const v = fn(); if (v) return v; await sleep(interval); }
    return null;
  };
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** ---------- ticket gating ---------- */
  const MIN_TICKET_DIGITS = 5;
  function ticketIdFromUrl() {
    try {
      const u = new URL(location.href);
      const qid = u.searchParams.get('service_recid');
      if (qid && /^\d+$/.test(qid) && qid.length >= MIN_TICKET_DIGITS) return qid;
      const pm = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{5,})/i);
      if (pm && pm[1]) return pm[1];
    } catch {}
    return '';
  }
  function ticketIdFromDom() {
    const labels = document.querySelectorAll('[id$="-label"], .gwt-Label, .mm_label');
    for (const el of labels) {
      if (!vis(el)) continue;
      const m = norm(el.textContent).match(/ticket\s*#\s*(\d{5,})/i);
      if (m) return m[1];
    }
    return '';
  }
  const getTicketId = () => ticketIdFromUrl() || ticketIdFromDom() || '';
  const isTicketPage = () => !!getTicketId();

  /** ---------- storage ---------- */
  const STORAGE_PREFIX = 'attentus:cw:contactInsight:';
  const storageKeyFor = ({ email, ticketId, name }) =>
    `${STORAGE_PREFIX}${(email || '').toLowerCase() || `t-${ticketId || ''}|n-${(name || '').toLowerCase()}`}`;

  /** ---------- contact button state ---------- */
  function getContactButton() { return qa('.cw_ToolbarButton_User').find(el => vis(el)) || null; }
  function contactActionEnabled() {
    const btn = getContactButton(); if (!btn) return false;
    const inner = q('.mm_button', btn);
    const tabBlocked   = inner && inner.getAttribute('tabindex') === '-1';
    const ariaBlocked  = (btn.getAttribute('aria-disabled') === 'true') || (inner && inner.getAttribute('aria-disabled') === 'true');
    const classBlocked = btn.className && /\bdisabled\b/i.test(btn.className);
    return !(tabBlocked || ariaBlocked || classBlocked);
  }

  /** ---------- identity (email preferred) ---------- */
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
          .filter(el => vis(el))
          .slice(0, 12)
          .map(el => ('value' in el ? el.value : el.textContent) || '')
          .map(norm)
          .find(t => t && !/email|phone|company|site time zone/i.test(t) && t.length > 1);
        if (cand) return cand.toLowerCase();
      }
    }
    return '';
  }

  /** ---------- stealth CSS ---------- */
  function ensureStealthStyle() {
    let s = document.getElementById('attentus-stealth-style');
    if (s) return s;
    s = document.createElement('style');
    s.id = 'attentus-stealth-style';
    s.textContent = `body.att-silent-scrape .cw-gxt-wnd{visibility:hidden !important;pointer-events:none !important;opacity:0 !important}`;
    document.documentElement.appendChild(s);
    return s;
  }

  /** ---------- flyout scrape ---------- */
  let SCRAPE_IN_PROGRESS = false;
  const SCRAPE_THROTTLE_MS = 30 * 60 * 1000; // 30m AFTER a successful scrape
  const lastSuccessfulScrapeById = new Map(); // identity -> ts

  const anyContactDialog = () => q('.cw-gxt-wnd .pnlContactDialog'); // no vis check
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
    return {
      name:    pick('.contactName .gwt-Label'),
      company: pick('.companyName .gwt-Label'),
      title:   pick('.title .gwt-Label'),
      type:    pick('.contactType .gwt-Label'),
      email:   pick('.emailContacts .GMDB3DUBF2C, .emailContacts .gwt-Label.GMDB3DUBF2C, .emailContacts .gwt-Label'),
    };
  }

  async function scrapeContactDetailsStealth(identity, { force=false } = {}) {
    const lastOk = lastSuccessfulScrapeById.get(identity) || 0;
    if (!force && (Date.now() - lastOk) < SCRAPE_THROTTLE_MS) {
      return { blocked:false, data:null, throttled:true };
    }

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

      await sleep(160); // let labels populate
      const data = readFromOpenFlyout();

      if (data && (data.title || data.type || data.email || data.name)) {
        lastSuccessfulScrapeById.set(identity, Date.now());
      }
      return { blocked:false, data };
    } finally {
      if (!alreadyOpen) await closeContactFlyout();
      setTimeout(() => document.body.classList.remove('att-silent-scrape'), 30);
      SCRAPE_IN_PROGRESS = false;
    }
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

  /** ---------- UI pod ---------- */
  function ensureInsightBox(afterRow) {
    const id = 'attentus-contact-insight-box';
    const exist = document.getElementById(id);
    if (exist && exist.isConnected) return exist;

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
      marginTop:'6px', padding:'8px', border:'1px solid rgba(0,0,0,0.12)',
      borderRadius:'10px', background:'#f9fafb', boxShadow:'0 1px 2px rgba(0,0,0,0.06)',
      fontSize:'12px', lineHeight:'1.35', display:'grid',
      gridTemplateColumns:'auto 1fr auto', gap:'4px 8px', alignItems:'center'
    });

    const heading = document.createElement('div');
    heading.textContent = 'Contact Insight';
    heading.style.gridColumn = '1 / span 2';
    heading.style.fontWeight = '600';

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.textContent = 'Refresh';
    refresh.dataset.role = 'attentus-refresh';
    Object.assign(refresh.style, {
      gridColumn:'3', justifySelf:'end', fontSize:'11px',
      padding:'2px 6px', border:'1px solid rgba(0,0,0,0.2)',
      borderRadius:'999px', background:'#fff', cursor:'pointer',
      display:'none'
    });
    refresh.addEventListener('click', async () => { await forceRender(true); });

    const titleRow = document.createElement('div'); titleRow.dataset.field='title'; titleRow.style.gridColumn='1 / span 3';
    const typeRow  = document.createElement('div'); typeRow.dataset.field ='type';  typeRow.style.gridColumn ='1 / span 3';
    const badges   = document.createElement('div'); badges.dataset.field   ='badges'; badges.style.gridColumn   ='1 / span 3';
    Object.assign(badges.style, { display:'flex', flexWrap:'wrap', gap:'6px' });

    box.append(heading, refresh, titleRow, typeRow, badges);
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

  // Base badge + per-kind palette
  function badge(text, kind='neutral') {
    const b = document.createElement('span');
    b.textContent = text;
    Object.assign(b.style, {
      fontSize:'11px',
      padding:'2px 6px',
      borderRadius:'999px',
      border:'1px solid',
      fontWeight:'600',
      userSelect:'none'
    });
    // palettes (light bg, mid border, dark text) — accessible contrast
    const palettes = {
      decision: { bg:'#fff7ed', border:'#fdba74', text:'#9a3412' }, // orange
      owner:    { bg:'#ecfeff', border:'#67e8f9', text:'#155e75' }, // cyan
      selective:{ bg:'#f0fdf4', border:'#86efac', text:'#14532d' }, // green
      neutral:  { bg:'#eef2ff', border:'#c7d2fe', text:'#3730a3' }  // indigo
    };
    const p = palettes[kind] || palettes.neutral;
    Object.assign(b.style, { background:p.bg, borderColor:p.border, color:p.text });
    return b;
  }

  const hasDataByTicket = new Map(); // ticketId -> boolean

  async function renderInsight(details, { blocked=false, throttled=false } = {}) {
    if (!isTicketPage()) { unmountInsightBox(); return false; }
    const row = findCompanyEmailRow(); if (!row) return false;

    const box = ensureInsightBox(row);
    setRefreshVisible(contactActionEnabled());

    const titleRow = q('[data-field="title"]', box);
    const typeRow  = q('[data-field="type"]',  box);
    const badges   = q('[data-field="badges"]',box);

    const ticketId = getTicketId();
    const alreadyHasData = hasDataByTicket.get(ticketId) === true;

    // wipe prior render
    titleRow.textContent = '';
    typeRow.textContent  = '';
    badges.textContent   = '';
    box.removeAttribute('data-title');
    box.removeAttribute('data-type');

    const allowHint = !alreadyHasData;

    if (blocked) {
      if (allowHint) {
        titleRow.textContent = 'Select a contact to load insight.';
        titleRow.style.color = '#6b7280';
      }
      publish(ticketId, null);
      return true;
    }

    if (throttled && !details) {
      if (allowHint) {
        titleRow.textContent = 'Info previously loaded. Click Refresh to re-fetch now.';
        titleRow.style.color = '#6b7280';
      }
      publish(ticketId, null);
      return true;
    }

    if (!details) {
      if (allowHint) {
        titleRow.textContent = 'Open the contact flyout or click Refresh to load details.';
        titleRow.style.color = '#6b7280';
      }
      publish(ticketId, null);
      return true;
    }

    const { title, type, email, name } = details;

    // Raw fields (no inference)
    if (title) {
      const label = document.createElement('strong'); label.textContent = 'Job Title: ';
      const val = document.createElement('span'); val.textContent = title;
      titleRow.append(label, val);
    }
    if (type) {
      const label = document.createElement('strong'); label.textContent = 'Type: ';
      const val = document.createElement('span'); val.textContent = type;
      typeRow.append(label, val);
    }

    // ---------- Badges ONLY from Type ----------
    const t = type || '';
    const hasAOwner       = /\bA\.\s*Owner\b/i.test(t);
    const hasBPrimaryDM   = /\bB\.\s*Primary\s+Decision\s+Maker\b/i.test(t);
    const hasCSecondaryDM = /\bC\.\s*Secondary\s+Decision\s+Maker\b/i.test(t);
    const hasSelective    = /\bS\.\s*Selective\s+Approver\b/i.test(t) || /\bSelective\s+Approver\b/i.test(t);

    const showDecision = hasAOwner || hasBPrimaryDM || hasCSecondaryDM;
    const showOwner    = hasAOwner;
    const showSelective= hasSelective;

    if (showDecision) badges.appendChild(badge('Decision Maker', 'decision'));
    if (showOwner)     badges.appendChild(badge('Owner', 'owner'));
    if (showSelective) badges.appendChild(badge('Selective Approver', 'selective'));
    // -------------------------------------------

    if (!title && !type) {
      titleRow.textContent = 'No Job Title/Type found for this contact.';
      titleRow.style.color = '#6b7280';
    }

    // Persist + mark "has data"
    try {
      if (email || name) {
        await GM.setValue(storageKeyFor({ email, ticketId, name }), details);
      }
    } catch {}
    hasDataByTicket.set(ticketId, !!(title || type || email || name));

    publish(ticketId, details);
    return true;
  }

  /** ---------- orchestration ---------- */
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

    if (!force && idUI && lastId && idUI === lastId) return;
    if (isBusy) return;

    isBusy = true;
    try {
      const tryRenderCache = async () => {
        if (/\S+@\S+/.test(idUI)) {
          const cached = await GM.getValue(storageKeyFor({ email:idUI, ticketId })) || null;
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
