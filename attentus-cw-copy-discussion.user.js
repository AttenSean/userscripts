// ==UserScript==
// @name         attentus-cw-copy-discussion
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.4.0
// @description  Compact "Copy" button by New Note on Service Tickets. Copies visible Discussion notes with a header (Ticket, Company, Contact, and Contact Insight when available) — no duplicates.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-discussion.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-discussion.user.js
// ==/UserScript==

(function () {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  async function copyRichPlain(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      }
    } catch {}
    try { if (typeof GM !== 'undefined' && GM.setClipboard) { GM.setClipboard(html, { type:'text/html' }); return true; } } catch {}
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(html); return true; } } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      return true;
    } catch {}
    return false;
  }

  // ----- header fields -----
  function getTicketNumber() {
    const m = (document.title || '').match(/#(\d{3,})/);
    return m ? m[1] : '';
  }
  const getVal = (sel) => document.querySelector(sel)?.value?.trim() || '';
  function getCompany() { return getVal('input.cw_company') || getVal('[data-cwid="company"] input[readonly]'); }
  function getContact() { return getVal('input.cw_contact') || getVal('[data-cwid="contact"] input[readonly]'); }

  // ----- Contact Insight (optional) -----
  // Tries to find a pod/section whose text includes "Contact Insight", then read "Job Title" and "Type".
  function getContactInsight() {
    // find a plausible panel
    const candidates = Array.from(document.querySelectorAll(
      [
        '[data-cwid*="contact"]',
        '[data-cwid*="insight"]',
        '[id*="contact"]',
        '[id*="insight"]',
        '[class*="contact"]',
        '[class*="insight"]',
        '.CwPod', '.pod', '.panel', 'section'
      ].join(',')
    ));

    const panel = candidates.find(el => /Contact\s+Insight/i.test(el.textContent || ''));
    if (!panel) return null;

    const readLabeled = (root, labelRegex) => {
      // 1) Label -> sibling/row value
      const labels = Array.from(root.querySelectorAll('label,.label,.CwFieldLabel,dt,th,span,div'))
        .filter(el => labelRegex.test(el.textContent || ''));
      for (const lab of labels) {
        const sibVal = lab.nextElementSibling?.textContent?.trim();
        if (sibVal) return sibVal;
        const row = lab.closest('tr, dl, .row, .CwRow, .grid, .table');
        if (row) {
          const cell = row.querySelector('td:last-child, dd, .value, .CwValue');
          const v = cell?.textContent?.trim();
          if (v) return v;
        }
      }
      // 2) Fallback: parse inline "Label: Value" from innerText
      const txt = root.textContent || '';
      const m = txt.match(new RegExp(labelRegex.source + '\\s*:\\s*(.+?)(?:\\n|$)', 'i'));
      return m ? m[1].trim() : '';
    };

    const jobTitle = readLabeled(panel, /Job\s*Title/i);
    const type = readLabeled(panel, /^Type/i);

    if (!jobTitle && !type) return null;
    return { jobTitle, type };
  }

  // ----- de-duped extraction -----
  function extractNotes(podRoot) {
    const rows = podRoot.querySelectorAll('.TicketNote-rowWrap .TicketNote-row');
    const out = [];

    rows.forEach(row => {
      const author = row.querySelector('.TicketNote-clickableName, .TicketNote-basicName, .TicketNote-skittleAvatar')?.textContent?.trim() || '';
      const date   = row.querySelector('.TimeText-date')?.textContent?.trim() || '';

      // Read only labeled note content to avoid dupes
      const blocks = row.querySelectorAll('.TicketNote-rowNote');
      const parts = [];
      blocks.forEach(block => {
        const label = block.querySelector('.TicketNote-noteLabel');
        const text = (label?.innerText || block.innerText || '').trim();
        if (text) parts.push(text);
      });

      const unique = Array.from(new Set(parts));
      const text = unique.join('\n\n');

      if (author || date || text) out.push({ author, date, text });
    });

    return out;
  }

  function buildPayload(podRoot) {
    const tab = podRoot.querySelector('.TicketNote-ticketNoteTable .TicketNote-ticketNoteTabSelected');
    const tabLabel = tab ? tab.textContent.replace(/\s+\d+$/, '').trim() : 'Visible';

    // Header line: Ticket — Company — Contact (existing behavior)
    const headerBits = [];
    const tid = getTicketNumber(); if (tid) headerBits.push(`#${tid}`);
    const co  = getCompany();      if (co)  headerBits.push(co);
    const ct  = getContact();      if (ct)  headerBits.push(`Contact: ${ct}`);

    // Optional Contact Insight line (only if found)
    const ci = getContactInsight();
    const ciPlain = ci
      ? ['Contact Insight', ci.jobTitle ? `Job Title: ${ci.jobTitle}` : '', ci.type ? `Type: ${ci.type}` : '']
          .filter(Boolean).join(' — ')
      : '';

    const notes = extractNotes(podRoot);

    // ----- plain text -----
    const textParts = [];
    textParts.push(headerBits.join(' — '));
    if (ciPlain) textParts.push(ciPlain);
    textParts.push(`Conversation (${tabLabel})`);
    notes.forEach(n => {
      textParts.push(['-----', n.author || 'Unknown', n.date || '', n.text || ''].filter(Boolean).join('\n'));
    });
    const plain = textParts.join('\n');

    // ----- rich HTML -----
    const htmlHeaderLines = [`<div style="font-weight:700;">${esc(headerBits.join(' — ') || 'Ticket')}</div>`];
    if (ciPlain) {
      htmlHeaderLines.push(
        `<div style="margin-top:4px;color:#333;"><span style="font-weight:600;">Contact Insight:</span> ${esc(ci.jobTitle || '')}${ci.jobTitle && ci.type ? ' — ' : ''}${esc(ci.type || '')}</div>`
      );
    }

    const htmlParts = [];
    htmlParts.push(`<div style="margin:0 0 10px 0;padding:10px;border:1px solid #ddd;border-radius:6px;background:#fafafa;">${htmlHeaderLines.join('')}</div>`);
    htmlParts.push(`<div><strong>Conversation (${esc(tabLabel)})</strong></div>`);
    notes.forEach(n => {
      htmlParts.push(`<div style="margin:12px 0;border-top:1px solid #ddd;padding-top:12px;">
        <div style="font-weight:bold;">${esc(n.author || 'Unknown')}</div>
        <div style="color:#555;font-size:12px;margin-bottom:6px;">${esc(n.date || '')}</div>
        <div>${esc(n.text || '').replace(/\n/g, '<br>')}</div>
      </div>`);
    });
    const html = `<div>${htmlParts.join('')}</div>`;

    return { html, plain, count: notes.length };
  }

  // ----- compact UI (no wrap) -----
  function makeButton() {
    const wrap = document.createElement('span');
    wrap.className = 'att-cw-copy-discussion-wrap';
    wrap.style.display = 'inline-block';
    wrap.style.whiteSpace = 'nowrap';
    wrap.style.verticalAlign = 'middle';
    wrap.style.marginLeft = '8px';
    wrap.style.transform = 'translateY(2px)';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.title = 'Copy Discussion (with ticket header)';
    Object.assign(btn.style, {
      padding: '4px 8px',
      borderRadius: '6px',
      border: '1px solid rgba(0,0,0,.2)',
      background: 'rgb(37,99,235)',
      color: '#fff',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      cursor: 'pointer',
      userSelect: 'none',
      height: '26px',
      lineHeight: '18px',
      display: 'inline-block',
      whiteSpace: 'nowrap',
    });

    btn.addEventListener('click', () => {
      const pod = btn.closest('[data-cwid="cw_ticketnotes"], [data-cwid="pod_service_ticket_notes"]') || document;
      const { html, plain, count } = buildPayload(pod);
      copyRichPlain(html, plain).then(ok => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = ok ? `Copied ${count}` : 'Copy failed';
        setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 1100);
      });
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
    });

    wrap.appendChild(btn);
    return wrap;
  }

  function mount() {
    if (document.querySelector('.att-cw-copy-discussion-wrap')) return;

    const newNoteBtn = document.querySelector('[data-cwid="pod_service_ticket_notes"] [data-cwid="btn_addnew"].TicketNote-newNoteButton')
                      || document.querySelector('#cw-manage-service_service_ticket_discussion [data-cwid="btn_addnew"].TicketNote-newNoteButton')
                      || document.querySelector('.TicketNote-newNoteButton');
    if (!newNoteBtn || !newNoteBtn.parentElement) return;

    const parent = newNoteBtn.parentElement;
    parent.style.whiteSpace = 'nowrap';
    parent.style.display = 'inline-block';

    newNoteBtn.insertAdjacentElement('afterend', makeButton());
  }

  (async function init() {
    for (let i = 0; i < 20; i++) { mount(); await sleep(250); }
    new MutationObserver(() => mount())
      .observe(document.documentElement, { childList: true, subtree: true });
  })();
})();
