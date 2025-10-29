// ==UserScript==
// @name         attentus-cw-time-entry-clipboard-bar
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.9.3
// @description  Clipboard buttons by the Notes timestamp (standalone Time Entry) and under the ticket thread pod header. Does not relocate action-bar buttons. Disabled on Time Sheets.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- constants ----------
  const DEFAULTS = {
    name: 'Sean Dill',
    headline: 'Your 5-star review has a big impact!',
    prefix: 'Please take a moment to ',
    linkText: 'leave a quick Google review.',
    suffix: '',
    closing: 'Mentioning my name helps me get recognized for the work I do.',
    spacedThankYou: false,
    defaultLocation: 'bellevue', // 'bellevue' | 'seattle' | 'tacoma'
    randomizeReviewLine: false
  };

  const KEYS = {
    name:    'att_clip_name',
    headline:'att_clip_headline',
    prefix:  'att_clip_prefix',
    link:    'att_clip_link',
    suffix:  'att_clip_suffix',
    closing: 'att_clip_closing',
    spaced:  'att_clip_spaced',
    defloc:  'att_clip_defloc',
    random:  'att_clip_random'
  };

  const GROUP_ID = 'cw-notes-inline-copy-group';

  // ---------- minimal styles to avoid grey/disabled look ----------
(function ensureStyles(){
  if (document.getElementById('att-clipbar-style')) return;
  const s = document.createElement('style');
  s.id = 'att-clipbar-style';
  s.textContent = `
    /* keep timestamp + toolbar on one row in Time Entry */
    #att-clipbar-row {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      vertical-align: middle;
    }


    /* existing styles... */
    #cw-notes-inline-copy-group {
      display: inline-flex;
      flex-wrap: wrap;            /* (still wraps under ticket thread header) */
      gap: 6px;
      align-items: center;
      margin: 8px 0;              /* overridden to 0 by the scoped rule above */
    }
    #cw-notes-inline-copy-group .mm_button {
      display: inline-block !important;
      pointer-events: auto !important;
      opacity: 1 !important;
      cursor: pointer !important;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(0,0,0,.2);
      background: #2563eb;
      color: #fff;
      line-height: 1.2;
      white-space: nowrap;
    }
    #cw-notes-inline-copy-group select { padding: 4px 6px; border-radius: 6px; }
  `;
  document.head.appendChild(s);
})();



  // ---------- utils ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const asText = (html) => html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');

  function toast(msg) {
    const n = document.createElement('div');
    Object.assign(n.style, {
      position:'fixed', right:'16px', bottom:'16px', zIndex:2147483646,
      background:'#111827', color:'#fff', padding:'8px 10px',
      borderRadius:'8px', border:'1px solid rgba(255,255,255,.2)', font:'12px system-ui,Segoe UI,Roboto,Arial,sans-serif'
    });
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 1400);
  }

  // ---------- storage helpers ----------
  async function gmGet(key, defVal) {
    try { if (typeof GM !== 'undefined' && GM.getValue) return await GM.getValue(key, defVal); } catch {}
    try { if (typeof GM_getValue === 'function') return GM_getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }
  async function gmSet(key, value) {
    try { if (typeof GM !== 'undefined' && GM.setValue) return await GM.setValue(key, value); } catch {}
    try { if (typeof GM_setValue === 'function') return GM_setValue(key, value); } catch {}
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  // ---------- clipboard ----------
  async function copyRich(html, text) {
    try { if (typeof GM_setClipboard === 'function') GM_setClipboard(html, 'html'); } catch {}
    try { if (typeof GM === 'object' && GM?.setClipboard) GM.setClipboard(html, { type: 'text/html' }); } catch {}
    try { if (typeof GM === 'object' && GM?.setClipboard) GM.setClipboard(text, { type: 'text/plain' }); } catch {}

    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const data = { 'text/html': new Blob([html], { type:'text/html' }),
                       'text/plain': new Blob([text], { type:'text/plain' }) };
        await navigator.clipboard.write([new ClipboardItem(data)]);
        return true;
      } catch {}
    }
    if (navigator.clipboard) { try { await navigator.clipboard.writeText(text); return true; } catch {} }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return { ok: true };
    } catch {}
    return { ok: false };
  }

  // ---------- view detection ----------
  function isTimesheetContext() {
    const crumbs = Array.from(document.querySelectorAll('.cw-main-banner .navigationEntry, .cw-main-banner .cw_CwLabel'))
      .map(e => (e.textContent || '').trim().toLowerCase());
    if (crumbs.some(t => t.includes('open time sheets') || t === 'time sheet')) return true;
    if (document.querySelector('.mytimesheetlist, .TimeSheet')) return true;
    return false;
  }

  function isTicketContext() {
    const href = (location.href || '').toLowerCase();
    const search = location.search || '';
    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;
    if (document.querySelector('.pod_ticketSummary, .pod_ticketHeaderActions')) return true;
    if ([...document.querySelectorAll('.cw_CwLabel,.gwt-Label,.mm_label')]
          .some(el => /service\s*ticket\s*#/i.test((el.textContent || '')))) return true;
    return false;
  }

function findThreadPodHeaderByLabel(textNeedle) {
  const labels = document.querySelectorAll('.mm_podHeader [id$="-label"], .pod_unknown_header [id$="-label"]');
  const want = (textNeedle || '').toLowerCase();
  for (const el of labels) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t) continue;
    // exact pod we want: "Thread: Auto time entries"
    if (t.includes(want)) return el;
  }
  return null;
}


  // ---------- locate Notes timestamp (standalone Time Entry) ----------
  function findNotesTimestampButton() {
    const stamps = document.querySelectorAll('.cw_ToolbarButton_TimeStamp');
    for (const st of stamps) {
      const row = st.closest('tr');
      const label = row && row.querySelector('.gwt-Label, .mm_label, .cw_CwLabel');
      if (label && /notes$/i.test((label.textContent || '').trim())) return st;
    }
    return null;
  }

  // ---------- ticket thread header target (robust) ----------
function threadTimepadMountTarget() {
  // 1) Prefer the "Thread: Auto time entries" header label (hosted_16)
  const autoHeaderLabel = findThreadPodHeaderByLabel('thread: auto time entries');
  if (autoHeaderLabel) return autoHeaderLabel.closest('.mm_podHeader, .pod_unknown_header') || autoHeaderLabel;

  // 2) If the label isn’t present yet, try the known hosted_16 header class
  const hosted16Header = document.querySelector('.pod_hosted_16_header');
  if (hosted16Header) return hosted16Header;

  // 3) If the pod wrapper is there, use it (insert before its first child)
  const hosted16Pod = document.querySelector('.pod_hosted_16');
  if (hosted16Pod) return hosted16Pod;

  // Never target discussion or real-time chat pods
  return null;
}


  // ---------- content builders ----------
  function signatureHTML(name, { spacedThankYou = false } = {}) {
    const n = esc(name);
    return [
      `<div style="margin:0;line-height:1.35">`,
      `<div style="margin:0">Thank you,</div>`,
      spacedThankYou ? `<div style="margin:0"><br></div>` : ``,
      `<div style="margin:0"><strong>${n}</strong></div>`,
      `<div style="margin:0">Attentus Technologies</div>`,
      `<div style="margin:0"><strong>Support:</strong> (253) 218-6015 x1</div>`,
      `<div style="margin:0">Call or Text Us: (253) 218-6015</div>`
    ].join('');
  }

  function signatureText(name, { spacedThankYou = false } = {}) {
    const lines = [
      'Thank you,',
      spacedThankYou ? '' : null,
      name,
      'Attentus Technologies',
      'Support: (253) 218-6015 x1',
      'Call or Text Us: (253) 218-6015'
    ].filter(v => v !== null);
    return lines.join('\n');
  }

  async function getReviewMsg() {
    const headline = await gmGet(KEYS.headline, DEFAULTS.headline);
    const prefix   = await gmGet(KEYS.prefix,   DEFAULTS.prefix);
    const linkText = await gmGet(KEYS.link,     DEFAULTS.linkText);
    const suffix   = await gmGet(KEYS.suffix,   DEFAULTS.suffix);
    const closing  = await gmGet(KEYS.closing,  DEFAULTS.closing);
    const random   = await gmGet(KEYS.random,   DEFAULTS.randomizeReviewLine);

    const line = random
      ? `${headline} ${prefix}<a href="https://g.page/r/CZ4lN2mJq0wEEB0/review" target="_blank" rel="noopener">${esc(linkText)}</a>${suffix ? ' ' + esc(suffix) : ''}`
      : `${prefix}<a href="https://g.page/r/CZ4lN2mJq0wEEB0/review" target="_blank" rel="noopener">${esc(linkText)}</a>${suffix ? ' ' + esc(suffix) : ''}`;

    return line + `<div>${esc(closing)}</div>`;
  }

  // ---------- group child builder ----------
// Single UI set for all contexts:
//   Bellevue [⚙] | Copy signature | Copy review + signature
async function buildGroupChildren(intoWrap) {
  const sel = document.createElement('select');
  sel.innerHTML = `
    <option value="bellevue">Bellevue</option>
    <option value="seattle">Seattle</option>
    <option value="tacoma">Tacoma</option>
  `;
  sel.value = await gmGet(KEYS.defloc, DEFAULTS.defaultLocation);

  const mkBtn = (label, title, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mm_button';
    b.textContent = label;
    b.title = title;
    b.style.opacity = '1';
    b.style.pointerEvents = 'auto';
    b.style.cursor = 'pointer';
    b.addEventListener('click', async (e) => { e.preventDefault(); await onClick(e); });
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }});
    return b;
  };

  const name   = await gmGet(KEYS.name,   DEFAULTS.name);
  const spaced = await gmGet(KEYS.spaced, DEFAULTS.spacedThankYou);

  const copySignature = async () => {
    const html = signatureHTML(name, { spacedThankYou: spaced });
    await copyRich(html, signatureText(name, { spacedThankYou: spaced }));
    toast('Signature copied');
  };

  const copyReviewPlusSignature = async () => {
    const reviewHTML = await getReviewMsg();
    const sigHTML    = signatureHTML(name, { spacedThankYou: spaced });
    const html = `${reviewHTML}<div><br></div>${sigHTML}`;
    const text = `${asText(reviewHTML)}\n\n${signatureText(name, { spacedThankYou: spaced })}`;
    await copyRich(html, text);
    toast('Review + signature copied');
  };

  const btnSettings = mkBtn('⚙', 'Open clipboard settings', () => showSettings());
btnSettings.setAttribute('aria-label','Open clipboard settings');
  const btnSig      = mkBtn('Copy signature', 'Copy signature', copySignature);
  const btnReview   = mkBtn('Copy review + signature', 'Copy review message + signature', copyReviewPlusSignature);

  Object.assign(intoWrap.style, { display:'inline-flex', gap:'6px', alignItems:'center' });
  intoWrap.append(sel, btnSettings, btnSig, btnReview);

  sel.addEventListener('change', async () => {
    await gmSet(KEYS.defloc, sel.value);
    toast(`Default location: ${sel.value}`);
  });
}


  // ---------- mount near Notes timestamp (standalone Time Entry) ----------
function mountGroup(nextToStamp) {
  const existing = document.getElementById(GROUP_ID);
  if (existing) {
    if (
      existing.previousElementSibling === nextToStamp ||
      existing.parentElement?.previousElementSibling === nextToStamp
    ) return true;
    if (existing.dataset?.origin === 'att-clipboard-bar') existing.remove();
  }

  // container that holds [timestamp][toolbar]
  const row = document.createElement('span');
  row.id = 'att-clipbar-row';
  row.dataset.origin = 'att-clipboard-bar';
  Object.assign(row.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    whiteSpace: 'nowrap',        // keep whole row on one line
    verticalAlign: 'middle'
  });

  const wrap = document.createElement('span');
  wrap.id = GROUP_ID;
  wrap.dataset.origin = 'att-clipboard-bar';
  Object.assign(wrap.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'nowrap',          // **critical**: prevent buttons from wrapping in Time Entry
    margin: '0'                  // remove vertical margin that encourages stacking
  });

  const td = nextToStamp.closest('td');
  if (td) td.style.whiteSpace = 'nowrap';

  nextToStamp.style.display = 'inline-block';
  nextToStamp.insertAdjacentElement('beforebegin', row);
  row.appendChild(nextToStamp);
  row.appendChild(wrap);

  buildGroupChildren(wrap);
  return true;
}


  // Mount clipboard bar under thread header/above first note on ticket pages (no relocation of action-bar buttons).
async function mountGroupUnderThread(targetEl) {
  // Guard: do not mount in Discussion or Real time notes pods
  const pod = targetEl.closest?.('.pod_service_ticket_discussion, .pod_hosted_15');
  if (pod) return false;

  const existing = document.getElementById(GROUP_ID);
  if (existing && (existing.previousElementSibling === targetEl || existing.nextElementSibling === targetEl)) return true;
  if (existing && existing.dataset && existing.dataset.origin === 'att-clipboard-bar') existing.remove();

  const strip = document.createElement('div');
  strip.id = GROUP_ID;
  strip.dataset.origin = 'att-clipboard-bar';
  // layout ensured by the style block above

  // If target is a header, insert after it; if it's the pod wrapper, prepend.
  if (targetEl.matches?.('.mm_podHeader, .pod_unknown_header')) {
    targetEl.insertAdjacentElement('afterend', strip);
  } else if (targetEl.matches?.('.pod_hosted_16')) {
    targetEl.insertAdjacentElement('afterbegin', strip);
  } else {
    // Fallback: safest is after target
    targetEl.insertAdjacentElement('afterend', strip);
  }

  await buildGroupChildren(strip);
  return true;
}


  // ---------- settings panel ----------
  function closeModal(el) { el?.remove(); }
  async function showSettings() {
    const name     = await gmGet(KEYS.name,     DEFAULTS.name);
    const headline = await gmGet(KEYS.headline, DEFAULTS.headline);
    const prefix   = await gmGet(KEYS.prefix,   DEFAULTS.prefix);
    const linkText = await gmGet(KEYS.link,     DEFAULTS.linkText);
    const suffix   = await gmGet(KEYS.suffix,   DEFAULTS.suffix);
    const closing  = await gmGet(KEYS.closing,  DEFAULTS.closing);
    const spaced   = await gmGet(KEYS.spaced,   DEFAULTS.spacedThankYou);
    const defLoc   = await gmGet(KEYS.defloc,   DEFAULTS.defaultLocation);
    const random   = await gmGet(KEYS.random,   DEFAULTS.randomizeReviewLine);

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position:'fixed', inset:0, background:'rgba(0,0,0,.4)', zIndex:2147483646,
      display:'grid', placeItems:'center', font:'13px system-ui,Segoe UI,Roboto,Arial,sans-serif'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background:'#0b1220', color:'#fff', border:'1px solid rgba(255,255,255,.18)',
      borderRadius:'12px', width:'min(560px, 96%)', padding:'14px', boxShadow:'0 10px 30px rgba(0,0,0,.35)'
    });
    card.innerHTML = `
      <h3 style="margin:0 0 8px 0; display:flex; justify-content:space-between; align-items:center">
        Clipboard Settings
        <button id="att-clip-close" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">✕</button>
      </h3>
      <div style="display:grid; grid-template-columns: 1fr 2fr; gap:8px">
        <label>Name</label><input id="att-clip-name" value="${esc(name)}">
        <label>Headline</label><input id="att-clip-headline" value="${esc(headline)}">
        <label>Prefix</label><input id="att-clip-prefix" value="${esc(prefix)}">
        <label>Link Text</label><input id="att-clip-link" value="${esc(linkText)}">
        <label>Suffix</label><input id="att-clip-suffix" value="${esc(suffix)}">
        <label>Closing</label><input id="att-clip-closing" value="${esc(closing)}">
        <label>Spaced “Thank you”</label><input id="att-clip-spaced" type="checkbox" ${spaced ? 'checked':''}>
        <label>Default Location</label>
        <select id="att-clip-defloc">
          <option value="bellevue">Bellevue</option>
          <option value="seattle">Seattle</option>
          <option value="tacoma">Tacoma</option>
        </select>
        <label>Randomize review headline</label><input id="att-clip-random" type="checkbox" ${random ? 'checked':''}>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px">
        <button id="att-clip-cancel" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">Close</button>
        <button id="att-clip-save" class="mm_button" style="opacity:1;pointer-events:auto;cursor:pointer">Save</button>
      </div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    document.getElementById('att-clip-defloc').value = defLoc;

    document.getElementById('att-clip-close').onclick =
    document.getElementById('att-clip-cancel').onclick = () => closeModal(overlay);

    document.getElementById('att-clip-save').onclick = async () => {
      const get = id => document.getElementById(id);
      await gmSet(KEYS.name,    get('att-clip-name').value.trim());
      await gmSet(KEYS.headline,get('att-clip-headline').value.trim());
      await gmSet(KEYS.prefix,  get('att-clip-prefix').value.trim());
      await gmSet(KEYS.link,    get('att-clip-link').value.trim());
      await gmSet(KEYS.suffix,  get('att-clip-suffix').value.trim());
      await gmSet(KEYS.closing, get('att-clip-closing').value.trim());
      await gmSet(KEYS.spaced,  get('att-clip-spaced').checked);
      await gmSet(KEYS.defloc,  get('att-clip-defloc').value || DEFAULTS.defaultLocation);
      await gmSet(KEYS.random,  get('att-clip-random').checked);
      toast('Settings saved');
      closeModal(overlay);
    };
  }

  // ---------- orchestrate ----------
  function removeGroupIfAny() {
    const ex = document.getElementById(GROUP_ID);
    if (ex && ex.dataset && ex.dataset.origin === 'att-clipboard-bar' && ex.parentNode) ex.parentNode.removeChild(ex);
  }

async function ensure() {
  // Off on Time Sheets
  if (isTimesheetContext()) { removeGroupIfAny(); return; }

  // Standalone Time Entry → timestamp anchor (unchanged)
  const stamp = findNotesTimestampButton();
  if (stamp) { mountGroup(stamp); return; }

  // Ticket page → mount ONLY for "Thread: Auto time entries"
  if (isTicketContext()) {
    const target = threadTimepadMountTarget(); // precise hosted_16 target
    if (target) { await mountGroupUnderThread(target); return; }
    // If not ready yet, just wait for MO to fire again
    return;
  }

  // Other contexts
  removeGroupIfAny();
}


  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ensure();
})();
