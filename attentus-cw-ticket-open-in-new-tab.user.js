// ==UserScript==
// @name         attentus-cw-ticket-open-in-new-tab
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1.0
// @description  Replaces ticket # cells with real <a> links to the v4_6 ticket URL (always opens in a new tab).
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-open-in-new-tab.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-open-in-new-tab.user.js
// ==/UserScript==


(function () {
  // Build the direct URL using the current host (keeps na/eu/au tenants correct)
  const BASE = location.origin;
  const PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';

  // Heuristic: ticket numbers are 6+ digits (e.g., 3728487)
  const isTicketId = (txt) => /^\d{6,}$/.test((txt || '').trim());

  // Preferred locator: the ticket column is usually td[cellindex="7"]
  // Fallback: any multilineClickable whose text is 6+ digits (avoids "0", "1", etc. in other numeric columns)
  function findTicketAnchors(root = document) {
    const exactCol = root.querySelectorAll(
      'table.srboard-grid tr.cw-ml-row td[cellindex="7"] a.multilineClickable'
    );
    const fromAll = root.querySelectorAll(
      'table.srboard-grid tr.cw-ml-row a.multilineClickable'
    );

    // If the board uses the standard column mapping, exactCol will be plenty.
    // Otherwise, filter anything that looks like a ticket number.
    const set = exactCol.length ? exactCol : Array.from(fromAll).filter(a => isTicketId(a.textContent));
    return set;
  }

  function upgradeAnchor(a) {
    if (!a || a.dataset.cwTicketLinked === '1') return;

    const id = (a.textContent || '').trim();
    if (!isTicketId(id)) return;

    const url = `${BASE}${PATH}${id}`;

    // Make this a "real" link that opens externally rather than letting CW intercept it.
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cursor = 'pointer';
    a.dataset.cwTicketLinked = '1';
    a.title = a.title || `Open ticket ${id} in new tab`;

    // Stop CW's handlers from hijacking the click. We open the tab ourselves every time.
    a.addEventListener('click', function (ev) {
      // Avoid double-open on middle click; we handle everything ourselves.
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.open(url, '_blank', 'noopener,noreferrer');
      return false;
    }, true);
  }

  function scan(root = document) {
    findTicketAnchors(root).forEach(upgradeAnchor);
  }

  // Initial pass (boards can be slow to paint)
  const start = Date.now();
  const iv = setInterval(() => {
    scan();
    if (Date.now() - start > 5000) clearInterval(iv);
  }, 250);

  // Keep up with live updates / paging / filter changes
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) scan(n);
        });
      }
      // Some boards change textContent in-place
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
