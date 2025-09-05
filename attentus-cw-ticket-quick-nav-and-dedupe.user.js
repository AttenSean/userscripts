// ==UserScript==
// @name         attentus-cw-ticket-quick-nav-and-dedupe
// @namespace    https://github.com/AttenSean/userscripts
// @version      3.4
// @description  Tiny ticket input in the top header, Enter to open, last 5 dropdown rendered in body, placed left of Tickets, reuses an existing tab per ticket
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-nav-and-dedupe.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-nav-and-dedupe.user.js
// ==/UserScript==


(function () {
  'use strict';

  const MAX_RECENTS = 5;
  const STORAGE_KEY = 'cw_recent_tickets';
  const MENU_ID = 'cw-go-ticket-menu-portal';

  // ---------- URL + window naming ----------

  function buildTicketUrl(ticketNumber) {
    const url = new URL('/v4_6_release/services/system_io/Service/fv_sr100_request.rails', location.origin);
    url.searchParams.set('service_recid', ticketNumber);
    return url.toString();
  }

  function ticketWindowName(n) {
    return `cw_ticket_${n}`;
  }

  // ---------- input helpers ----------

  function normalizeTicket(val) {
    if (!val) return null;
    let s = String(val).trim();
    if (s.startsWith('#')) s = s.slice(1);
    s = s.replace(/\D/g, '');
    return /^\d{1,10}$/.test(s) ? s : null;
  }

  function getRecents() {
    try { const a = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(a) ? a : []; }
    catch { return []; }
  }
  function setRecents(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX_RECENTS))); }
  function addRecent(num) {
    const n = normalizeTicket(num); if (!n) return;
    const rec = getRecents().filter(x => x !== n);
    rec.unshift(n);
    setRecents(rec);
    renderMenu(); // refresh if open
  }

  function openTicket(num) {
    const n = normalizeTicket(num);
    if (!n) return shakeInput('Enter a numeric ticket number, for example 3711744');

    // Reuse or focus the existing tab for this ticket by name
    const target = ticketWindowName(n);
    window.open(buildTicketUrl(n), target, 'noopener');

    addRecent(n);
    const input = document.getElementById('cw-ticket-input');
    if (input) input.select();
  }

  function shakeInput(msg) {
    const input = document.getElementById('cw-ticket-input');
    if (!input) return alert(msg);
    input.title = msg;
    input.style.transition = 'transform .08s';
    input.style.transform = 'translateX(4px)';
    setTimeout(() => { input.style.transform = 'translateX(-4px)'; }, 80);
    setTimeout(() => { input.style.transform = 'translateX(0)'; }, 160);
  }

  // ---------- UI ----------

  function makeUI() {
    const wrap = document.createElement('span');
    wrap.id = 'cw-go-ticket-wrap';
    wrap.style.cssText = 'display:inline-flex;align-items:center;gap:6px;position:relative;vertical-align:middle;';

    const input = document.createElement('input');
    input.id = 'cw-ticket-input';
    input.type = 'text';
    input.placeholder = '#';
    input.autocomplete = 'off';
    input.inputMode = 'numeric';
    input.maxLength = 10;
    input.ariaLabel = 'Go to ticket number';
    input.style.cssText = `
      width:110px;height:28px;box-sizing:border-box;
      padding:4px 8px;border:1px solid rgba(0,0,0,.2);border-radius:6px;
      font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    input.addEventListener('input', () => {
      const pos = input.selectionStart || 0;
      let v = input.value; v = v.replace(/^#/, '').replace(/\D/g, ''); input.value = v;
      input.setSelectionRange(pos, pos);
    });
    input.addEventListener('focus', async () => {
      if (!input.value) {
        try {
          if (navigator.clipboard && window.isSecureContext) {
            const clip = (await navigator.clipboard.readText()).trim();
            const n = normalizeTicket(clip); if (n) input.value = n;
          }
        } catch {}
        showMenu();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); openTicket(input.value); }
      else if (e.key === 'Escape') { input.value = ''; hideMenu(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); showMenu(); }
    });

    const go = document.createElement('button');
    go.id = 'cw-go-ticket-btn';
    go.type = 'button';
    go.textContent = 'Go';
    go.style.cssText = `
      padding:6px 10px;border-radius:6px;border:1px solid rgba(0,0,0,.15);
      background:#2563eb;color:#fff;cursor:pointer;
      font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;white-space:nowrap;
    `;
    go.addEventListener('click', () => openTicket(input.value));
    go.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const last = getRecents()[0];
      if (last) window.open(buildTicketUrl(last), '_blank', 'noopener,noreferrer');
    });

    const caret = document.createElement('button');
    caret.id = 'cw-go-ticket-caret';
    caret.type = 'button';
    caret.textContent = '▾';
    caret.style.cssText = `
      padding:6px 8px;border-radius:6px;border:1px solid rgba(0,0,0,.15);
      background:#2563eb;color:#fff;cursor:pointer;font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    `;
    caret.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });

    wrap.append(input, go, caret); // menu renders in body
    return wrap;
  }

  // ---------- Menu in body portal, not clipped ----------

  function ensureMenuPortal() {
    let m = document.getElementById(MENU_ID);
    if (!m) {
      m = document.createElement('div');
      m.id = MENU_ID;
      m.style.cssText = `
        position:fixed; top:0; left:0; min-width:180px; z-index:2147483647;
        background:#fff; color:#111; border:1px solid rgba(0,0,0,.15); border-radius:8px;
        box-shadow:0 8px 16px rgba(0,0,0,.12); padding:6px; display:none;
        font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      `;
      m.addEventListener('click', e => e.stopPropagation());
      document.body.appendChild(m);
    }
    return m;
  }

  function renderMenu() {
    const m = ensureMenuPortal();
    m.innerHTML = '';
    const rec = getRecents();
    if (!rec.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No recent tickets';
      empty.style.cssText = 'padding:6px 8px;color:#666;';
      m.appendChild(empty);
      return;
    }
    rec.forEach(n => {
      const item = document.createElement('div');
      item.textContent = `#${n}`;
      item.style.cssText = 'padding:6px 8px;border-radius:6px;cursor:pointer;';
      item.addEventListener('click', () => { hideMenu(); openTicket(n); });
      item.addEventListener('mouseenter', () => item.style.background = '#f2f4f7');
      item.addEventListener('mouseleave', () => item.style.background = '');
      m.appendChild(item);
    });
    const clear = document.createElement('div');
    clear.textContent = 'Clear recents';
    clear.style.cssText = 'padding:6px 8px;border-top:1px solid #eee;color:#b00;cursor:pointer;margin-top:4px;';
    clear.addEventListener('click', () => { setRecents([]); renderMenu(); });
    m.appendChild(clear);
  }

  // Compute absolute viewport coords for an element, across same origin iframes
  function absoluteViewportPoint(el, which) {
    let r = el.getBoundingClientRect();
    let x = which === 'left' ? r.left : r.right;
    let y = r.bottom;
    let w = el.ownerDocument.defaultView;
    try {
      while (w && w.frameElement && w !== w.parent) {
        const fr = w.frameElement.getBoundingClientRect();
        x += fr.left;
        y += fr.top;
        w = w.parent;
      }
    } catch {}
    return { x: Math.round(x), y: Math.round(y) };
  }

  function showMenu() {
    const caret = document.getElementById('cw-go-ticket-caret');
    if (!caret) return;
    renderMenu();
    const m = ensureMenuPortal();
    const p = absoluteViewportPoint(caret, 'left');
    m.style.left = p.x + 'px';
    m.style.top  = (p.y + 6) + 'px';
    m.style.display = 'block';
    document.addEventListener('click', onDocClick, { once: true });
    window.addEventListener('scroll', hideMenuOnScroll, true);
    window.addEventListener('resize', hideMenu, { once: true });
  }
  function hideMenu() {
    const m = document.getElementById(MENU_ID);
    if (m) m.style.display = 'none';
    window.removeEventListener('scroll', hideMenuOnScroll, true);
  }
  function hideMenuOnScroll() { hideMenu(); }
  function toggleMenu() {
    const m = ensureMenuPortal();
    if (m.style.display === 'block') hideMenu(); else showMenu();
  }
  function onDocClick() { hideMenu(); }

  // ---------- Placement, left of Tickets dropdown ----------

  function placeLeftOfTickets() {
    if (document.getElementById('cw-go-ticket-wrap')) return true;

    let ticketsLabel = Array.from(document.querySelectorAll('.GMDB3DUBORG, [class*="ORG"]'))
      .find(el => (el.textContent || '').trim().toLowerCase() === 'tickets');
    if (!ticketsLabel) ticketsLabel = document.querySelector('.cw_CwTextMenuButton .GMDB3DUBORG');

    const ticketsTd = ticketsLabel && ticketsLabel.closest('td');
    const ticketsTr = ticketsTd && ticketsTd.closest('tr');
    if (!ticketsTr || !ticketsTd) return false;

    const newTd = document.createElement('td');
    newTd.align = 'left';
    newTd.style.verticalAlign = 'middle';
    newTd.style.paddingLeft = '8px';
    newTd.appendChild(makeUI());

    ticketsTr.insertBefore(newTd, ticketsTd); // left of Tickets
    return true;
  }

  function placeLeftOfSearch() {
    if (document.getElementById('cw-go-ticket-wrap')) return true;

    const searchInput =
      document.querySelector('input.cw_NavigationSearchPsaComboBox') ||
      document.getElementById('x-auto-118-input');

    if (!searchInput) return false;

    const searchTd = searchInput.closest('td');
    const searchTr = searchTd && searchTd.closest('tr');
    if (!searchTd || !searchTr) return false;

    const newTd = document.createElement('td');
    newTd.align = 'left';
    newTd.style.verticalAlign = 'middle';
    newTd.style.paddingLeft = '8px';
    newTd.appendChild(makeUI());

    searchTr.insertBefore(newTd, searchTd); // left of Search
    return true;
  }

  function ensurePlaced() {
    if (placeLeftOfTickets()) return;
    if (placeLeftOfSearch()) return;
  }

  // ---------- Observe and hook SPA ----------

  const mo = new MutationObserver(() => ensurePlaced());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensurePlaced); return r; };
  });
  window.addEventListener('popstate', ensurePlaced);

  // initial mount
  ensurePlaced();

  // ---------- Companion, tag ticket tabs regardless of how they were opened ----------
  // If we are on a ticket page, set window.name to the stable name so future opens will focus this tab
  (function tagTicketTab() {
    try {
      const u = new URL(location.href);
      if (/\/Service\/fv_sr100_request\.rails$/i.test(u.pathname)) {
        const id = u.searchParams.get('service_recid');
        if (id) {
          const want = ticketWindowName(id);
          if (window.name !== want) window.name = want;
        }
      }
    } catch {}
  })();
})();
