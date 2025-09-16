// ==UserScript==
// @name         attentus-cw-open-views-launcher
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.11.0
// @description  Open selected Service Views in one click; de-dupe via named tabs (focus reused tabs); survives SPA redirects; runs ONLY on Service Board List (not tickets/mini-views/Project Board); re-applies view on return; skips current view; pings normalizer when a view is applied.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-open-views-launcher.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-open-views-launcher.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- utils ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const same = (a,b) => (a||'').replace(/\s+/g,' ').trim().toLowerCase() === (b||'').replace(/\s+/g,' ').trim().toLowerCase();
  const slug = (s) => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'view';
  const isVisible = (el) => !!(el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden');

  async function gmGet(k, def){ try{ if(GM?.getValue) return await GM.getValue(k, def);}catch{} try{ if(typeof GM_getValue==='function') return GM_getValue(k, def);}catch{} try{ const v=localStorage.getItem(k); return v==null?def:JSON.parse(v);}catch{} return def; }
  async function gmSet(k, v){ try{ if(GM?.setValue) return await GM.setValue(k, v);}catch{} try{ if(typeof GM_setValue==='function') return GM_setValue(k, v);}catch{} try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }

  // ---------- storage ----------
  const STORE_KEY = 'att_cw_open_views';
  async function getConfig(){ return gmGet(STORE_KEY, { known:[], chosen:[], onboarded:false }); }
  async function setConfig(v){ return gmSet(STORE_KEY, v); }

  // Per-tab sticky: remember the last applied view for this window.name
  const VIEW_FOR_TAB = (name) => `att_view_for_${name}`;

  // ---------- page detection ----------
  function bannerTexts() {
    const sels = [
      '.cw-main-banner .navigationEntry',
      '.cw-main-banner .detailLabel',
      '.cw-main-banner .cw_CwLabel',
      '.cw_BannerView .mm_label',
      '.cw_BannerView .cw_CwLabel',
      '.gwt-Label.mm_label'
    ];
    return Array.from(document.querySelectorAll(sels.join(',')))
      .map(el => (el.textContent||'').trim().toLowerCase())
      .filter(Boolean);
  }
  function bannerHasServiceBoardList() {
    return bannerTexts().some(t => same(t, 'service board list'));
  }
  function isProjectBoard() {
    return bannerTexts().some(t => same(t, 'project board'));
  }
  function isTicketView() {
    // Visible banner like “Service Ticket #123456” or similar
    return bannerTexts().some(t => /ticket\s*#\s*\d+/.test(t));
  }
  function hasSrboardGrid() {
    return !!document.querySelector('table.srboard-grid tr.cw-ml-row');
  }
  function hasViewDropdown() {
    return !!document.querySelector('.cw-toolbar-view-dropdown input.cw_CwComboBox, .cw-toolbar-view-dropdown input[type="text"]');
  }

  // Strict: Only true on the real Service Board List screen
  function isServiceBoardListStrict() {
    if (isProjectBoard() || isTicketView()) return false;
    // Require the banner to say “Service Board List” to avoid mini-views inside tickets.
    if (!bannerHasServiceBoardList()) return false;
    // And require the actual View dropdown
    if (!hasViewDropdown()) return false;
    // Grid may render lazily; don't hard-require it, but prefer it if present
    return true;
  }

  // ---------- toolbar placement ----------
  function exportBlock() {
    return document.querySelector('div.cw-toolbar-export') ||
      Array.from(document.querySelectorAll('div[class*=toolbar] .GMDB3DUBORG'))
        .find(el => same(el.textContent, 'Export'))?.closest('div') || null;
  }
  function buildToolbarButton() {
    const wrap = document.createElement('div');
    wrap.className = 'GMDB3DUBHFJ GMDB3DUBBFJ GMDB3DUBOFJ cw_CwTextButton GMDB3DUBLFJ';
    wrap.style.margin = '0px';
    wrap.style.position = 'absolute';
    wrap.id = 'att-cw-open-views-btn';
    wrap.title = 'Click: open selected Views in tabs • Shift-click: choose Views';

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBFRG mm_button'; btn.tabIndex = 0;
    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBGRG  GMDB3DUBKTG';
    const label = document.createElement('div');
    label.className = 'GMDB3DUBORG'; label.textContent = 'Open Views';
    inner.appendChild(label); btn.appendChild(inner); wrap.appendChild(btn);
    return wrap;
  }
  function positionBeforeExport(wrapper) {
    const exp = exportBlock();
    if (!exp || !exp.parentElement) return false;
    if (!wrapper.parentElement) exp.parentElement.insertBefore(wrapper, exp);

    wrapper.style.top = exp.style.top || '0px';
    wrapper.style.visibility = 'hidden';
    wrapper.style.left = '-9999px';
    const width = wrapper.offsetWidth || 110;
    wrapper.style.visibility = '';
    const expLeft = parseFloat(exp.style.left || exp.offsetLeft || 0);
    wrapper.style.left = `${Math.max(0, expLeft - width - 8)}px`;
    return true;
  }
  function ensureToolbarButton() {
    const shouldShow = isServiceBoardListStrict();
    const existing = document.getElementById('att-cw-open-views-btn');
    if (!shouldShow) { existing?.remove(); return; }

    if (!existing) {
      const wrap = buildToolbarButton();
      if (!positionBeforeExport(wrap)) return;

      wrap.addEventListener('click', async (e) => {
        e.preventDefault();
        if (e.shiftKey) { await showSettings(); return; }

        const cfg = await getConfig();
        if (!cfg.onboarded || !(cfg.chosen||[]).length) { await showSettings(); return; }

        const current = (await currentViewLabel()) || '';
        const picks = (cfg.chosen||[]).filter(v => !same(v, current));
        if (!picks.length) return;

        for (const v of picks) { openViewTab(v, /*focusIfReused*/true); await sleep(40); }
      });
      wrap.addEventListener('keydown', (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); wrap.click(); } });
    } else {
      positionBeforeExport(existing);
    }
  }

  // ---------- view dropdown helpers (guarded) ----------
  function findViewCombo() {
    if (!isServiceBoardListStrict()) return null; // hard guard
    const dd = document.querySelector('.cw-toolbar-view-dropdown');
    if (dd) {
      const input = dd.querySelector('input.cw_CwComboBox, input[type="text"]');
      const trigger = dd.querySelector('.GMDB3DUBHWH, .cwsvg, svg, img[role="button"]');
      if (input && trigger) return {input, trigger, root: dd};
    }
    return null;
  }
  const getGwtMenu = () => Array.from(document.querySelectorAll('.gwt-dropdown-options')).find(isVisible) || null;
  const getAnyMenu = () => getGwtMenu() ||
    Array.from(document.querySelectorAll('.x-combo-list, .x-menu, .gwt-PopupPanel, .x-layer')).find(isVisible) || null;

  async function robustOpenCombo(combo) {
    if (!isServiceBoardListStrict()) return false; // hard guard
    combo.trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    combo.trigger.dispatchEvent(new MouseEvent('click', { bubbles:true }));
    for (let i=0;i<10;i++){ if (getAnyMenu()) return true; await sleep(30); }
    combo.input.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    combo.input.dispatchEvent(new MouseEvent('click', { bubbles:true }));
    combo.input.focus();
    combo.input.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    for (let i=0;i<10;i++){ if (getAnyMenu()) return true; await sleep(30); }
    combo.input.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true }));
    for (let i=0;i<10;i++){ if (getAnyMenu()) return true; await sleep(30); }
    return !!getAnyMenu();
  }
  function collectMenuItemsText(menuRoot) {
    if (!menuRoot) return [];
    let items = Array.from(menuRoot.querySelectorAll('.mm_label'));
    if (!items.length) {
      items = Array.from(menuRoot.querySelectorAll('.x-combo-list-item, .x-menu-item, .gwt-MenuItem, li, div, span'))
        .filter(el => (el.textContent||'').trim());
    }
    const out = [];
    for (const el of items) {
      const t = (el.textContent || '').replace(/\s+/g,' ').trim();
      if (!t || same(t, '(No View)')) continue;
      if (!out.some(x => same(x,t))) out.push(t);
    }
    return out;
  }
  async function scrapeViewsViaDropdown() {
    if (!isServiceBoardListStrict()) return [];
    const combo = findViewCombo();
    if (!combo) return [];
    const opened = await robustOpenCombo(combo);
    if (!opened) return [];
    for (let i=0;i<20;i++){
      const list = collectMenuItemsText(getAnyMenu());
      if (list.length) return list;
      await sleep(50);
    }
    return [];
  }
  async function chooseFromDropdown(valueText) {
    if (!isServiceBoardListStrict()) return false; // hard guard (prevents ticket mini-view popping open)
    const combo = findViewCombo();
    if (!combo) return false;

    const cur = (combo.input.value || combo.input.getAttribute('value') || '').trim();
    if (same(cur, valueText)) {
      try { window.dispatchEvent(new CustomEvent('att:openviews-applied', { detail: { view: valueText, already: true } })); } catch {}
      try { sessionStorage.setItem(VIEW_FOR_TAB(window.name || ''), valueText); } catch {}
      return 'already';
    }

    const opened = await robustOpenCombo(combo);
    if (!opened) return false;

    const menu = getAnyMenu();
    let item = menu?.querySelectorAll('.mm_label');
    item = item && Array.from(item).find(el => same(el.textContent, valueText)) || null;
    if (!item) {
      const candidates = Array.from(menu?.querySelectorAll('.mm_label, .x-combo-list-item, .x-menu-item, .gwt-MenuItem, li, div, span') || [])
        .filter(el => (el.textContent||'').trim());
      item = candidates.find(el => (el.textContent||'').trim().toLowerCase().startsWith(valueText.trim().toLowerCase())) || null;
    }
    if (!item) return false;

    item.dispatchEvent(new MouseEvent('mousedown', { bubbles:true }));
    item.click();

    for (let i=0;i<20;i++){
      const newVal = (combo.input.value || combo.input.getAttribute('value') || '').trim();
      if (same(newVal, valueText) || !getAnyMenu()) {
        try { sessionStorage.setItem(VIEW_FOR_TAB(window.name || ''), valueText); } catch {}
        try { window.dispatchEvent(new CustomEvent('att:openviews-applied', { detail: { view: valueText } })); } catch {}
        return true;
      }
      await sleep(50);
    }
    return true;
  }

  // ---------- settings UI ----------
  function makeModal() {
    const id = 'att-cw-open-views-modal';
    document.getElementById(id)?.remove();
    const overlay = document.createElement('div');
    overlay.id = id;
    Object.assign(overlay.style, { position:'fixed', inset:'0', background:'rgba(0,0,0,.35)', zIndex:2147483646 });
    const modal = document.createElement('div');
    Object.assign(modal.style, {
      position:'absolute', top:'10%', left:'50%', transform:'translateX(-50%)',
      width:'min(560px, 92vw)', background:'#fff', color:'#111',
      borderRadius:'10px', boxShadow:'0 10px 30px rgba(0,0,0,.2)',
      padding:'16px', font:'13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif'
    });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    return { overlay, modal, close(){ overlay.remove(); } };
  }
  async function showSettings() {
    if (!isServiceBoardListStrict()) return; // don't open settings on non-board pages
    const { modal, close } = makeModal();
    const cfg = await getConfig();
    modal.innerHTML = `
      <div style="font-weight:600; font-size:14px; margin-bottom:10px;">Open Views</div>
      <div style="display:flex; gap:8px; margin-bottom:10px;">
        <button id="att-ov-reload" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">Reload views</button>
        <span style="color:#555; align-self:center;">Scrapes the current View dropdown</span>
      </div>
      <div id="att-ov-list" style="max-height:320px; overflow:auto; border:1px solid #eee; border-radius:8px; padding:8px; margin-bottom:10px;">
        <div style="color:#666;">Loading…</div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button id="att-ov-cancel" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">Close</button>
        <button id="att-ov-save"   style="padding:6px 10px;border:1px solid rgba(0,0,0,.2);border-radius:6px;background:#2563eb;color:#fff;cursor:pointer;">Save</button>
      </div>
    `;
    const listEl = modal.querySelector('#att-ov-list');

    function renderList(known, chosen) {
      listEl.innerHTML = '';
      if (!known.length) { listEl.innerHTML = `<div style="color:#666;">No views found. Open this on a Service Board list and click <strong>Reload views</strong>.</div>`; return; }
      const box = document.createElement('div');
      for (const v of known) {
        const id = `att-ov-${Math.random().toString(36).slice(2,7)}`;
        const row = document.createElement('label');
        row.htmlFor = id;
        row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;cursor:pointer;';
        row.addEventListener('mouseenter',()=>row.style.background='#f2f4f7');
        row.addEventListener('mouseleave',()=>row.style.background='');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.id = id; cb.dataset.view = v;
        cb.checked = (chosen||[]).some(x => same(x,v));
        const span = document.createElement('span'); span.textContent = v;
        row.append(cb, span); box.appendChild(row);
      }
      listEl.appendChild(box);
    }

    if (cfg.known?.length) renderList(cfg.known, cfg.chosen||[]);
    else { const scraped = await scrapeViewsViaDropdown(); cfg.known = scraped; renderList(cfg.known, cfg.chosen||[]); }

    modal.querySelector('#att-ov-reload').onclick = async () => { const scraped = await scrapeViewsViaDropdown(); cfg.known = scraped; renderList(cfg.known, cfg.chosen||[]); };
    modal.querySelector('#att-ov-cancel').onclick = close;
    modal.querySelector('#att-ov-save').onclick = async () => {
      const chosen = Array.from(listEl.querySelectorAll('input[type="checkbox"]')).filter(cb => cb.checked).map(cb => cb.dataset.view);
      await setConfig({ known: cfg.known||[], chosen, onboarded:true });
      close();
    };
  }

  // ---------- open/reuse named tabs ----------
  function computeBoardBaseUrl() {
    const u = new URL(location.href);
    let path = u.pathname;
    if (!/connectwise\.aspx$/i.test(path)) {
      const seg = u.pathname.split('/').filter(Boolean)[0] || '';
      path = `/${seg ? seg + '/' : ''}ConnectWise.aspx`;
    }
    const base = new URL(path, u.origin);
    const locale = new URLSearchParams(u.search).get('locale') || 'en_US';
    base.searchParams.set('locale', locale);
    base.hash = 'startscreen=sr200';
    return base;
  }

  function openViewTab(viewName, focusIfReused = false) {
    const s = slug(viewName);
    const target = `cw_view_${s}`;
    const base = computeBoardBaseUrl();
    base.searchParams.set('cwview', viewName); // query hint
    base.hash = `${base.hash}&cwview=${encodeURIComponent(viewName)}`; // hash hint

    // Try to reuse an existing named tab first
    let w = null;
    try { w = window.open('', target); } catch {}
    if (w && !w.closed) {
      try { w.location.href = base.toString(); } catch {}
      try { w.sessionStorage?.setItem(VIEW_FOR_TAB(target), viewName); } catch {}
      if (focusIfReused) { try { w.focus(); } catch {} }
      return;
    }

    // Otherwise, open a new named tab (leave unfocused to avoid stealing)
    const w2 = window.open(base.toString(), target);
    try { w2?.sessionStorage?.setItem(VIEW_FOR_TAB(target), viewName); } catch {}
  }

  // ---------- current view / apply view ----------
  async function currentViewLabel() {
    if (!isServiceBoardListStrict()) return '';
    const dd = document.querySelector('.cw-toolbar-view-dropdown');
    const input = dd?.querySelector('input.cw_CwComboBox, input[type="text"]');
    const v = (input?.value || input?.getAttribute('value') || '').trim();
    if (v && !same(v, '(no view)')) return v;
    try {
      const nm = (window.name || '').trim();
      const s = nm ? sessionStorage.getItem(VIEW_FOR_TAB(nm)) : '';
      if (s) return s;
    } catch {}
    const q = new URLSearchParams(location.search).get('cwview') || '';
    if (q) return q;
    const h = new URLSearchParams((location.hash||'').replace(/^#/, '')).get('cwview') || '';
    return h;
  }

  function getViewHintFromUrl() {
    const q = new URLSearchParams(location.search).get('cwview');
    if (q) return q;
    const h = new URLSearchParams((location.hash||'').replace(/^#/, '')).get('cwview');
    return h || '';
  }
  function getViewHintFromSession() {
    const nm = (window.name || '').trim();
    if (!nm) return '';
    try { return sessionStorage.getItem(VIEW_FOR_TAB(nm)) || ''; } catch {}
    return '';
  }
  async function resolveDesiredView() {
    return getViewHintFromUrl() || getViewHintFromSession();
  }

  async function applyViewHint() {
    // HARD GUARD: never attempt dropdown work unless we’re truly on the Service Board List
    if (!isServiceBoardListStrict()) return;

    const desired = (await resolveDesiredView()).trim();
    if (!desired) return;

    // Wait for the dropdown to exist
    for (let i=0;i<60;i++){
      if (hasViewDropdown()) break;
      await sleep(100);
    }
    // Try a few times (CW may re-render during redirect)
    for (let i=0;i<30;i++){
      const ok = await chooseFromDropdown(desired);
      if (ok) {
        try { sessionStorage.setItem(VIEW_FOR_TAB(window.name || ''), desired); } catch {}
        return;
      }
      await sleep(150);
    }
  }

  // ---------- observers / boot ----------
  const mo = new MutationObserver(() => { ensureToolbarButton(); });
  mo.observe(document.documentElement, { childList:true, subtree:true });

  ['pushState','replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(()=>{ ensureToolbarButton(); }); return r; };
  });
  window.addEventListener('resize', () => {
    const btn = document.getElementById('att-cw-open-views-btn');
    if (btn) positionBeforeExport(btn);
  }, true);

  (async () => {
    // First placement sweep
    for (let i=0;i<50;i++){
      ensureToolbarButton();
      if (isServiceBoardListStrict()) break;
      await sleep(120);
    }
    // Apply view only when we're actually on the SB List and visible
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') applyViewHint();
    });
    applyViewHint();
  })();
})();
