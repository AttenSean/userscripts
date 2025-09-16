// ==UserScript==
// @name         attentus-cw-copy-ticket-table
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.11.1
// @description  Copy selected columns from the Service Board grid with your own column order (drag & drop). First-run picker puts Ticket + Summary first/left; remembers choices; toasts & reconfigures if headers change. Left-click = copy, Shift-click = settings, Right-click = copy high+ priority Help Desk only.
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
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-table.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-table.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- constants ----------
  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';

  const BTN_ID     = 'cw-copy-ticket-table-btn';
  const STYLE_ID   = 'cw-copy-style';
  const TOAST_ID   = 'cw-copy-toast';
  const SETTINGS_K = 'att_cw_copy_table_columns_v2'; // includes custom order + titles

  // ---------- styles ----------
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${BTN_ID}{
        -webkit-user-select:none;user-select:none;position:absolute;z-index:100;
        padding:4px 12px;border-radius:6px;cursor:pointer;white-space:nowrap;
        font:600 12px/18px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        color:#fff;background:#1f73b7;border:1px solid rgba(0,0,0,.08);box-shadow:0 1px 0 rgba(0,0,0,.08)
      }
      #${BTN_ID}:hover{filter:brightness(.97)} #${BTN_ID}:active{filter:brightness(.94);transform:translateY(.5px)}
      #${BTN_ID}:focus{outline:2px solid #98c9ec;outline-offset:1px}

      #${TOAST_ID}{
        position:fixed;bottom:70px;right:16px;z-index:2147483647;pointer-events:none;
        padding:8px 12px;border-radius:8px;color:#fff;opacity:0;transition:opacity .2s;
        font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.2)
      }

      .cw-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483646;display:flex;align-items:flex-start;justify-content:center;padding-top:10vh}
      .cw-modal{background:#fff;color:#111;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);padding:16px;width:min(560px,95vw);font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      .cw-modal h3{margin:0 0 8px;font-size:14px;font-weight:600}

      /* Drag list */
      .cw-list{list-style:none;margin:0;padding:0}
      .cw-item{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid rgba(0,0,0,.12);border-radius:8px;margin:6px 0;background:#fafafa}
      .cw-item[draggable="true"]{cursor:grab}
      .cw-item.dragging{opacity:.5}
      .cw-handle{font:14px;opacity:.6;cursor:grab}
      .cw-title{flex:1;display:flex;align-items:center;gap:8px}
      .cw-title input[type="checkbox"]{margin:0}

      .cw-modal .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
      .cw-modal button{padding:6px 10px;border-radius:6px;border:1px solid rgba(0,0,0,.15);cursor:pointer}
      .cw-modal button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
    `;
    const s = document.createElement('style');
    s.id = STYLE_ID; s.textContent = css; document.head.appendChild(s);
  }

  // ---------- utils ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const escHtml = (s) => String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  const norm = (t) => String(t||'').replace(/\s+/g,' ').trim().toLowerCase();

  function toast(msg, ok = true) {
    let el = document.getElementById(TOAST_ID);
    if (!el) { el = document.createElement('div'); el.id = TOAST_ID; document.body.appendChild(el); }
    el.style.background = ok ? '#16a34a' : '#dc2626';
    el.textContent = msg;
    requestAnimationFrame(()=> el.style.opacity = '1');
    setTimeout(()=> el.style.opacity = '0', 2600);
  }

  async function gmGet(k, d){ try{ if (typeof GM!=='undefined'&&GM.getValue) return await GM.getValue(k,d);}catch{} try{ if (typeof GM_getValue==='function') return GM_getValue(k,d);}catch{} try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch{} return d;}
  async function gmSet(k,v){ try{ if (typeof GM!=='undefined'&&GM.setValue) return await GM.setValue(k,v);}catch{} try{ if (typeof GM_setValue==='function') return GM_setValue(k,v);}catch{} try{localStorage.setItem(k,JSON.stringify(v));}catch{} }

  // ---------- grid helpers ----------
  function getGridRoot() {
    return document.querySelector('table.srboard-grid') || document.querySelector('[class$="-grid"]');
  }
  function getHeaderContainer(grid) {
    return grid?.closest('.GMDB3DUBBXF, .mm_grid, .GMDB3DUBHWF')?.querySelector('.cw-ml-header') || null;
  }
  function scanHeaders() {
    const grid = getGridRoot(); if (!grid) return [];
    const header = getHeaderContainer(grid);
    let cols = [];

    if (header) {
      const trs = Array.from(header.querySelectorAll('table tr'));
      const labelRow = trs.reverse().find(tr => {
        const cells = Array.from(tr.children);
        const textful = cells.filter(td => (td.textContent || '').trim().length > 0);
        return cells.length > 1 && textful.length > 0;
      });
      if (labelRow) {
        cols = Array.from(labelRow.children).map((td, idx) => ({
          title: (td.textContent||'').trim(),
          label: norm(td.textContent),
          cellindex: String(idx)
        }));
      }
    }
    if (!cols.length) {
      const ths = grid.querySelectorAll('thead th, thead td');
      if (ths.length) cols = Array.from(ths).map((th, idx) => ({
        title: (th.textContent||'').trim(),
        label: norm(th.textContent),
        cellindex: String(idx)
      }));
    }
    return cols.filter(c => c.label);
  }
  function mapLiveByLabel() {
    const live = scanHeaders(); const map = new Map();
    for (const c of live) map.set(c.label, c);
    return { list: live, map };
  }
  function diffColumns(savedCols, liveCols) {
    const s = new Set(savedCols.map(c => c.label));
    const l = new Set(liveCols.map(c => c.label));
    const missing = [...s].filter(x => !l.has(x));
    const added   = [...l].filter(x => !s.has(x));
    return { missing, added, changed: missing.length || added.length };
  }

  // ---------- priority helpers (plain codes) ----------
  function parsePriorityFromCell(td) {
    const img = td?.querySelector('img');
    if (!img) return null;
    const bg = img.style.background || getComputedStyle(img).background || getComputedStyle(img).backgroundImage || '';
    const m = String(bg).match(/url\(["']?(data:[^"')]+)/i);
    if (!m) return null;

    const data = m[1], key = data.slice(0, 120);
    if (data.startsWith('data:image/png')) return { code: 'P0' };
    if (key.includes('AP8AAP'))            return { code: 'P1' };
    if (key.includes('AAAAAP//AP///'))     return { code: 'P3' };
    if (key.includes('AAAAAAAA/////'))     return { code: 'P4' };
    if (key.includes('AACAAP'))            return { code: 'P5' };
    if (key.includes('AAD49P'))            return { code: 'M'  };
    if (data.startsWith('data:image/gif')) return { code: 'P2' }; // fallback until exact P2 prefix captured
    return null;
  }

  // ---------- settings modal (drag & drop ordering) ----------
  async function showSettings(liveCols, savedConfig = null) {
    // Build working list with order & enabled flags
    let working = [];
    if (savedConfig && Array.isArray(savedConfig.cols)) {
      const liveMap = new Map(liveCols.map(c => [c.label, c]));
      for (const sc of savedConfig.cols) {
        const live = liveMap.get(sc.label);
        if (live) working.push({ label: sc.label, title: live.title || sc.title || sc.label, enabled: !!sc.enabled, order: sc.order|0 });
      }
      const savedLabels = new Set(savedConfig.cols.map(c => c.label));
      for (const lc of liveCols) {
        if (!savedLabels.has(lc.label)) working.push({ label: lc.label, title: lc.title, enabled: false, order: Number.MAX_SAFE_INTEGER - 100 + working.length });
      }
      working.sort((a,b)=> a.order - b.order);
    } else {
      // First run defaults → only Ticket + Summary prechecked (never "ticket tier?")
      const isTicket = (lbl) => lbl.includes('ticket') && !lbl.includes('tier');
      const isSummary = (lbl) => lbl.includes('summary');
      const ticketFirst = liveCols.filter(c => isTicket(c.label));
      const summaryNext = liveCols.filter(c => isSummary(c.label));
      const rest = liveCols.filter(c => !isTicket(c.label) && !isSummary(c.label));
      const ordered = [...ticketFirst, ...summaryNext, ...rest];
      working = ordered.map((c, i) => ({
        label: c.label, title: c.title, order: i,
        enabled: isTicket(c.label) || isSummary(c.label)
      }));
    }

    return new Promise(resolve => {
      const overlay = document.createElement('div'); overlay.className = 'cw-modal-overlay';
      const modal = document.createElement('div'); modal.className = 'cw-modal'; overlay.appendChild(modal);
      modal.innerHTML = `
  <h3>Copy Table — Columns & Order</h3>

  <div class="cw-help" style="font-size:12px;line-height:1.4;background:#f8fafc;border:1px solid rgba(0,0,0,.08);padding:8px 10px;border-radius:8px;margin:0 0 10px;">
    <div style="font-weight:600;margin-bottom:4px;">How to use</div>
    <ul style="margin:0 0 0 16px;padding:0;list-style:disc;">
      <li><b>Left-click</b> the button: copy using your selected columns & order.</li>
      <li><b>Right-click</b> the button: copy only <b>P0/P1/P2</b> rows from <b>Help Desk</b> boards.</li>
      <li><b>Shift-click</b> the button: open these settings.</li>
      <li>Drag ☰ to reorder columns; check/uncheck to include or exclude.</li>
      <li><b>Refresh Columns</b> rescans the grid if headers changed.</li>
    </ul>
  </div>

  <ul class="cw-list" id="cw-list"></ul>
  <div class="actions">
    <button id="cw-refresh">Refresh Columns</button>
    <button id="cw-cancel">Cancel</button>
    <button id="cw-save" class="primary">Save</button>
  </div>
`;

      const list = modal.querySelector('#cw-list');

      function render() {
        list.innerHTML = '';
        working.forEach((c, idx) => {
          const li = document.createElement('li');
          li.className = 'cw-item';
          li.draggable = true;
          li.dataset.idx = String(idx);
          li.innerHTML = `
            <div class="cw-handle" title="Drag to reorder">☰</div>
            <label class="cw-title">
              <input type="checkbox" ${c.enabled ? 'checked' : ''} data-role="chk">
              ${escHtml(c.title || c.label)}
            </label>
          `;
          list.appendChild(li);
        });
      }
      render();

      // checkbox toggle
      list.addEventListener('change', (e) => {
        const li = e.target.closest('.cw-item'); if (!li) return;
        const i = +li.dataset.idx;
        if (e.target.matches('input[type="checkbox"][data-role="chk"]')) {
          working[i].enabled = e.target.checked;
        }
      });

      // drag & drop
      list.addEventListener('dragstart', (e) => {
        const li = e.target.closest('.cw-item'); if (!li) return;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragend', (e) => {
        const li = e.target.closest('.cw-item');
        if (li) li.classList.remove('dragging');
        working.forEach((c, i) => c.order = i);
      });
      list.addEventListener('dragover', (e) => {
        e.preventDefault(); // allow drop
        const after = getDragAfterElement(list, e.clientY);
        const dragging = list.querySelector('.cw-item.dragging');
        if (!dragging) return;
        if (after == null) list.appendChild(dragging);
        else list.insertBefore(dragging, after);
      });
      list.addEventListener('drop', () => {
        // rebuild working from current DOM order
        const items = Array.from(list.querySelectorAll('.cw-item'));
        const next = [];
        items.forEach((li, i) => {
          const oldIdx = +li.dataset.idx;
          next.push(working[oldIdx]);
        });
        working = next;
        // reassign data-idx to match new order
        Array.from(list.children).forEach((li, i) => li.dataset.idx = String(i));
        working.forEach((c, i) => c.order = i);
      });
      function getDragAfterElement(container, y) {
        const els = [...container.querySelectorAll('.cw-item:not(.dragging)')];
        return els.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) return { offset, element: child };
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      // actions
      modal.querySelector('#cw-refresh').onclick = () => { document.body.removeChild(overlay); resolve('refresh'); };
      modal.querySelector('#cw-cancel').onclick  = () => { document.body.removeChild(overlay); resolve(null); };
      modal.querySelector('#cw-save').onclick    = () => {
        if (!working.some(c => c.enabled)) { toast('Select at least one column', false); return; }
        if (!working.some(c => c.enabled && c.label.includes('ticket') && !c.label.includes('tier')) &&
            !working.some(c => c.enabled && c.label.includes('summary'))) {
          toast('Heads-up: Ticket & Summary are usually included', false);
        }
        working.forEach((c, i) => c.order = i);
        const config = { cols: working.map(c => ({ label: c.label, title: c.title, enabled: !!c.enabled, order: c.order })) };
        document.body.removeChild(overlay);
        resolve(config);
      };

      document.body.appendChild(overlay);
    });
  }

  // ---------- row collection ----------
  function collectRows(config, liveMap, filterFn) {
    const grid = getGridRoot(); if (!grid) return { rows: [], colsResolved: [] };

    const enabled = [...config.cols].filter(c => c.enabled).sort((a,b)=> a.order - b.order);
    const colsResolved = enabled.map(c => {
      const live = liveMap.get(c.label);
      return live ? { label: c.label, title: c.title || live.title, cellindex: live.cellindex } : null;
    }).filter(Boolean);

    const trs = Array.from(grid.querySelectorAll('tr.cw-ml-row'));
    const out = [];
    for (const row of trs) {
      if (row.offsetParent === null) continue;
      if (typeof filterFn === 'function' && !filterFn(row, liveMap)) continue;

      const record = {};
      for (const col of colsResolved) {
        const td = row.querySelector(`td[cellindex="${col.cellindex}"]`);
        let val = (td?.innerText || td?.textContent || '').trim();

        if (col.label.includes('priority')) {
          const p = parsePriorityFromCell(td);
          const code = p?.code || val || '';
          record[col.title] = escHtml(code);
          record[`__txt__${col.title}`] = code;
          continue;
        }
        if (col.label.includes('ticket') && !col.label.includes('tier') && /^\d{5,}$/.test(val)) {
          record[col.title] = `<a href="${BASE}${PATH}${val}" target="_blank" rel="noopener">${escHtml(val)}</a>`;
          record[`__txt__${col.title}`] = val;
          continue;
        }

        record[col.title] = escHtml(val);
        record[`__txt__${col.title}`] = val;
      }
      if (Object.keys(record).length) out.push(record);
    }
    return { rows: out, colsResolved };
  }

  // Helpers to resolve cells by fuzzy header label
  function firstLabelMatching(liveCols, substrings) {
    const subs = substrings.map(norm);
    return liveCols.find(c => subs.some(s => c.label.includes(s)));
  }
  function getCellTextByLabel(row, liveCols, keywords) {
    const col = firstLabelMatching(liveCols, keywords);
    if (!col) return null;
    const td = row.querySelector(`td[cellindex="${col.cellindex}"]`);
    return (td?.innerText || td?.textContent || '').trim() || null;
  }
  function getPriorityCodeByLabel(row, liveCols) {
    const col = firstLabelMatching(liveCols, ['priority']);
    if (!col) return null;
    const td = row.querySelector(`td[cellindex="${col.cellindex}"]`);
    return parsePriorityFromCell(td)?.code || null;
  }

  // ---------- builders ----------
  function makeHtmlTable(rows, columns) {
    const header = `<tr>${columns.map(c => `<th>${escHtml(c.title)}</th>`).join('')}</tr>`;
    const trs = rows.map(r => `<tr>${columns.map(c => `<td>${r[c.title] || ''}</td>`).join('')}</tr>`).join('');
    return `<table>${header}${trs}</table>`;
  }
  function makeHtmlWithTitle(titleText, tableHtml) {
    if (!titleText) return tableHtml;
    return `<div style="font-weight:600;margin-bottom:6px">${escHtml(titleText)}</div>${tableHtml}`;
  }
  function makeMarkdownTable(rows, columns, titleRow = '') {
    const title = titleRow ? `**${titleRow}**\n` : '';
    const header = `| ${columns.map(c => c.title).join(' | ')} |\n|${columns.map(()=> '---').join('|')}|`;
    const lines  = rows.map(r => `| ${columns.map(c => (r[`__txt__${c.title}`] ?? r[c.title] ?? '')).join(' | ')} |`);
    return [title + header, ...lines].join('\n');
  }

  async function copyToClipboard(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
        return true;
      }
    } catch {}
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; } } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch { return false; }
  }

  // ---------- button placement ----------
  function getClearContainer() {
    return document.querySelector('div.cw-toolbar-clear') ||
      Array.from(document.querySelectorAll('button, div, span, a')).find(el => /^clear$/i.test((el.textContent||'').trim()));
  }
  function positionButton(clearDiv, btn) {
    if (!clearDiv || !btn) return;
    const parent = clearDiv.parentElement || document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    if (btn.parentElement !== parent) parent.appendChild(btn);
    const gap = 8;
    const rectParent = parent.getBoundingClientRect();
    const rectClear  = clearDiv.getBoundingClientRect();
    const left = (rectClear.left - rectParent.left) + rectClear.width + gap;
    const top  = (rectClear.top  - rectParent.top);
    btn.style.left = `${Math.max(0, left)}px`;
    btn.style.top  = `${Math.max(0, top)}px`;
  }

  function buildButton() {
    injectStyles();
    const btn = document.createElement('button');
btn.id = BTN_ID; btn.type = 'button'; btn.textContent = 'Copy Table';
btn.title = 'Left-click: Copy table\nRight-click: Copy High+ Help Desk\nShift-click: Settings';


    // Left-click (normal copy). Shift-click remains settings (handled inside handler).
    btn.addEventListener('click', async (e) => {
      const { list: liveCols, map: liveMap } = mapLiveByLabel();
      if (!liveCols.length) { toast('Couldn’t detect headers', false); return; }

      let config = await gmGet(SETTINGS_K, null);

      if (!config) {
        toast('First run: please select columns');
        const sel = await showSettings(liveCols, null);
        if (!sel || sel === 'refresh') return;
        config = sel;
        await gmSet(SETTINGS_K, config);
      } else {
        const diff = diffColumns(config.cols, liveCols);
        if (diff.changed) {
          if (diff.added.length)   toast(`New columns: ${diff.added.join(', ')}`, false);
          if (diff.missing.length) toast(`Missing columns: ${diff.missing.join(', ')}`, false);
          const updated = await showSettings(liveCols, config);
          if (!updated || updated === 'refresh') return;
          config = updated;
          await gmSet(SETTINGS_K, config);
        }
      }

      if (e.shiftKey) {
        const updated = await showSettings(liveCols, config);
        if (updated && updated !== 'refresh') { config = updated; await gmSet(SETTINGS_K, config); }
        return;
      }

      const { rows, colsResolved } = collectRows(config, liveMap);
      if (!rows.length) {
        toast('No visible rows (or selected columns are empty). Shift+Click to adjust.', false);
        return;
      }
      const html = makeHtmlWithTitle('', makeHtmlTable(rows, colsResolved)); // no title for normal copy
      const md   = makeMarkdownTable(rows, colsResolved);
      const ok   = await copyToClipboard(html, md);
      toast(ok ? `Copied ${rows.length} row${rows.length === 1 ? '' : 's'} ✓` : 'Copy failed', ok);
      window.__attentusLastTicketTableMD = md;
    });

    // Right-click (context menu) → copy only P2/P1/P0 and Service Board contains "help desk"
    btn.addEventListener('contextmenu', async (e) => {
      e.preventDefault();

      const { list: liveCols, map: liveMap } = mapLiveByLabel();
      if (!liveCols.length) { toast('Couldn’t detect headers', false); return; }

      let config = await gmGet(SETTINGS_K, null);
      if (!config) {
        toast('First run: please select columns');
        const sel = await showSettings(liveCols, null);
        if (!sel || sel === 'refresh') return;
        config = sel;
        await gmSet(SETTINGS_K, config);
      }

      // Resolve needed columns for filtering
      const hasPriority = !!firstLabelMatching(liveCols, ['priority']);
      if (!hasPriority) { toast('Priority column not visible in this view.', false); return; }
      const boardCol = firstLabelMatching(liveCols, ['service board','board']); // optional, filter if present

      // Filter function
      const filterFn = (row) => {
        const pri = getPriorityCodeByLabel(row, liveCols);
        if (!pri || !['P0','P1','P2'].includes(pri)) return false;
        if (boardCol) {
          const board = getCellTextByLabel(row, liveCols, ['service board','board']) || '';
          if (!board.toLowerCase().includes('help desk')) return false;
        }
        return true;
      };

      const { rows, colsResolved } = collectRows(config, liveMap, filterFn);
      if (!rows.length) { toast('No matching rows (P0/P1/P2 + Help Desk).', false); return; }

      const title = 'High+ Priority Tickets';
      const html = makeHtmlWithTitle(title, makeHtmlTable(rows, colsResolved)); // title OUTSIDE the table
      const md   = makeMarkdownTable(rows, colsResolved, title);                // markdown title stays a bold line
      const ok   = await copyToClipboard(html, md);
      toast(ok ? `Copied ${rows.length} high+ row${rows.length === 1 ? '' : 's'} ✓` : 'Copy failed', ok);
      window.__attentusLastTicketTableMD = md;
    });

    return btn;
  }

  // ---------- mount ----------
  function getClearContainer() {
    return document.querySelector('div.cw-toolbar-clear') ||
      Array.from(document.querySelectorAll('button, div, span, a')).find(el => /^clear$/i.test((el.textContent||'').trim()));
  }
  function positionButton(clearDiv, btn) {
    if (!clearDiv || !btn) return;
    const parent = clearDiv.parentElement || document.body;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    if (btn.parentElement !== parent) parent.appendChild(btn);
    const gap = 8;
    const rectParent = parent.getBoundingClientRect();
    const rectClear  = clearDiv.getBoundingClientRect();
    const left = (rectClear.left - rectParent.left) + rectClear.width + gap;
    const top  = (rectClear.top  - rectParent.top);
    btn.style.left = `${Math.max(0, left)}px`;
    btn.style.top  = `${Math.max(0, top)}px`;
  }

  function mountOrMove() {
    const clearDiv = getClearContainer(); if (!clearDiv) return;
    let btn = document.getElementById(BTN_ID); if (!btn) btn = buildButton();
    positionButton(clearDiv, btn);
  }

  function observe() {
    const mo = new MutationObserver(mountOrMove);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', mountOrMove);
    window.addEventListener('scroll', mountOrMove, true);
    mountOrMove();
  }

  (async function boot(){
    for (let i=0;i<20;i++){ if (document.readyState!=='loading') break; await sleep(80); }
    observe();
  })();
})();
