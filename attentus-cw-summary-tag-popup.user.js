// ==UserScript==
// @name         attentus-cw-summary-tag-popup
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.6.2
// @description  Popup that appends "<Sch M/D @ HH:MM TZ>" (24h + TZ) for timed future appts or "<Rem M/D>" for date-only rows; one click then hides. Uses CT for Logan Horsley, otherwise PT.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = 'v162';
  const MAX_SUMMARY = 100;
  const POPUP_ID = 'att-schrem-popup';

  // SPA state
  let ranForThisView = false;
  let anchorObserver = null;
  let spaMO = null;
  let anchorWindowTimer = null;
  let runScheduledAt = 0;
  let dirty = false;
  let idleScheduled = false;

  // ---------- tiny utils ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const text = el => (el && el.textContent || '').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el => !!(el && el.offsetParent !== null);
  const nowMs = () => Date.now();
  const inModal = el => !!(el && el.closest && el.closest('.cw-gxt-wnd'));

  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // ---------- ticket id memory ----------
  function getTicketId() {
    try {
      const url = new URL(location.href);
      const id = url.searchParams.get('srRecID') ||
                 url.searchParams.get('serviceTicketId') ||
                 url.searchParams.get('recid') ||
                 url.searchParams.get('service_recid');
      if (id && /^\d{3,}$/.test(id)) return id;
    } catch {}
    const banner = Array.from(document.querySelectorAll('.cw_CwLabel,.gwt-Label'))
      .map(el => text(el)).find(t => /service\s*ticket\s*#\s*\d+/i.test(t || ''));
    const m = banner && banner.match(/#\s*(\d{3,})/);
    return m ? m[1] : null;
  }
  const memKey = (ticketId, tag) => `att_schrem_${VERSION}_${ticketId || 'unknown'}_${tag}`;
  const shouldShow = (ticketId, tag) => {
    try {
      const v = sessionStorage.getItem(memKey(ticketId, tag));
      return v !== 'done' && v !== 'dismissed';
    } catch { return true; }
  };
  const remember = (ticketId, tag, val) => { try { sessionStorage.setItem(memKey(ticketId, tag), val); } catch {} };

  // ---------- summary ----------
  function findSummaryInput() {
    return $('input.cw_PsaSummaryHeader') ||
           $('input.GMDB3DUBCEI.cw_CwTextField.cw_PsaSummaryHeader') ||
           null;
  }

  // Remove any trailing "<Sch ...>" or "<Rem ...>"
  function removeExistingTagAtEnd(v) {
    return (v || '').replace(/\s*<\s*(?:Sch|Rem)\b[^>]*>\s*$/i, '').trimEnd();
  }

  // Suppress popup if *any* <Sch... or <Rem... appears anywhere
  function hasAnySchRemTagAnywhere(v) {
    return /<\s*(?:Sch|Rem)\b/i.test(v || '');
  }

  function appendTag(tag) {
    const inp = findSummaryInput();
    if (!inp) return false;
    if (hasAnySchRemTagAnywhere(inp.value)) return true; // don't stack tags

    const cur = inp.value || '';
    const sameEnd = new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$','i').test(cur);
    if (sameEnd) return true;

    let base = removeExistingTagAtEnd(cur);
    const allowed = Math.max(0, MAX_SUMMARY - tag.length);
    if (base.length > allowed) base = base.slice(0, allowed).trimEnd();
    const next = (base + tag).slice(0, MAX_SUMMARY);
    if (next === cur) return true;
    inp.value = next;
    dispatchAll(inp);
    return true;
  }

  // ---------- parse date rows ----------
  const RE_FULL = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  const RE_SHORT_END = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  const RE_DATE_ONLY = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/i;

  function toLocalDate(y, M, D, h = 0, m = 0, ampm = null) {
    const year  = +y, month = +M - 1, day = +D;
    let hour = h == null ? 0 : (+h % 12);
    if (ampm && /pm/i.test(ampm)) hour += 12;
    const min  = m == null ? 0 : +m;
    const d = new Date(year, month, day, hour, min, 0, 0);
    return isNaN(d) ? null : d;
  }

  function parseCellText(s) {
    if (!s) return null;
    s = s.trim();

    let m = s.match(RE_FULL);
    if (m) {
      const start = toLocalDate(m[3], m[1], m[2], m[4], m[5], m[6]);
      const end   = toLocalDate(m[9], m[7], m[8], m[10], m[11], m[12]);
      if (start && end) return { kind: 'time', start, end };
    }

    m = s.match(RE_SHORT_END);
    if (m) {
      const start = toLocalDate(m[3], m[1], m[2], m[4], m[5], m[6]);
      const end   = toLocalDate(m[3], m[1], m[2], m[7], m[8], m[9]);
      if (start && end) return { kind: 'time', start, end };
    }

    m = s.match(RE_DATE_ONLY);
    if (m) {
      const date = toLocalDate(m[3], m[1], m[2], 0, 0, null);      // start of day
      const endD = toLocalDate(m[6], m[4], m[5], 23, 59, null);    // end of day
      if (date && endD) return { kind: 'date', date, endOfDay: endD };
    }

    return null;
  }

  // ---------- owner + timezone formatting ----------
  function norm(s){ return String(s||'').replace(/\s+/g,' ').trim(); }

  function getTicketOwnerName() {
    // 1) Direct input (if present)
    const direct = $('input.cw_ticketOwner');
    if (direct && direct.value) return norm(direct.value);

    // 2) Pod row labeled "Owner" (stable label/value pattern)
    const rows = $$('.pod-element-row');
    for (const row of rows) {
      const lbl = $('.mm_label, .cw_CwLabel, [id$="-label"], .gwt-Label', row);
      const t = norm(lbl && lbl.textContent);
      if (/^owner:?$/i.test(t)) {
        const v = row.querySelector('input[type="text"], .gwt-Label, .gwt-HTML, .cw_CwTextField, div, span');
        const val = v && ('value' in v ? v.value : v.textContent);
        if (val) return norm(val);
      }
    }

    // 3) Last-chance scan for any label “Owner” then sibling value
    const labels = $$('.mm_label, .cw_CwLabel, [id$="-label"], .gwt-Label');
    for (const el of labels) {
      if (!/owner:?/i.test(norm(el.textContent))) continue;
      const row = el.closest('tr, .pod-element-row, .gwt-Panel, .x-form-item, div');
      const v = row && row.querySelector('input[type="text"], .gwt-Label, .gwt-HTML, .cw_CwTextField, div, span');
      const val = v && ('value' in v ? v.value : v.textContent);
      if (val) return norm(val);
    }
    return '';
  }

  function partsInZone(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
    const parts = fmt.formatToParts(date).reduce((a,p)=>{a[p.type]=p.value;return a;}, {});
    return {
      month: String(parts.month||'').replace(/^0/,'') || String(date.getMonth()+1),
      day:   String(parts.day||'').replace(/^0/,'')   || String(date.getDate()),
      hour:  parts.hour || String(date.getHours()).padStart(2,'0'),
      minute: parts.minute || String(date.getMinutes()).padStart(2,'0')
    };
  }

  function pickZoneAbbrAndId(ownerName) {
    if (ownerName === 'Logan Horsley') return { id: 'America/Chicago', abbr: 'CT' };
    return { id: 'America/Los_Angeles', abbr: 'PT' };
  }

  function buildSchTagTZ(start) {
    const owner = getTicketOwnerName();
    const { id: zone, abbr } = pickZoneAbbrAndId(owner);
    const p = partsInZone(start, zone);
    return ` <Sch ${p.month}/${p.day} @ ${p.hour}:${p.minute} ${abbr}>`;
  }

  function buildRemTag(date) {
    const mm = date.getMonth() + 1;
    const dd = date.getDate();
    return ` <Rem ${mm}/${dd}>`;
  }

  // ---------- candidate finder (scoped) ----------
  function getNextFutureCandidate() {
    const now = new Date();

    // Scope scans to the nearest container of the summary input (avoids full-document scans)
    const sum = findSummaryInput();
    const scope = (sum && sum.closest('.cw-ViewRoot, #contentPanel, #cwApp, body')) || document;

    const seen = new Set();
    const candidates = []; // {sortAt: Date, tag: string}

    const cells = scope.querySelectorAll('.slashFieldContent, .GMDB3DUBDPD, .multilineText, .gwt-Label, .gwt-HTML');
    for (const cell of cells) {
      if (!isVisible(cell) || inModal(cell)) continue;
      const parsed = parseCellText(text(cell));
      if (!parsed) continue;

      if (parsed.kind === 'time') {
        if (parsed.start <= now) continue;
        const t = parsed.start.getTime();
        if (seen.has(`t_${t}`)) continue;
        seen.add(`t_${t}`);
        candidates.push({ sortAt: parsed.start, tag: buildSchTagTZ(parsed.start) });
      } else if (parsed.kind === 'date') {
        if (parsed.endOfDay <= now) continue; // future if the day not fully passed
        const dKey = parsed.date.toDateString();
        if (seen.has(`d_${dKey}`)) continue;
        seen.add(`d_${dKey}`);
        candidates.push({ sortAt: parsed.date, tag: buildRemTag(parsed.date) });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.sortAt - b.sortAt);
    return candidates[0];
  }

  // ---------- popup ----------
  function showPopup(tag, ticketId) {
    const sum = findSummaryInput();
    if (!sum) return;

    if (hasAnySchRemTagAnywhere(sum.value)) return; // already has a tag
    if (new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$','i').test(sum.value || '')) return;
    if (!shouldShow(ticketId, tag)) return;

    let pop = document.getElementById(POPUP_ID);
    if (pop) pop.remove();

    pop = document.createElement('div');
    pop.id = POPUP_ID;
    Object.assign(pop.style, {
      position: 'fixed',
      top: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 2147483646,
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(0,0,0,.2)',
      background: '#111827',
      color: '#fff',
      boxShadow: '0 6px 18px rgba(0,0,0,.25)',
      maxWidth: '520px',
      font: '12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif'
    });

    const msg = document.createElement('div');
    msg.textContent = `Upcoming item detected, append ${tag.trim()} to Summary?`;
    msg.style.marginBottom = '8px';

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.justifyContent = 'center';

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'Append';
    Object.assign(ok.style, {
      padding: '6px 12px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,.25)',
      background: '#2563eb',
      color: '#fff',
      cursor: 'pointer'
    });
    ok.addEventListener('click', () => {
      const done = appendTag(tag);
      remember(ticketId, tag, done ? 'done' : 'dismissed');
      pop.remove();
    });

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Dismiss';
    Object.assign(cancel.style, {
      padding: '6px 12px',
      borderRadius: '6px',
      border: '1px solid rgba(255,255,255,.25)',
      background: 'transparent',
      color: '#fff',
      cursor: 'pointer'
    });
    cancel.addEventListener('click', () => {
      remember(ticketId, tag, 'dismissed');
      pop.remove();
    });

    row.appendChild(ok);
    row.appendChild(cancel);
    pop.appendChild(msg);
    pop.appendChild(row);
    document.body.appendChild(pop);
  }

  // ---------- scheduling (debounced + idle) ----------
  function scheduleRun() {
    dirty = true;
    const now = nowMs();
    if (now - runScheduledAt < 350) return; // ~350ms debounce
    runScheduledAt = now;
    if (idleScheduled) return;
    idleScheduled = true;
    const go = () => { idleScheduled = false; if (dirty) runOnceLight(); };
    (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 1000 }) : setTimeout(go, 0));
  }

  async function waitForSummary(timeoutMs = 6000) {
    const t0 = nowMs();
    while (nowMs() - t0 < timeoutMs) {
      const el = findSummaryInput();
      if (el && !inModal(el)) return el;
      await sleep(100);
    }
    return null;
  }

  async function runOnceLight() {
    if (ranForThisView) return;
    const summary = await waitForSummary(6000);
    if (!summary) return;
    ranForThisView = true;
    dirty = false; // we’re about to scan

    for (let i = 0; i < 5; i++) {
      const cand = getNextFutureCandidate();
      if (cand) {
        const tid = getTicketId();
        showPopup(cand.tag, tid);
        stopAnchorObserver(); // done for this view
        return;
      }
      await sleep(500);
    }
    // No candidate: stop the anchor window too; don’t keep watching forever
    stopAnchorObserver();
  }

  // ---------- observers ----------
  function startAnchorObserver() {
    stopAnchorObserver();
    // short window to catch late-rendered fields
    anchorObserver = new MutationObserver(muts => {
      for (const m of muts) {
        for (const n of m.addedNodes || []) {
          if (!(n instanceof HTMLElement)) continue;
          if (inModal(n)) continue;
          if (n.matches && (n.matches('input.cw_PsaSummaryHeader') ||
                            n.matches('.slashFieldContent, .GMDB3DUBDPD, .multilineText, .gwt-Label, .gwt-HTML'))) {
            scheduleRun();
            return;
          }
          if (n.querySelector && (n.querySelector('input.cw_PsaSummaryHeader') ||
                                  n.querySelector('.slashFieldContent, .GMDB3DUBDPD, .multilineText, .gwt-Label, .gwt-HTML'))) {
            scheduleRun();
            return;
          }
        }
      }
    });
    const root = document.querySelector('#cwApp, .cw-ViewRoot, #contentPanel, #applicationRoot, body') || document.body;
    try {
      anchorObserver.observe(root, { childList: true, subtree: true });
    } catch {}
    anchorWindowTimer = setTimeout(stopAnchorObserver, 8000);
  }

  function stopAnchorObserver() {
    if (anchorObserver) { try { anchorObserver.disconnect(); } catch {} anchorObserver = null; }
    if (anchorWindowTimer) { clearTimeout(anchorWindowTimer); anchorWindowTimer = null; }
  }

  function initSpaObserver() {
    if (spaMO) { try { spaMO.disconnect(); } catch {} spaMO = null; }
    const root = document.querySelector('#cwApp, .cw-ViewRoot, #contentPanel, #applicationRoot, body') || document.body;
    spaMO = new MutationObserver(() => scheduleRun());
    try { spaMO.observe(root, { childList: true, subtree: true }); } catch {}
  }

  function resetOnNav() {
    ranForThisView = false;
    dirty = false;
    scheduleRun();
    startAnchorObserver();
  }

  // History API hooks
  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      resetOnNav();
      return r;
    };
  });
  window.addEventListener('popstate', resetOnNav);
  window.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRun(); });
  window.addEventListener('focus', scheduleRun);

  // Initial ladder + observers (soft ramp)
  (function prime() {
    initSpaObserver();
    scheduleRun();                // t=0
    setTimeout(scheduleRun, 400); // softer ramp
    setTimeout(scheduleRun, 1200);
    startAnchorObserver();        // short late-load window
  })();
})();
