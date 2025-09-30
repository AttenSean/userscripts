// ==UserScript==
// @name         attentus-cw-copy-discussion
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.2.0
// @description  Adds a compact "Copy" button by New Note to copy visible Discussion notes with a header (Ticket, Company, Contact, and Contact Insight when available). SPA-safe with rich+plain clipboard; no dependency on other userscripts.
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
  const q  = (sel, root=document) => root.querySelector(sel);
  const qa = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const vis = (el) => !!(el && el.offsetParent && el.getClientRects().length);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

  function once(fn) { let ran=false, val; return (...a)=>{ if(!ran){ ran=true; val=fn(...a);} return val;}; }

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

  /** ---------------- gating ---------------- */
  function getTicketIdFromHeader() {
    const hdr = q('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header');
    if (!hdr || !vis(hdr)) return '';
    const lbl = document.getElementById(hdr.id + '-label') || hdr.nextElementSibling || hdr;
    const m = norm(lbl.textContent).match(/\b(?:service\s+)?ticket\s*#\s*(\d{3,})\b/i);
    return m ? m[1] : '';
  }
  function getTicketIdFromUrl() {
    try {
      const u = new URL(location.href);
      const p = u.searchParams;
      const idQ = p.get('service_recid') || p.get('srRecID') || p.get('recid');
      if (idQ && /^\d{3,}$/.test(idQ)) return idQ;
      const m = u.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{3,})/i);
      return m ? m[1] : '';
    } catch { return ''; }
  }
  const getTicketId = () => getTicketIdFromUrl() || getTicketIdFromHeader();
  const isTicketPage = () =>
    !!(getTicketIdFromUrl() ||
       getTicketIdFromHeader() ||
       q('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header'));

  /** ---------------- header fields ---------------- */
  const getVal = (sel) => q(sel)?.value?.trim() || '';
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

  /** ---------------- Rails helpers (fallback for CI) ---------------- */
  const normPath = () => (location.pathname.match(/\/v\d+_\d+/) || ['',''])[0];
  const cwBase   = () => location.origin + normPath();

  async function postRails(url, actionMessage) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort('timeout'), 8000);
    try {
      const body = new URLSearchParams({
        actionMessage: JSON.stringify(actionMessage),
        clientTimezoneOffset: String(-new Date().getTimezoneOffset()),
        clientTimezoneName: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      }).toString();
      const r = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    } finally {
      clearTimeout(to);
    }
  }

  async function fetchTicketSVM(ticketId) {
    const url = `${cwBase()}/services/system_io/actionprocessor/Service/GetServiceTicketDetailViewAction.rails`;
    const actionMessage = {
      payload: JSON.stringify({ serviceRecId: Number(ticketId) }),
      payloadClassName: 'GetServiceTicketDetailViewAction',
      project: 'ServiceCommon'
    };
    const j = await postRails(url, actionMessage);
    return j?.data?.action?.serviceTicketViewModel || null;
  }

  function resolveContactMetaFromSVM(svm) {
    const meta = { title: '', type: '' };
    try {
      meta.title =
        svm?.companyPodViewModel?.contact?.title ||
        svm?.companyPod?.contactViewModel?.title ||
        svm?.contactPod?.contactViewModel?.title || '';
      meta.type =
        svm?.companyPodViewModel?.contact?.type ||
        svm?.companyPod?.contactViewModel?.type ||
        svm?.contactPod?.contactViewModel?.type || '';
    } catch {}
    return meta;
  }

  /** ---------------- Contact Insight (pod-first; SVM fallback) ---------------- */
  async function getContactInsight() {
    // 1) Read from our Contact Insight pod if present
    const pod = q('#attentus-contact-insight-box');
    if (pod) {
      const titleLine = q('[data-field="jobtitle"]', pod);
      let jobTitle = '';
      if (titleLine && vis(titleLine)) {
        const t = norm(titleLine.textContent || '');
        jobTitle = t.replace(/^Title:\s*/i, '');
      }
      const badges = qa('[data-att-badge]', pod).map(x => norm(x.textContent || '')).filter(Boolean);
      const typeBadges = (badges.length ? badges.join(', ') : '');
      if (jobTitle || typeBadges) {
        return { jobTitle, type: typeBadges };
      }
    }

    // 2) Lightweight fallback via SVM fetch
    const tid = getTicketId();
    if (!tid) return null;
    try {
      const svm = await fetchTicketSVM(tid);
      const meta = resolveContactMetaFromSVM(svm);
      if (meta.title || meta.type) return { jobTitle: meta.title || '', type: meta.type || '' };
    } catch {}
    return null;
  }

  /** ---------------- note extraction (visible tab) ---------------- */
  function extractNotes(podRoot) {
    // Compatible with current CW DOM: rows hold author/date/note blocks
    const rows = podRoot.querySelectorAll('.TicketNote-rowWrap .TicketNote-row, .TicketNote-row');
    const out = [];
    rows.forEach((row) => {
      if (!vis(row)) return;
      const author =
        q('.TicketNote-clickableName, .TicketNote-basicName, .TicketNote-skittleAvatar', row)?.textContent?.trim() || '';
      const date = q('.TimeText-date', row)?.textContent?.trim() || '';
      const blocks = row.querySelectorAll('.TicketNote-rowNote, .TicketNote-note');
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
  async function buildPayload(podRoot) {
    // Current tab label (e.g., "Discussion")
    const tab = q('.TicketNote-ticketNoteTable .TicketNote-ticketNoteTabSelected', podRoot);
    const tabLabel = tab ? tab.textContent.replace(/\s+\d+$/, '').trim() : 'Visible';

    // Header basics
    const headerBits = [];
    const tid = getTicketId();
    if (tid) headerBits.push(`#${tid}`);
    const company = getCompany();
    if (company) headerBits.push(company);
    const contact = getContact();
    if (contact) headerBits.push(`Contact: ${contact}`);

    // Optional Contact Insight (pod-first; SVM fallback if missing)
    const ci = await getContactInsight();
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

    btn.addEventListener('click', async () => {
      const pod =
        btn.closest('[data-cwid="cw_ticketnotes"], [data-cwid="pod_service_ticket_notes"]') ||
        document.getElementById('cw-manage-service_service_ticket_discussion') ||
        document;
      const { html, plain, count } = await buildPayload(pod);
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
    if (!isTicketPage()) return;
    if (q('.att-cw-copy-discussion-wrap')) return;

    const newNoteBtn =
      q('[data-cwid="pod_service_ticket_notes"] [data-cwid="btn_addnew"].TicketNote-newNoteButton') ||
      q('#cw-manage-service_service_ticket_discussion [data-cwid="btn_addnew"].TicketNote-newNoteButton') ||
      q('.TicketNote-newNoteButton');

    if (!newNoteBtn || !newNoteBtn.parentElement) return;

    const parent = newNoteBtn.parentElement;
    parent.style.whiteSpace = 'nowrap';
    parent.style.display = 'inline-block';

    newNoteBtn.insertAdjacentElement('afterend', makeButton());
  }

  /** ---------------- boot ---------------- */
  (async function init() {
    // Quick tries to land during initial SPA hydration
    for (let i = 0; i < 20; i++) {
      mount();
      await sleep(150);
    }
    // Observe SPA updates (debounced by mount logic itself)
    const mo = new MutationObserver(() => mount());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Re-mount on route changes
    const onRoute = once(() => setTimeout(mount, 0));
    ['pushState','replaceState'].forEach(k => {
      const orig = history[k];
      history[k] = function () { const r = orig.apply(this, arguments); onRoute(); return r; };
    });
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(mount, 60); });
    window.addEventListener('focus', () => setTimeout(mount, 60), { passive:true });
  })();
})();
