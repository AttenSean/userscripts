// ==UserScript==
// @name         attentus-cw-copy-discussion
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.0.0
// @description  Adds a compact "Copy" button by New Note to copy visible Discussion notes with a header (Ticket, Company, Contact, and Contact Insight when available). SPA-safe with rich+plain clipboard.
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

(() => {
  'use strict';

  /** ---------------- utils ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  async function copyRichPlain(html, text) {
    // 1) modern rich+plain
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
    // 2) GM rich
    try {
      if (typeof GM !== 'undefined' && GM.setClipboard) {
        GM.setClipboard(html, { type: 'text/html' });
        return true;
      }
    } catch {}
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(html);
        return true;
      }
    } catch {}
    // 3) plain fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {}
    return false;
  }

  /** ---------------- header fields ---------------- */
  function getTicketId() {
    try {
      const u = new URL(location.href);
      const qid = u.searchParams.get('service_recid');
      if (qid && /^\d+$/.test(qid)) return qid;
    } catch {}
    // fallback: title or path
    const mTitle = (document.title || '').match(/#(\d{3,})/);
    if (mTitle) return mTitle[1];
    const mPath = location.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{3,})/i);
    return mPath ? mPath[1] : '';
  }

  const getVal = (sel) => document.querySelector(sel)?.value?.trim() || '';
  function getCompany() {
    return (
      getVal('input.cw_company') ||
      getVal('[data-cwid="company"] input[readonly]') ||
      getVal('[data-cwid="company"] input')
    );
  }
  function getContact() {
    return (
      getVal('input.cw_contact') ||
      getVal('[data-cwid="contact"] input[readonly]') ||
      getVal('[data-cwid="contact"] input')
    );
  }

  /** ---------------- Contact Insight (API-first, no scraping) ---------------- */
  function getContactInsight() {
    const ticketId = getTicketId();
    // Preferred API exposed by attentus-cw-contact-insight-pod >= 1.7.0
    try {
      const api = window.AttentusContactInsight;
      if (api && typeof api.get === 'function') {
        const det = api.get(ticketId);
        if (det && (det.title || det.type)) {
          return { jobTitle: det.title || det.jobTitle || '', type: det.type || '' };
        }
      }
    } catch {}
    // Fallback to pod data-* attributes (no text scraping)
    const pod = document.getElementById('attentus-contact-insight-box');
    if (pod) {
      const title = pod.dataset.title || '';
      const type = pod.dataset.type || '';
      if (title || type) return { jobTitle: title, type };
    }
    return null;
  }

  /** ---------------- note extraction (visible tab) ---------------- */
  function extractNotes(podRoot) {
    const rows = podRoot.querySelectorAll('.TicketNote-rowWrap .TicketNote-row');
    const out = [];
    rows.forEach((row) => {
      const author =
        row.querySelector('.TicketNote-clickableName, .TicketNote-basicName, .TicketNote-skittleAvatar')?.textContent?.trim() ||
        '';
      const date = row.querySelector('.TimeText-date')?.textContent?.trim() || '';
      // Only capture dedicated note blocks to avoid side text/labels
      const blocks = row.querySelectorAll('.TicketNote-rowNote');
      const parts = [];
      blocks.forEach((b) => {
        const txt = (b.innerText || '').trim();
        if (txt) parts.push(txt);
      });
      const unique = Array.from(new Set(parts));
      const text = unique.join('\n\n');
      if (author || date || text) out.push({ author, date, text });
    });
    return out;
  }

  /** ---------------- payload composer ---------------- */
  function buildPayload(podRoot) {
    // Current tab label (e.g., "Discussion")
    const tab = podRoot.querySelector('.TicketNote-ticketNoteTable .TicketNote-ticketNoteTabSelected');
    const tabLabel = tab ? tab.textContent.replace(/\s+\d+$/, '').trim() : 'Visible';

    // Header basics
    const headerBits = [];
    const tid = getTicketId();
    if (tid) headerBits.push(`#${tid}`);
    const company = getCompany();
    if (company) headerBits.push(company);
    const contact = getContact();
    if (contact) headerBits.push(`Contact: ${contact}`);

    // Optional Contact Insight (from API/pod only)
    const ci = getContactInsight();
    const ciPlain = ci
      ? ['Contact Insight', ci.jobTitle ? `Job Title: ${ci.jobTitle}` : '', ci.type ? `Type: ${ci.type}` : '']
          .filter(Boolean)
          .join(' — ')
      : '';

    const notes = extractNotes(podRoot);

    // Plain
    const textParts = [];
    textParts.push(headerBits.join(' — '));
    if (ciPlain) textParts.push(ciPlain);
    textParts.push(`Conversation (${tabLabel})`);
    notes.forEach((n) => {
      textParts.push(['-----', n.author || 'Unknown', n.date || '', n.text || ''].filter(Boolean).join('\n'));
    });
    const plain = textParts.join('\n');

    // HTML
    const htmlHeader = [`<div style="font-weight:700;">${esc(headerBits.join(' — ') || 'Ticket')}</div>`];
    if (ciPlain) {
      htmlHeader.push(
        `<div style="margin-top:4px;color:#333;"><span style="font-weight:600;">Contact Insight:</span> ${esc(
          ci.jobTitle || ''
        )}${ci.jobTitle && ci.type ? ' — ' : ''}${esc(ci.type || '')}</div>`
      );
    }
    const htmlParts = [];
    htmlParts.push(
      `<div style="margin:0 0 10px 0;padding:10px;border:1px solid #ddd;border-radius:6px;background:#fafafa;">${htmlHeader.join(
        ''
      )}</div>`
    );
    htmlParts.push(`<div><strong>Conversation (${esc(tabLabel)})</strong></div>`);
    notes.forEach((n) => {
      htmlParts.push(
        `<div style="margin:12px 0;border-top:1px solid #ddd;padding-top:12px;">
          <div style="font-weight:bold;">${esc(n.author || 'Unknown')}</div>
          <div style="color:#555;font-size:12px;margin-bottom:6px;">${esc(n.date || '')}</div>
          <div>${esc(n.text || '').replace(/\n/g, '<br>')}</div>
        </div>`
      );
    });
    const html = `<div>${htmlParts.join('')}</div>`;

    return { html, plain, count: notes.length };
  }

  /** ---------------- UI ---------------- */
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
      const pod =
        btn.closest('[data-cwid="cw_ticketnotes"], [data-cwid="pod_service_ticket_notes"]') ||
        document.getElementById('cw-manage-service_service_ticket_discussion') ||
        document;
      const { html, plain, count } = buildPayload(pod);
      copyRichPlain(html, plain).then((ok) => {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = ok ? `Copied ${count}` : 'Copy failed';
        setTimeout(() => {
          btn.textContent = old;
          btn.disabled = false;
        }, 1100);
      });
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        btn.click();
      }
    });

    wrap.appendChild(btn);
    return wrap;
  }

  function mount() {
    if (document.querySelector('.att-cw-copy-discussion-wrap')) return;

    const newNoteBtn =
      document.querySelector(
        '[data-cwid="pod_service_ticket_notes"] [data-cwid="btn_addnew"].TicketNote-newNoteButton'
      ) ||
      document.querySelector('#cw-manage-service_service_ticket_discussion [data-cwid="btn_addnew"].TicketNote-newNoteButton') ||
      document.querySelector('.TicketNote-newNoteButton');

    if (!newNoteBtn || !newNoteBtn.parentElement) return;

    const parent = newNoteBtn.parentElement;
    parent.style.whiteSpace = 'nowrap';
    parent.style.display = 'inline-block';

    newNoteBtn.insertAdjacentElement('afterend', makeButton());
  }

  /** ---------------- boot ---------------- */
  (async function init() {
    // quick retries to catch initial SPA render
    for (let i = 0; i < 24; i++) {
      mount();
      // try to pick up Contact Insight API init (if the other script loads slightly later)
      await sleep(200);
    }
    // observe SPA updates
    new MutationObserver(() => mount()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // listen to Contact Insight updates to keep future copies fresh (no-op here, but holds a reference if needed)
    if (window.AttentusContactInsight?.subscribe) {
      window.AttentusContactInsight.subscribe(() => {
        /* noop: we read at click-time */
      });
    }
  })();
})();
