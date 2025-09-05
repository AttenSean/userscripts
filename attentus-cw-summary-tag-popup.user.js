// ==UserScript==
// @name         attentus-cw-summary-tag-popup
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.4.0
// @description  Center top popup that appends "  <Sch M/D @ H:MMAM|PM>" for timed future appts or "  <Rem M/D>" for date only rows, one click then hides
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @noframes
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js
// ==/UserScript==


(function () {
  'use strict';

  const VERSION = 'v140';
  const MAX_SUMMARY = 100;
  const POPUP_ID = 'att-schrem-popup';
  let ranForThisView = false;

  // ---------- tiny utils ----------
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const text = el => (el && el.textContent || '').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVisible = el => !!(el && el.offsetParent !== null);

  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  async function waitForSummary(timeoutMs = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const el = findSummaryInput();
      if (el) return el;
      await sleep(100);
    }
    return null;
  }

  // ---------- ticket id memory ----------
  function getTicketId() {
    try {
      const url = new URL(location.href);
      const id = url.searchParams.get('srRecID') ||
                 url.searchParams.get('serviceTicketId') ||
                 url.searchParams.get('recid');
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
  function removeExistingTagAtEnd(v) {
    return (v || '').replace(/\s*<(Sch|Rem)\s+[^>]+>\s*$/i, '').trimEnd();
  }
  function appendTag(tag) {
    const inp = findSummaryInput();
    if (!inp) return false;
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
  // Timed full range, example: "Fri 09/05/2025 1:30 PM - Fri 09/05/2025 2:00 PM"
  const RE_FULL = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  // Timed short end, example: "09/05/2025 1:30 PM - 2:00 PM"
  const RE_SHORT_END = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;
  // Date only, example: "Thu 09/04/2025  - Thu 09/04/2025"
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
      const date = toLocalDate(m[3], m[1], m[2], 0, 0, null); // start of day
      const endD = toLocalDate(m[6], m[4], m[5], 23, 59, null); // end of day
      if (date && endD) return { kind: 'date', date, endOfDay: endD };
    }

    return null;
  }

  function buildSchTag(start) {
    const mm = start.getMonth() + 1;
    const dd = start.getDate();
    const minutes = String(start.getMinutes()).padStart(2, '0');
    const h24 = start.getHours();
    const h12 = h24 % 12 || 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    return ` <Sch ${mm}/${dd} @ ${h12}:${minutes}${ampm}>`;
  }
  function buildRemTag(date) {
    const mm = date.getMonth() + 1;
    const dd = date.getDate();
    return ` <Rem ${mm}/${dd}>`;
  }

  // Pick earliest future, dedupe, ignore hidden
  function getNextFutureCandidate() {
    const now = new Date();
    const roots = [$('.GMDB3DUBGRD') || document];
    const seen = new Set();
    const candidates = []; // each is {sortAt: Date, tag: string}

    for (const root of roots) {
      const cells = root.querySelectorAll('.slashFieldContent, .GMDB3DUBDPD');
      for (const cell of cells) {
        if (!isVisible(cell)) continue;
        const parsed = parseCellText(text(cell));
        if (!parsed) continue;

        if (parsed.kind === 'time') {
          if (parsed.start <= now) continue;
          const t = parsed.start.getTime();
          if (seen.has(`t_${t}`)) continue;
          seen.add(`t_${t}`);
          candidates.push({ sortAt: parsed.start, tag: buildSchTag(parsed.start) });
        } else if (parsed.kind === 'date') {
          // treat as future if the day has not fully passed
          if (parsed.endOfDay <= now) continue;
          const dKey = parsed.date.toDateString();
          if (seen.has(`d_${dKey}`)) continue;
          seen.add(`d_${dKey}`);
          candidates.push({ sortAt: parsed.date, tag: buildRemTag(parsed.date) });
        }
      }
      if (candidates.length) break;
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.sortAt - b.sortAt);
    return candidates[0];
  }

  // ---------- popup ----------
  function showPopup(tag, ticketId) {
    const sum = findSummaryInput();
    if (!sum) return;
    if (new RegExp(tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$','i').test(sum.value || '')) return;
    if (!shouldShow(ticketId, tag)) return;

    let pop = document.getElementById(POPUP_ID);
    if (pop) pop.remove();

    pop = document.createElement('div');
    pop.id = POPUP_ID;
    Object.assign(pop.style, {
      position: 'fixed',
      top: '80px',          // near top
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 2147483646,
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(0,0,0,.2)',
      background: '#111827',
      color: '#fff',
      boxShadow: '0 6px 18px rgba(0,0,0,.25)',
      maxWidth: '480px',
      font: '12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif'
    });

    const msg = document.createElement('div');
    msg.textContent = `Upcoming item detected, append ${tag.trim()} to Summary, then hide this,`;
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

  // ---------- main ----------
  async function runOnceLight() {
    if (ranForThisView) return;
    const summary = await waitForSummary(6000);
    if (!summary) return;
    ranForThisView = true;

    for (let i = 0; i < 5; i++) {
      const cand = getNextFutureCandidate();
      if (cand) {
        const tid = getTicketId();
        showPopup(cand.tag, tid);
        return;
      }
      await sleep(500);
    }
  }

  function resetOnNav() { ranForThisView = false; setTimeout(runOnceLight, 250); }

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); resetOnNav(); return r; };
  });
  window.addEventListener('popstate', resetOnNav);

  runOnceLight();
})();
