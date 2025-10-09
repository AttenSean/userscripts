// ==UserScript==
// @name         attentus-cw-ticket-quick-triage
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.20.0
// @description  Quick Triage — Junk + Cancel: sets Board to “Junk”, or sets Status to “>Closed/Cancelled” and Ticket Tier? to “N/A - Cancelled Ticket”. Optional Save/S&C prompt, Shift+Click turbo. SPA-safe, hides on Project tickets.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-triage.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-triage.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- tiny utils ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  async function until(fn, { tries = 60, delay = 60 } = {}) {
    for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await sleep(delay); }
    return null;
  }

  function toast(msg, ms = 1100) {
    const n = document.createElement('div');
    n.textContent = msg;
    Object.assign(n.style, {
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 2147483646,
      background: '#111827', color: '#fff', padding: '8px 10px',
      borderRadius: '8px', border: '1px solid rgba(255,255,255,.25)',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), ms);
  }

  // ---------- persistent settings ----------
  const PREF_KEY_SHIFT_AUTOSAVE = 'att_cw_shiftAutoSave';
  const PREF_KEY_SAVE_PROMPTS   = 'att_cw_triage_savePrompts';  // { junk:true, cancel:true }
  let shiftAutoSaveEnabled = false;
  let savePrompts  = { junk: true, cancel: true };

  async function getPref(key, defVal) {
    try { if (window.GM?.getValue) return await window.GM.getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }
  async function setPref(key, val) {
    try { if (window.GM?.setValue) await window.GM.setValue(key, val); } catch {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  (async () => {
    shiftAutoSaveEnabled = await getPref(PREF_KEY_SHIFT_AUTOSAVE, false);
    const saved = await getPref(PREF_KEY_SAVE_PROMPTS, savePrompts);
    savePrompts = { ...savePrompts, ...(saved || {}) };
  })();

  // ---------- combo helpers ----------
  function openChevronFor(input) {
    const chev = input?.closest('div')?.querySelector('.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]');
    if (visible(chev)) {
      chev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); chev.click();
      chev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); return true;
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    return true;
  }
  async function openPopupAndGetContainer(input) {
    const before = new Set([
      ...$$('.GMDB3DUBPDJ.GMDB3DUBGFJ'),
      ...$$('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"]'),
      ...$$('.x-layer, .x-menu-floating, .x-combo-list')
    ].filter(visible));
    openChevronFor(input); await sleep(35);
    const popup = await until(() => {
      const after = [
        ...$$('.GMDB3DUBPDJ.GMDB3DUBGFJ'),
        ...$$('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"]'),
        ...$$('.x-layer, .x-menu-floating, .x-combo-list')
      ].filter(visible);
      return after.find(el => !before.has(el)) || after.slice(-1)[0];
    }, { tries: 12, delay: 35 });
    return popup || null;
  }
  function findClickableOption(container, value) {
    const target = norm(value);
    const cands = [
      ...$$('[role="option"]', container),
      ...$$('.k-list-item, .k-item, .select2-results__option, li', container),
      ...$$('div, span', container)
    ].filter(el => visible(el) && (el.textContent || '').trim());
    return cands.find(el => norm(el.textContent) === target)
        ||  cands.find(el => norm(el.textContent).startsWith(target))
        ||  cands.find(el => norm(el.textContent).includes(target))
        ||  null;
  }
  async function clickEl(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await sleep(22);
  }
  function commitBlur(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    input.blur();
  }
  async function commitComboOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (norm(input.value) === norm(desiredValue)) return true;

    const popup = await openPopupAndGetContainer(input);
    const opt = popup && findClickableOption(popup, desiredValue);
    if (opt) {
      await clickEl(opt);
      commitBlur(input);
      await sleep(60);
      return norm(input.value) === norm(desiredValue);
    }
    // Fallback: type & Enter
    input.focus();
    input.value = '';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.value = String(desiredValue);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    if (norm(input.value) === norm(desiredValue)) return true;

    // Last try: open, ArrowDown, Enter
    await openPopupAndGetContainer(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(45);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    return norm(input.value) === norm(desiredValue);
  }

  // ---------- UDF find-by-label ----------
  function findUdfInputByLabel(labelText) {
    const rows = $$('.pod-element-row');
    const needle = norm(String(labelText).replace(/[:?]\s*$/,''));
    for (const row of rows) {
      const labelEl = $('.mm_label, .cw_CwLabel, [id$="-label"]', row) || $('.mm_label', row);
      const text = norm((labelEl?.textContent || '').replace(/[:?]\s*$/,''));
      if (text && text === needle) {
        const input = row.querySelector('input.cw_PsaUserDefinedComboBox, input.GMDB3DUBKVH');
        if (input) return input;
      }
    }
    return null;
  }

  // ---------- save buttons ----------
  function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  }
  const findToolbarButton = (cls) => { const el = $('.' + cls); return visible(el) ? el : null; };
  const clickSave         = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_Save'));
  const clickSaveAndClose = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose'));

  // ---------- action dialog ----------
  function showActionDialog(title, { onSave, onSaveClose, onRevert, onDismiss }) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.38)', zIndex: 2147483645,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', minWidth: '360px', maxWidth: '580px',
      padding: '16px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, { fontSize: '15px', fontWeight: 600, marginBottom: '8px' });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end' });

    function mkBtn(label, action, primary=false) {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        borderRadius: '10px', padding: '8px 12px', cursor: 'pointer',
        border: '1px solid', fontWeight: 600
      });
      if (primary) Object.assign(b.style, { background: '#111827', color: '#fff', borderColor: '#111827' });
      else Object.assign(b.style, { background: '#fff', color: '#111827', borderColor: '#D1D5DB' });
      b.addEventListener('click', () => { action?.(); overlay.remove(); });
      return b;
    }

    row.append(
      mkBtn('Dismiss (keep changes)', () => onDismiss?.(), false),
      mkBtn('Cancel (revert)',        () => onRevert?.(), false),
      mkBtn('Save & Close',           () => onSaveClose?.(), false),
      mkBtn('Save',                   () => onSave?.(), true)
    );

    card.append(h, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ---------- Junk action ----------
  async function applyJunk({ showPrompt = true, autoSaveClose = false } = {}) {
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (!boardInput) { toast('Board input not found'); return; }
    const prevBoard = (boardInput.value || '').trim();
    const ok = await commitComboOnElement(boardInput, 'Junk');
    if (!ok) { toast('Could not set Board to Junk'); return; }

    await until(() => norm(boardInput.value) === norm('Junk'), { tries: 10, delay: 45 });
    await sleep(120);

    if (autoSaveClose) { if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog('Board set to “Junk”. Save changes?', {
        onSave:      async () => { await sleep(120); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    () => {
          if (prevBoard) {
            commitComboOnElement(boardInput, prevBoard).then(ret => toast(ret ? `Reverted to "${prevBoard}"` : 'Revert failed'));
          } else {
            boardInput.focus();
            boardInput.value = '';
            boardInput.dispatchEvent(new Event('change', { bubbles: true }));
            toast('Reverted (cleared Board)');
          }
        },
        onDismiss:   () => {}
      });
    } else {
      toast('Junk applied');
    }
  }

  // ---------- Closed/Cancelled action ----------
  async function applyClosedCancelled({ showPrompt = true, autoSaveClose = false } = {}) {
    // Capture previous to support revert
    const prev = {
      status: $('input.cw_status')?.value || '',
      tier:   (function () {
        const i = findUdfInputByLabel('Ticket Tier?');
        return i ? i.value || '' : '';
      })()
    };

    // Set Status
    const statusInput = await until(() => $('input.cw_status'), { tries: 40, delay: 60 });
    if (!statusInput) { toast('Status input not found'); return; }
    const okStatus = await commitComboOnElement(statusInput, '>Closed/Cancelled');
    if (!okStatus) { toast('Could not set Status'); return; }

    // Set UDF: Ticket Tier?
    const tierInput = await until(() => findUdfInputByLabel('Ticket Tier?'), { tries: 40, delay: 60 });
    if (!tierInput) { toast('“Ticket Tier?” field not found'); return; }
    const okTier = await commitComboOnElement(tierInput, 'N/A - Cancelled Ticket');
    if (!okTier) { toast('Could not set “Ticket Tier?”'); return; }

    await sleep(120);

    if (autoSaveClose) { if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog('Set Status to “>Closed/Cancelled” and apply “N/A - Cancelled Ticket”. Save changes?', {
        onSave:      async () => { await sleep(120); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    async () => {
          const sIn = $('input.cw_status');
          if (sIn && prev.status) await commitComboOnElement(sIn, prev.status);
          const tIn = findUdfInputByLabel('Ticket Tier?');
          if (tIn) await commitComboOnElement(tIn, prev.tier || '');
          toast('Reverted changes');
        },
        onDismiss:   () => {}
      });
    } else {
      toast('Closed/Cancelled applied');
    }
  }

  // ---------- Settings (Junk + Cancel) ----------
  function makeSettingsButton() {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = 'att-cw-triage-settings-btn';
    outer.title = 'Triage Settings';

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = '⚙︎';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    function openSettings() {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.38)', zIndex: 2147483645,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      });
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: '#fff', borderRadius: '12px', minWidth: '320px', maxWidth: '520px',
        padding: '16px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
      });

      const h = document.createElement('div');
      h.textContent = 'Quick Triage Settings';
      Object.assign(h.style, { fontSize: '15px', fontWeight: 600, marginBottom: '10px' });

      const mkRow = (key, text) => {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;color:#111827;font-size:13px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!savePrompts[key];
        cb.addEventListener('change', () => { savePrompts[key] = cb.checked; });
        const span = document.createElement('span');
        span.textContent = text;
        row.append(cb, span);
        return row;
      };

      const rows = document.createElement('div');
      rows.append(
        mkRow('junk',   'Show Save pop-up for Junk'),
        mkRow('cancel', 'Show Save pop-up for Closed/Cancelled')
      );

      const tip = document.createElement('div');
      tip.style.cssText = 'font-size:12px;color:#4B5563;margin-top:6px;';
      tip.innerHTML = `<strong>Tip:</strong> Shift+Click any button to Apply + Save & Close (if enabled).`;

      const actions = document.createElement('div');
      Object.assign(actions.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });

      function mkBtn(txt, onClick, primary=false) {
        const b = document.createElement('button');
        b.textContent = txt;
        Object.assign(b.style, {
          borderRadius: '10px', padding: '8px 12px', cursor: 'pointer',
          border: '1px solid', fontWeight: 600
        });
        if (primary) Object.assign(b.style, { background: '#111827', color: '#fff', borderColor: '#111827' });
        else Object.assign(b.style, { background: '#fff', color: '#111827', borderColor: '#D1D5DB' });
        b.addEventListener('click', onClick);
        return b;
      }
      const saveBtn   = mkBtn('Save', async () => {
        await setPref(PREF_KEY_SAVE_PROMPTS,  savePrompts);
        toast('Settings saved'); overlay.remove();
      }, true);
      const cancelBtn = mkBtn('Cancel', () => overlay.remove());

      actions.append(cancelBtn, saveBtn);
      card.append(h, rows, tip, actions);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }

    const handler = (e) => { e.preventDefault(); openSettings(); };
    outer.addEventListener('click', handler);
    outer.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handler(e); });
    return outer;
  }

  // ---------- Bar / placement ----------
  function makeLabel() {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: '6px' });
    const lbl = document.createElement('span');
    lbl.textContent = 'Quick Triage:';
    Object.assign(lbl.style, {
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      fontWeight: 600, color: '#374151', marginRight: '4px', userSelect: 'none'
    });
    wrap.appendChild(lbl);
    return wrap;
  }
  function mkActionButton(id, text, title, handler) {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = id;
    Object.assign(outer.style, { display: 'inline-block', verticalAlign: 'middle', whiteSpace: 'nowrap' });
    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;
    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';
    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = text;
    inner.appendChild(label); btn.appendChild(inner); outer.appendChild(btn);
    outer.title = title;

    const act = async (e) => {
      e.preventDefault();
      const useAuto = e.shiftKey && shiftAutoSaveEnabled;
      await handler({ useAuto, event: e, outer });
    };
    outer.addEventListener('click', act);
    outer.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
    return outer;
  }
  const makeJunkButton = () => mkActionButton(
    'att-cw-junk-btn', 'Junk', 'Set Board to Junk (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applyJunk({ showPrompt: !useAuto && !!savePrompts.junk, autoSaveClose: useAuto })
  );
  const makeCancelButton = () => mkActionButton(
    'att-cw-cancel-btn', 'Closed/Cancelled', 'Set Status to >Closed/Cancelled and Ticket Tier? to N/A - Cancelled Ticket (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applyClosedCancelled({ showPrompt: !useAuto && !!savePrompts.cancel, autoSaveClose: useAuto })
  );

  function makeBar() {
    const bar = document.createElement('div');
    bar.id = 'att-cw-triage-bar';
    Object.assign(bar.style, {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '6px 0 8px 0', flexWrap: 'wrap', position: 'relative', zIndex: '0', marginLeft: '8px'
    });
    const left = makeLabel();
    const slot = document.createElement('div');
    slot.id = 'att-cw-triage-slot';
    Object.assign(slot.style, { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });
    // Buttons: Junk • Closed/Cancelled • ⚙︎
    slot.appendChild(makeJunkButton());
    slot.appendChild(makeCancelButton());
    slot.appendChild(makeSettingsButton());
    bar.append(left, slot);
    return bar;
  }

  // ---------- Page detection & placement ----------
  function isProjectTicket() {
    const n = (s) => (s || '').toLowerCase();
    const has = (sel, needle) => $$(sel).some(el => visible(el) && n(el.textContent).includes(n(needle)));
    if (has('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Board')) return true;
    if (visible($('input.cw_projectBoard'))) return true;
    if (visible($('.cw_project'))) return true;
    return false;
  }
  function findTicketPodRoot() {
    return $('.pod_service_ticket_ticket')
        || $('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBLGH')
        || null;
  }
  function findHeaderBlock(podRoot) {
    return podRoot?.querySelector('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBHGH') || null;
  }
  function ensureBarPlaced() {
    if (isProjectTicket()) { $('#att-cw-triage-bar')?.remove(); return false; }
    const existingSlot = $('#att-cw-triage-slot');
    if (existingSlot) return true;
    const pod = findTicketPodRoot();
    const header = pod && findHeaderBlock(pod);
    if (!header) return false;
    if (!$('#att-cw-triage-bar')) header.insertAdjacentElement('afterend', makeBar());
    return true;
  }

  let lastHref = location.href;
  const mo = new MutationObserver(() => {
    if (lastHref !== location.href) { lastHref = location.href; $('#att-cw-triage-bar')?.remove(); }
    ensureBarPlaced();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensureBarPlaced); return r; };
  });
  window.addEventListener('popstate', () => { ensureBarPlaced(); });

  ensureBarPlaced();
  setTimeout(ensureBarPlaced, 200);
  setTimeout(ensureBarPlaced, 700);
})();
