// ==UserScript==
// @name         attentus-cw-tab-title-normalize
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.8
// @description  If on a ticket, set "Ticket# - Summary - Company", otherwise set to a readable page name, never guess from random 3 digit numbers
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js
// ==/UserScript==


(function () {
  'use strict';

  const MIN_TICKET_DIGITS = 5; // require at least 5 digits to consider it a real ticket id
  const ORIGINAL_TITLE = document.title;

  const TITLE_FORMAT = (id, summary, company) => {
    const parts = [];
    if (id) parts.push(`#${id}`);
    if (summary) parts.push(summary);
    if (company) parts.push(company);
    return parts.join(' - ').trim();
  };

  const isVisible = (el) => !!el && el.nodeType === 1 && el.offsetParent !== null;

  // ---------- robust ticket detection, no title parsing ----------
  function ticketIdFromUrl() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('service_recid');
      if (q && /^\d+$/.test(q) && q.length >= MIN_TICKET_DIGITS) return q;
      // Some paths embed ids, keep the same minimum length rule
      const pm = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d+)(?:$|[/?#])/i);
      if (pm && pm[1] && pm[1].length >= MIN_TICKET_DIGITS) return pm[1];
    } catch {}
    return '';
  }

  // Detect CW Time Entry pages, cheap and robust
function isTimeEntryPage() {
  const href = location.href.toLowerCase();
  // URL hints
  if (/\btime[_-]?entry\b/.test(href) || /timeentry/.test(href)) return true;

  // Obvious UI hints
  const labels = document.querySelectorAll('.GMDB3DUBBPG, .GMDB3DUBORG, .gwt-Label.mm_label, [id$="-label"]');
  for (const el of labels) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (t === 'time entry' || t.includes('time entry')) return true;
  }

  // Common time fields
  if (document.querySelector('input.cw_timeStart') || document.querySelector('input.cw_timeEnd')) return true;

  return false;
}


  function ticketIdFromDom() {
    // Look for a visible header that literally says "Ticket #12345"
    const cands = document.querySelectorAll(
      '[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBNLI, .GMDB3DUBLHH, .GMDB3DUBIHH, .GMDB3DUBORG, .GMDB3DUBBPG'
    );
    for (const el of cands) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/ticket\s*#\s*(\d+)/i);
      if (m && m[1] && m[1].length >= MIN_TICKET_DIGITS) return m[1];
    }
    return '';
  }

  function getTicketId() {
    return ticketIdFromUrl() || ticketIdFromDom() || '';
  }

  function getSummary() {
    const input =
      document.querySelector('input.cw_PsaSummaryHeader') ||
      document.querySelector('input.cw_summary') ||
      document.querySelector('input[placeholder*="summary" i]');
    if (input && input.value) return input.value.trim();
    // Fallback, find a visible label like "Summary: Foo"
    const lbls = document.querySelectorAll('[id$="-label"], .GMDB3DUBORG, .gwt-Label, .mm_label');
    for (const el of lbls) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m1 = t.match(/^summary:\s*(.+)$/i);
      if (m1) return m1[1].trim();
    }
    return '';
  }

  function getCompany() {
    // Visible "Company: ACME"
    const labels = document.querySelectorAll('[id$="-label"], .gwt-Label, .mm_label, .GMDB3DUBORG, .GMDB3DUBBPG');
    for (const el of labels) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^\s*company:\s*(.+)$/i);
      if (m) return m[1].trim();
    }
    const inp = document.querySelector('input.cw_company') || document.querySelector('input[placeholder*="company" i]');
    if (inp && inp.value) return inp.value.trim();
    return '';
  }

  // ---------- non ticket page name ----------
function getNonTicketPageTitle() {
  // OPTION 1, do not touch Time Entry titles, leave ConnectWise default
  // if (isTimeEntryPage()) return ORIGINAL_TITLE;

  // OPTION 2, force a clean label for Time Entry windows
  if (isTimeEntryPage()) return 'Time Entry';

  // Prefer obvious page headers that are not "Ticket #12345"
  const headerSelectors = [
    '.mm_podHeader [id$="-label"]',
    '.mm_panelHeader [id$="-label"]',
    '.GMDB3DUBLHH[id$="-label"]',
    'h1, h2',
    '.gwt-Label.mm_label',
    '.GMDB3DUBBPG',
    '.GMDB3DUBORG',
  ];
  const nodes = document.querySelectorAll(headerSelectors.join(','));
  // First pass, look for descriptive page names
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/ticket\s*#\s*\d+/i.test(t)) continue;
    if (/^\W+$/.test(t)) continue;
    if (/(list|entry|entries|my service|timesheet|board|agreements?|invoices?|opportunit|reports?|schedule|procure|purchas|sales|service)/i.test(t)) {
      return t;
    }
  }
  // Second pass, take the first reasonable visible label that is not bare "Tickets"
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (/ticket\s*#\s*\d+/i.test(t)) continue;
    if (/^tickets$/i.test(t)) continue;
    return t;
  }
  // Fallback, keep whatever CW had
  return ORIGINAL_TITLE;
}


  // ---------- Title updater ----------
  let rafScheduled = false;
  function updateTitle() {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;

      const id = getTicketId();
      if (id) {
        const summary = getSummary();
        const company = getCompany();
        const next = TITLE_FORMAT(id, summary, company);
        if (next && document.title !== next) {
          document.title = next;
        }
        return;
      }

      // Not a ticket view, set to a readable page name if we can, otherwise leave as is
      const page = getNonTicketPageTitle();
      if (page && document.title !== page) {
        document.title = page;
      }
    });
  }

  // ---------- Bind to field changes, only matters on tickets ----------
  function attachFieldListeners() {
    const sels = [
      'input.cw_PsaSummaryHeader',
      'input.cw_summary',
      'input.cw_company',
      'input[placeholder*="summary" i]',
      'input[placeholder*="company" i]',
    ];
    document.querySelectorAll(sels.join(',')).forEach(el => {
      el.removeEventListener('input', updateTitle);
      el.removeEventListener('change', updateTitle);
      el.addEventListener('input', updateTitle, { passive: true });
      el.addEventListener('change', updateTitle, { passive: true });
    });
  }

  // ---------- Observe DOM, hook SPA nav ----------
  const mo = new MutationObserver(muts => {
    let relevant = false;
    for (const m of muts) {
      if (m.type === 'childList') {
        if ([...m.addedNodes].some(n =>
          n.nodeType === 1 && (n.matches?.('[id$="-label"], input, h1, h2') ||
          n.querySelector?.('[id$="-label"], input.cw_PsaSummaryHeader, input.cw_company, input.cw_summary, h1, h2'))
        )) { relevant = true; break; }
      } else if (m.type === 'characterData') {
        relevant = true; break;
      } else if (m.type === 'attributes') {
        if ((m.target?.id || '').endsWith('-label')) { relevant = true; break; }
      }
    }
    if (relevant) {
      attachFieldListeners();
      updateTitle();
    }
  });
  mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });

  // Hook history changes for SPA transitions
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(() => { attachFieldListeners(); updateTitle(); });
      return r;
    };
  });
  window.addEventListener('popstate', () => { attachFieldListeners(); updateTitle(); });

  // Gentle periodic nudge, very light
  setInterval(updateTitle, 2000);

  // Kick off
  attachFieldListeners();
  updateTitle();
})();
