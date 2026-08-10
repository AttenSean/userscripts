// ==UserScript==
// @name         attentus-cw-ticket-open-in-new-tab
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.5.0
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
  'use strict';

  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';

  const DATASET_KEY = 'cwTicketSummaryLinked';

  const TARGET_SELECTOR = [
    'a.multilineClickable',
    'a.cw-ml-clickable-cell',
    'a.cw-ml-svc-desc'
  ].join(',');

  const SUMMARY_SELECTOR = [
    'a.multilineClickable.cw-ml-svc-desc',
    'a.cw-ml-svc-desc'
  ].join(',');

  function textOf(el) {
    return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isTicketId(value) {
    return /^\d{6,}$/.test((value || '').trim());
  }

  function getTicketUrl(ticketId) {
    return `${BASE}${PATH}${ticketId}`;
  }

  function getRow(el) {
    return el && el.closest ? el.closest('tr.cw-ml-row, tr') : null;
  }

  function consumeEvent(ev, preventDefault = true) {
    if (preventDefault) ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  }

  function isUsefulTextCellText(value) {
    return Boolean(value) &&
      !/^\d+$/.test(value) &&
      !/^resource$/i.test(value);
  }

  function getTicketIdFromRow(row) {
    if (!row) return null;

    for (const link of row.querySelectorAll('a')) {
      const value = textOf(link);

      if (isTicketId(value)) {
        return value;
      }
    }

    const match = textOf(row).match(/\b\d{6,}\b/);
    return match ? match[0] : null;
  }

  function getTicketIdFromElement(el) {
    const ownText = textOf(el);

    if (isTicketId(ownText)) {
      return ownText;
    }

    return getTicketIdFromRow(getRow(el));
  }

  function getTicketInfo(el) {
    const ticketId = getTicketIdFromElement(el);

    if (!ticketId) {
      return null;
    }

    return {
      ticketId,
      url: getTicketUrl(ticketId)
    };
  }

  function hasAttrContaining(el, attrNamePart, valuePart) {
    if (!el || !el.attributes) return false;

    const attrNeedle = attrNamePart.toLowerCase();
    const valueNeedle = valuePart.toLowerCase();

    for (const attr of el.attributes) {
      const attrName = attr.name.toLowerCase();
      const attrValue = String(attr.value || '').toLowerCase();

      if (attrName.includes(attrNeedle) && attrValue.includes(valueNeedle)) {
        return true;
      }
    }

    return false;
  }

  function findLongestUsefulTextCell(row) {
    let bestCell = null;
    let bestLength = 0;

    for (const td of row.querySelectorAll('td')) {
      const value = textOf(td);

      if (!isUsefulTextCellText(value)) continue;

      if (value.length > bestLength) {
        bestLength = value.length;
        bestCell = td;
      }
    }

    return bestCell;
  }

  function findFirstUsefulCellBefore(row, boundaryCell) {
    const cells = Array.from(row.querySelectorAll('td'));
    const boundaryIndex = boundaryCell ? cells.indexOf(boundaryCell) : cells.length;

    for (let i = 0; i < boundaryIndex; i++) {
      const td = cells[i];

      if (isUsefulTextCellText(textOf(td))) {
        return td;
      }
    }

    return null;
  }

  function findSemanticCompanyCell(row) {
    for (const td of row.querySelectorAll('td')) {
      const looksLikeCompany =
        hasAttrContaining(td, 'aria-label', 'company') ||
        hasAttrContaining(td, 'data-columnid', 'company') ||
        hasAttrContaining(td, 'data-column', 'company');

      if (looksLikeCompany && textOf(td)) {
        return td;
      }
    }

    return null;
  }

  function pickSummaryCell(row) {
    if (!row) return null;

    const explicit = row.querySelector(SUMMARY_SELECTOR);

    if (explicit && textOf(explicit)) {
      return explicit.closest('td') || explicit;
    }

    return findLongestUsefulTextCell(row);
  }

  function pickCompanyCell(row, summaryCell) {
    if (!row) return null;

    const semanticCompanyCell = findSemanticCompanyCell(row);

    if (semanticCompanyCell) {
      return semanticCompanyCell;
    }

    const previousCell = summaryCell && summaryCell.previousElementSibling;

    if (previousCell && isUsefulTextCellText(textOf(previousCell))) {
      return previousCell;
    }

    return findFirstUsefulCellBefore(row, summaryCell);
  }

  function buildRowLabel(el) {
    const row = getRow(el);
    const ticket = getTicketIdFromElement(el) || textOf(el);

    if (!row) {
      return {
        ticket,
        summary: '',
        company: ''
      };
    }

    const summaryCell = pickSummaryCell(row);
    const companyCell = pickCompanyCell(row, summaryCell);

    return {
      ticket,
      summary: textOf(summaryCell),
      company: textOf(companyCell)
    };
  }

  function escapeHtml(value) {
    return (value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function copyRich(html, plain) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' })
        });

        await navigator.clipboard.write([item]);
        return true;
      }
    } catch {}

    try {
      if (typeof GM !== 'undefined' && GM.setClipboard) {
        await GM.setClipboard(html, { type: 'text/html' });
        return true;
      }
    } catch {}

    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(html, { type: 'text/html' });
        return true;
      }
    } catch {}

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plain);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement('textarea');

      ta.value = plain;
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';

      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand && document.execCommand('copy');

      document.body.removeChild(ta);

      if (ok) return true;
    } catch {}

    return false;
  }

  function flashCopied(target, ok = true) {
    const tag = document.createElement('span');
    const rect = target.getBoundingClientRect();

    Object.assign(tag.style, {
      position: 'absolute',
      zIndex: '99999',
      fontSize: '12px',
      fontWeight: '600',
      padding: '2px 6px',
      borderRadius: '8px',
      boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      background: ok ? '#d1fae5' : '#fee2e2',
      border: '1px solid rgba(0,0,0,.15)',
      transform: 'translate(-50%, -140%)',
      whiteSpace: 'nowrap',
      left: `${rect.left + rect.width / 2 + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`
    });

    tag.textContent = ok ? 'Copied' : 'Copy failed';

    document.body.appendChild(tag);

    setTimeout(() => tag.remove(), 900);
  }

  async function copyRichTicketLink(el) {
    const info = getTicketInfo(el);

    if (!info) {
      return false;
    }

    const { ticket, summary, company } = buildRowLabel(el);
    const labelText = [ticket, summary, company].filter(Boolean).join(' — ');
    const html = `<a href="${info.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(labelText)}</a>`;

    const ok = await copyRich(html, labelText);

    flashCopied(el, ok);

    return ok;
  }

  function isSummaryDescription(el) {
    return el && el.classList && el.classList.contains('cw-ml-svc-desc');
  }

  function isTicketNumberField(el) {
    return isTicketId(textOf(el));
  }

  function shouldUpgrade(el) {
    if (!el || el.dataset[DATASET_KEY] === '1') return false;
    if (!getTicketInfo(el)) return false;

    return isTicketNumberField(el) || isSummaryDescription(el);
  }

  function handleClick(ev) {
    const el = ev.currentTarget;
    const info = getTicketInfo(el);

    if (!info) return;

    if (ev.shiftKey) {
      consumeEvent(ev);
      copyRichTicketLink(el);
      return false;
    }

    if (ev.button === 0) {
      consumeEvent(ev);

      window.open(info.url, '_blank', 'noopener,noreferrer');

      return false;
    }
  }

  function handleMiddleClick(ev) {
    if (ev.button !== 1) return;

    /*
      Important:
      Do not preventDefault() here.
      Let the browser handle the real href + target="_blank" natively.
      This avoids duplicate tabs and preserves background-tab behavior.
    */
    consumeEvent(ev, false);
  }

  function upgradeLink(el) {
    if (!shouldUpgrade(el)) return;

    const info = getTicketInfo(el);

    el.href = info.url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    el.style.cursor = 'pointer';
    el.dataset[DATASET_KEY] = '1';
    el.title = el.title || `Open ticket ${info.ticketId} in new tab. Shift+Click copies rich link.`;

    el.addEventListener('click', handleClick, true);
    el.addEventListener('mousedown', handleMiddleClick, true);
    el.addEventListener('auxclick', handleMiddleClick, true);
  }

  function scan(root = document) {
    if (!root) return;

    const found = new Set();

    if (root.matches && root.matches(TARGET_SELECTOR)) {
      found.add(root);
    }

    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll(TARGET_SELECTOR)) {
        found.add(el);
      }
    }

    for (const el of found) {
      upgradeLink(el);
    }
  }

  function startWarmupScan() {
    const start = Date.now();

    const interval = setInterval(() => {
      scan(document);

      if (Date.now() - start > 10000) {
        clearInterval(interval);
      }
    }, 250);
  }

  function startObserver() {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes || []) {
          if (node.nodeType === 1) {
            scan(node);
          }
        }

        if (mutation.type === 'characterData') {
          const el = mutation.target && mutation.target.parentElement;
          const link = el && el.closest && el.closest(TARGET_SELECTOR);

          if (link) {
            upgradeLink(link);
          }
        }
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  scan(document);
  startWarmupScan();
  startObserver();

  console.log('[CW Ticket/Summary Open + Rich Copy] Loaded');
})();
