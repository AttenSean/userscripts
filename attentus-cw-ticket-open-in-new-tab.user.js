// ==UserScript==
// @name         attentus-cw-ticket-open-in-new-tab
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.4.0
// @description  Ticket # opens in new tab; SHIFT+Click copies a rich HTML link built from Ticket + Summary + Company (robust columns + resilient clipboard)
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-open-in-new-tab.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-open-in-new-tab.user.js
// ==/UserScript==

(function () {
  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';

  const isTicketId = (txt) => /^\d{6,}$/.test((txt || '').trim());
  const textOf = (el) => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

  // --- Find ticket anchors inside Service Board grid rows ---
  function findTicketAnchors(root = document) {
    const anchors = root.querySelectorAll('table.srboard-grid tr.cw-ml-row a.multilineClickable');
    return Array.from(anchors).filter(a => isTicketId(a.textContent));
  }

  // --- Robust column picking (Ticket, Summary, Company) ---
  function pickSummaryCell(row) {
    // Prefer explicit summary anchor when present
    const explicit = row.querySelector('a.multilineClickable.cw-ml-svc-desc');
    if (explicit && textOf(explicit)) return explicit.closest('td') || explicit;

    // Otherwise pick the longest non-numeric text cell (skips Resource, pure numbers)
    let bestTd = null, bestLen = 0;
    for (const td of row.querySelectorAll('td')) {
      const t = textOf(td);
      if (!t || /^\d+$/.test(t) || /^resource$/i.test(t)) continue;
      if (t.length > bestLen) { bestLen = t.length; bestTd = td; }
    }
    return bestTd;
  }

  function pickCompanyCell(row, summaryTd) {
    // 1) Semantic attributes first
    const sem = row.querySelector('td[aria-label*="Company" i], td[data-columnid*="Company" i]');
    if (sem && textOf(sem)) return sem;

    // 2) Try the cell immediately before Summary (common layout)
    if (summaryTd) {
      const prev = summaryTd.previousElementSibling;
      if (prev && textOf(prev) && !/^\d+$/.test(textOf(prev)) && !/^resource$/i.test(textOf(prev))) return prev;
    }

    // 3) Otherwise, first earlier cell with non-numeric text
    const cells = Array.from(row.querySelectorAll('td'));
    const sumIdx = summaryTd ? cells.indexOf(summaryTd) : cells.length;
    for (let i = 0; i < sumIdx; i++) {
      const td = cells[i];
      const val = textOf(td);
      if (val && !/^\d+$/.test(val) && !/^resource$/i.test(val)) return td;
    }
    return null;
  }

  function buildRowLabel(a) {
    const row = a.closest('tr.cw-ml-row');
    const ticket = (a.textContent || '').trim();
    if (!row) return { ticket, summary: '', company: '' };

    const summaryTd = pickSummaryCell(row);
    const companyTd = pickCompanyCell(row, summaryTd);

    return {
      ticket,
      summary: textOf(summaryTd),
      company: textOf(companyTd),
    };
  }

  function escapeHtml(s) {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Resilient clipboard: HTML+plain (ClipboardItem) → writeText → execCommand fallback ---
  async function copyRich(html, plain) {
    // A) Rich HTML + plain text
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch {}

    // B) Userscript APIs (may accept HTML in some engines)
    try { if (typeof GM !== 'undefined' && GM.setClipboard) { GM.setClipboard(html, { type: 'text/html' }); return true; } } catch {}
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(html, { type: 'text/html' }); return true; } } catch {}

    // C) Text-only modern
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(plain); return true; } } catch {}

    // D) Old-school textarea fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = plain;
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch {}

    return false;
  }

  function flashCopied(target, ok = true) {
    const tag = document.createElement('span');
    tag.textContent = ok ? 'Copied' : 'Copy failed';
    tag.style.position = 'absolute';
    tag.style.zIndex = '99999';
    tag.style.fontSize = '12px';
    tag.style.fontWeight = '600';
    tag.style.padding = '2px 6px';
    tag.style.borderRadius = '8px';
    tag.style.boxShadow = '0 1px 3px rgba(0,0,0,.25)';
    tag.style.background = ok ? '#d1fae5' : '#fee2e2';
    tag.style.border = '1px solid rgba(0,0,0,.15)';
    tag.style.transform = 'translate(-50%, -140%)';
    tag.style.whiteSpace = 'nowrap';
    const rect = target.getBoundingClientRect();
    tag.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    tag.style.top = `${rect.top + window.scrollY}px`;
    document.body.appendChild(tag);
    setTimeout(() => tag.remove(), 900);
  }

  function upgradeAnchor(a) {
    if (!a || a.dataset.cwTicketLinked === '1') return;
    const id = (a.textContent || '').trim();
    if (!isTicketId(id)) return;

    const url = `${BASE}${PATH}${id}`;
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cursor = 'pointer';
    a.dataset.cwTicketLinked = '1';
    a.title = a.title || `Open ticket ${id} in new tab (Shift+Click to copy link)`;

    a.addEventListener('click', async function (ev) {
      // Always take over so CW doesn't hijack
      ev.preventDefault();
      ev.stopImmediatePropagation();

      if (ev.shiftKey) {
        const { ticket, summary, company } = buildRowLabel(a);
        const labelText = [ticket, summary, company].filter(Boolean).join(' — ');
        const html = `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelText)}</a>`;
        const ok = await copyRich(html, labelText);
        flashCopied(a, ok);
        return false;
      }

      window.open(url, '_blank', 'noopener,noreferrer');
      return false;
    });
  }

  function scan(root = document) {
    findTicketAnchors(root).forEach(upgradeAnchor);
  }

  // Short warm-up scan for initial hydration + SPA observer
  const start = Date.now();
  const iv = setInterval(() => {
    scan();
    if (Date.now() - start > 5000) clearInterval(iv);
  }, 250);

  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(n => { if (n.nodeType === 1) scan(n); });
      }
      if (m.type === 'characterData') {
        const el = m.target && m.target.parentElement;
        if (el && el.closest) {
          const a = el.closest('a.multilineClickable');
          if (a) upgradeAnchor(a);
        }
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
