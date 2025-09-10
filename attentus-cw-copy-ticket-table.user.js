// ==UserScript==
// @name         attentus-cw-copy-ticket-table
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.4.0
// @description  Adds a blue "Copy Ticket Table" button next to CLEAR/Open Calendar View; copies visible Ticket (link) + Summary + Company
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
  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';
  const BTN_ID = 'cw-copy-ticket-table-btn';

  // --- Style injection (blue primary button) ---
  function injectStyles() {
    if (document.getElementById('cw-mm-style')) return;
    const css = `
      #${BTN_ID} {
        /* layout/position handled dynamically; keep visuals only here */
        -webkit-user-select: none; user-select: none;
        padding: 4px 12px;
        border-radius: 6px;
        font-family: system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        font-size: 12px; font-weight: 600;
        line-height: 18px;
        color: #fff;
        background: #1f73b7;            /* primary blue */
        border: 1px solid rgba(0,0,0,.08);
        box-shadow: 0 1px 0 rgba(255,255,255,.15) inset, 0 1px 4px rgba(0,0,0,.08);
        cursor: pointer;
        text-decoration: none;
        letter-spacing: .2px;
        white-space: nowrap;
      }
      #${BTN_ID}:hover { filter: brightness(0.97); }
      #${BTN_ID}:active { filter: brightness(0.94); transform: translateY(0.5px); }
      #${BTN_ID}:focus { outline: 2px solid #98c9ec; outline-offset: 1px; }
    `;
    const style = document.createElement('style');
    style.id = 'cw-mm-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  const isTicketId = (txt) => /^\d{6,}$/.test((txt || '').trim());

  // ---- Column pickers ----
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
    return nonTicket.sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0] || null;
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

  // ---- Copy payloads ----
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
    const id = 'cw-copy-toast';
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      Object.assign(el.style, {
        position: 'fixed', bottom: '70px', right: '16px',
        zIndex: 999999, padding: '8px 12px', borderRadius: '8px',
        color: '#fff', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif',
        fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,.2)', opacity: '0',
        transition: 'opacity .2s', pointerEvents: 'none'
      });
      document.body.appendChild(el);
    }
    el.style.background = ok ? '#16a34a' : '#dc2626';
    el.textContent = msg;
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => el.style.opacity = '0', 2500);
  }

  // ---- Placement right of CLEAR ----
  function getClearDiv() {
    return document.querySelector('div.cw-toolbar-clear'); // the CLEAR container you pointed out
  }

  function positionButton(clearDiv, btn) {
    if (!clearDiv || !btn) return;
    const parent = clearDiv.parentElement;
    if (!parent || btn.parentElement !== parent) {
      try { parent?.appendChild(btn); } catch {}
    }
    const left = clearDiv.offsetLeft + clearDiv.offsetWidth + 8; // 8px gap
    const top  = Math.max(0, clearDiv.offsetTop);                // align to CLEAR
    Object.assign(btn.style, {
      position: 'absolute',
      left: `${left}px`,
      top: `${top}px`,
      zIndex: 10
    });
  }

  function buildButton() {
    injectStyles();
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Copy Ticket Table');
    btn.tabIndex = 0;
    btn.textContent = 'Copy Ticket Table';

    const doCopy = async () => {
      const rows = collectRows();
      if (!rows.length) {
        toast('No visible rows found to copy.', false);
        return;
      }
      const html = makeHtmlTable(rows);
      const md = makeMarkdownTable(rows);
      const ok = await copyToClipboard(html, md);
      toast(ok ? `Copied ${rows.length} row(s).` : 'Copy failed (clipboard blocked).', ok);
    };
    btn.addEventListener('click', doCopy);
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCopy(); }
    });

    return btn;
  }

  function ensureButton() {
    const clearDiv = getClearDiv();
    if (!clearDiv) return;

    let btn = document.getElementById(BTN_ID);
    if (!btn) btn = buildButton();

    const parent = clearDiv.parentElement || document.body;
    if (btn.parentElement !== parent) parent.appendChild(btn);
    positionButton(clearDiv, btn);
  }

  // Kickoff & keep aligned in this SPA
  ensureButton();
  new MutationObserver(() => ensureButton()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', ensureButton);
  window.addEventListener('scroll', ensureButton, true);
})();
