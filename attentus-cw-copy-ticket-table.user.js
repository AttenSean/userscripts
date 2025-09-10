// ==UserScript==
// @name         attentus-cw-copy-ticket-table
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.6.3
// @description  Adds "Copy Ticket Table" next to CLEAR; copies visible Ticket (link) + Summary + Company; only on Service Board List
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-table.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-table.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';
  const BTN_ID = 'cw-copy-ticket-table-btn';
  const STYLE_ID = 'cw-copy-style';
  const TOAST_ID = 'cw-copy-toast';

  // ---------- Styles ----------
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${BTN_ID} {
        -webkit-user-select:none; user-select:none;
        padding:4px 12px; border-radius:6px;
        font:600 12px/18px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        color:#fff; background:#1f73b7;
        border:1px solid rgba(0,0,0,.08);
        box-shadow:0 1px 0 rgba(255,255,255,.15) inset, 0 1px 4px rgba(0,0,0,.08);
        cursor:pointer; white-space:nowrap;
        position:absolute; z-index:100;  /* anchor near CLEAR */
      }
      #${BTN_ID}:hover{filter:brightness(.97)}
      #${BTN_ID}:active{filter:brightness(.94); transform:translateY(.5px)}
      #${BTN_ID}:focus{outline:2px solid #98c9ec; outline-offset:1px}

      #${TOAST_ID}{
        position:fixed; bottom:70px; right:16px; z-index:2147483647;
        padding:8px 12px; border-radius:8px; color:#fff;
        font:12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        box-shadow:0 4px 16px rgba(0,0,0,.2); opacity:0; transition:opacity .2s; pointer-events:none;
      }
    `;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    document.head.appendChild(s);
  }

  // ---------- Gates ----------
  const isTicketId = (t) => /^\d{6,}$/.test((t || '').trim());
  const hasGrid = () => !!document.querySelector('table.srboard-grid tr.cw-ml-row a.multilineClickable');

  // detail label only (NOT navigationEntry); text must be "Service Board List"
  function isOnServiceBoardList() {
    const labels = Array.from(
      document.querySelectorAll('.cw-main-banner .cw_CwLabel.detailLabel:not(.navigationEntry), .cw-main-banner .gwt-Label.detailLabel:not(.navigationEntry)')
    );
    const match = labels.find(el => (el.textContent || '').trim().toLowerCase() === 'service board list');
    return !!match;
  }

  // ---------- Find CLEAR container (stable) ----------
  function getClearContainer() {
    // 1) Known container some tenants expose
    const byClass = document.querySelector('div.cw-toolbar-clear');
    if (byClass) return byClass;

    // 2) Button/text that literally says CLEAR (case-insensitive)
    const btns = Array.from(document.querySelectorAll('button, div, span, a')).filter(el => {
      const t = (el.textContent || '').trim();
      return t && /^clear$/i.test(t);
    });
    if (btns.length) {
      // Prefer visible, clickable
      const vis = btns.find(el => el.offsetParent !== null) || btns[0];
      // Use a stable positioned parent for absolute anchoring
      return vis.closest('div,td,th') || vis.parentElement || vis;
    }

    return null;
  }

  // ---------- Row extraction (original, working) ----------
  function getTicketAnchor(row) {
    let a = row.querySelector('td[cellindex="7"] a.multilineClickable');
    if (a && isTicketId(a.textContent)) return a;
    const cands = Array.from(row.querySelectorAll('a.multilineClickable')).filter(x => isTicketId(x.textContent));
    return cands[0] || null;
  }
  function getSummaryAnchor(row) {
    let a = row.querySelector('a.cw-ml-svc-desc');
    if (a && a.textContent.trim()) return a;
    const anchors = Array.from(row.querySelectorAll('a.multilineClickable'));
    const nonTicket = anchors.filter(a => !isTicketId(a.textContent));
    return nonTicket.sort((a,b)=>(b.textContent||'').length-(a.textContent||'').length)[0] || null;
  }
  function getCompanyCell(row, summaryA) {
    let td = row.querySelector('td[aria-label*="Company" i], td[data-columnid*="Company" i]');
    if (td) return td;
    if (summaryA) {
      let sTD = summaryA.closest('td');
      if (sTD?.previousElementSibling?.tagName === 'TD') return sTD.previousElementSibling;
    }
    return null;
  }
  function collectRows() {
    const rows = Array.from(document.querySelectorAll('table.srboard-grid tr.cw-ml-row'));
    const out = [];
    for (const row of rows) {
      if (row.offsetParent === null) continue; // visible only
      const ticketA  = getTicketAnchor(row);
      const summaryA = getSummaryAnchor(row);
      if (!ticketA || !summaryA) continue;
      const companyTD = getCompanyCell(row, summaryA);
      const ticket = (ticketA.textContent || '').trim();
      const summary = (summaryA.textContent || '').trim();
      const company = (companyTD?.innerText || companyTD?.textContent || '').trim();
      if (!isTicketId(ticket) || !summary) continue;
      out.push({ ticket, summary, company });
    }
    return out;
  }

  // ---------- Copy payloads (original pipeline) ----------
  function makeHtmlTable(rows) {
    const esc = (s) => (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const header = '<tr><th>Ticket</th><th>Summary</th><th>Company</th></tr>';
    const trs = rows.map(r => {
      const href = `${BASE}${PATH}${r.ticket}`;
      return `<tr>
        <td><a href="${esc(href)}" target="_blank" rel="noopener">${esc(r.ticket)}</a></td>
        <td>${esc(r.summary)}</td>
        <td>${esc(r.company)}</td>
      </tr>`;
    }).join('');
    return `<table>${header}${trs}</table>`;
  }
  function makeMarkdownTable(rows) {
    const esc = (s) => (s || '').replace(/\|/g, '\\|').trim();
    const header = `| Ticket | Summary | Company |\n|---|---|---|`;
    const lines = rows.map(r => {
      const href = `${BASE}${PATH}${r.ticket}`;
      return `| [${esc(r.ticket)}](${href}) | ${esc(r.summary)} | ${esc(r.company)} |`;
    });
    return [header, ...lines].join('\n');
  }
  async function copyToClipboard(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': blobHtml, 'text/plain': blobText })]);
        return true;
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function toast(msg, ok = true) {
    let el = document.getElementById(TOAST_ID);
    if (!el) { el = document.createElement('div'); el.id = TOAST_ID; document.body.appendChild(el); }
    el.style.background = ok ? '#16a34a' : '#dc2626';
    el.textContent = msg;
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => el.style.opacity = '0', 2200);
  }

  // ---------- Placement next to CLEAR ----------
  function positionButton(clearDiv, btn) {
    if (!clearDiv || !btn) return;
    const parent = clearDiv.parentElement || document.body;

    // Ensure parent can host absolute children without clipping under overflow
    const cs = getComputedStyle(parent);
    if (cs.position === 'static') parent.style.position = 'relative';

    // Put our button in the same parent as CLEAR
    if (btn.parentElement !== parent) parent.appendChild(btn);

    // Calculate left/top: right of CLEAR with 8px gap, align to CLEAR's top
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
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.textContent = 'Copy Ticket Table';
    btn.addEventListener('click', async () => {
      const rows = collectRows();
      if (!rows.length) { toast('No visible rows to copy.', false); return; }
      const html = makeHtmlTable(rows);
      const md   = makeMarkdownTable(rows);
      const ok   = await copyToClipboard(html, md);
      toast(ok ? `Copied ${rows.length} row${rows.length === 1 ? '' : 's'} ✓` : 'Copy failed', ok);
      // debug convenience
      window.__attentusLastTicketTableTSV = md;
    });
    return btn;
  }

  function mountOrMove() {
    // Strict gate: must be on Service Board List detail label AND grid present
    if (!(isOnServiceBoardList() && hasGrid())) { unmount(); return; }

    const clearDiv = getClearContainer();
    if (!clearDiv) { unmount(); return; }

    let btn = document.getElementById(BTN_ID);
    if (!btn) btn = buildButton();
    positionButton(clearDiv, btn);
  }

  function unmount() {
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.remove();
  }

  // ---------- Observe SPA + resize/scroll ----------
  function observe() {
    const mo = new MutationObserver(mountOrMove);
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', mountOrMove);
    window.addEventListener('scroll', mountOrMove, true);
    mountOrMove();
  }

  // Boot
  (async function boot() {
    for (let i = 0; i < 20; i++) {
      if (document.readyState !== 'loading') break;
      await new Promise(r => setTimeout(r, 80));
    }
    observe();
  })();
})();
