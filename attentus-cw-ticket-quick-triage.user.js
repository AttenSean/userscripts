// ==UserScript==
// @name         attentus-cw-ticket-quick-triage
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.9.0
// @description  Adds a "Quick Triage:" bar between the Ticket header and fields; includes a Junk button that sets Board="Junk" then offers Save / Save & Close / Cancel (revert). Hides on Project tickets.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-junk-button.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-junk-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- tiny utils ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const visible = (el) => !!el && el.offsetParent !== null;

  async function until(fn, { tries = 80, delay = 100 } = {}) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
      await sleep(delay);
    }
    return null;
  }

  function nativeSetValue(input, value) {
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
             || Object.getOwnPropertyDescriptor(input.__proto__, 'value');
    if (desc?.set) desc.set.call(input, value);
    else input.value = value;
  }

  function toast(msg, ms = 1400) {
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

  // ---------- dropdown helpers ----------
  function chevronFor(input) {
    return input?.closest('div')?.querySelector(
      '.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]'
    ) || null;
  }

  function openList(input) {
    const chev = chevronFor(input);
    if (chev) {
      chev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      chev.click();
      chev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    return true;
  }

  function listContainers() {
    return [
      ...$$('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"]'),
      ...$$('.x-layer, .x-menu-floating, .x-combo-list')
    ].filter(el => visible(el));
  }

  function optionNodesFromOpenLists() {
    const roots = listContainers();
    const options = [];
    for (const root of roots) {
      options.push(
        ...$$('[role="option"]', root),
        ...$$('.k-list-item, .k-item, .select2-results__option, li', root),
        ...$$('div', root)
      );
    }
    return options.filter(el => visible(el) && (el.textContent || '').trim());
  }

  function findMatchingOption(text) {
    const target = String(text).trim().toLowerCase();
    const opts = optionNodesFromOpenLists();
    return opts.find(o => o.textContent.trim().toLowerCase() === target)
        ||  opts.find(o => o.textContent.trim().toLowerCase().startsWith(target))
        ||  opts.find(o => o.textContent.trim().toLowerCase().includes(target))
        ||  null;
  }

  async function typeFilter(input, value) {
    nativeSetValue(input, '');
    input.focus();
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    for (const ch of String(value)) {
      nativeSetValue(input, input.value + ch);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      await sleep(12);
    }
  }

  async function clickOption(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(30);
  }

  function commitBlur(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    input.blur();
  }

  async function commitComboValue(selector, value, { attempt = 1 } = {}) {
    const input = await until(() => $(selector), { tries: 60, delay: 120 });
    if (!input || input.disabled || input.readOnly) return false;
    if (!visible(input)) return false;

    openList(input);
    await sleep(120);

    await typeFilter(input, value);
    await sleep(180);

    let opt = findMatchingOption(value);
    if (opt) {
      await clickOption(opt);
      await sleep(220);
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
      await sleep(180);
    }

    commitBlur(input);
    await sleep(260);

    const ok = (input.value || '').trim().toLowerCase() === String(value).toLowerCase();
    if (ok) return true;

    if (attempt < 2) {
      await sleep(160);
      return commitComboValue(selector, value, { attempt: attempt + 1 });
    }
    return false;
  }

  // ---------- toolbar (Save / Save & Close) ----------
  function findToolbarButton(className) {
    const el = $('.' + className);
    return visible(el) ? el : null;
  }
  function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  }
  const clickSave = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_Save'));
  const clickSaveAndClose = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose'));

  // ---------- confirm modal ----------
  const MODAL_ID = 'att-cw-junk-confirm';
  function removeModal() { $('#' + MODAL_ID)?.remove(); }
  function showConfirm({ onSave, onSaveClose, onCancel }) {
    removeModal();

    const wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    Object.assign(wrap.style, {
      position: 'fixed', inset: '0', zIndex: 2147483647, display: 'grid',
      placeItems: 'center', background: 'rgba(0,0,0,0.35)'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      minWidth: '360px', maxWidth: '94vw',
      background: '#fff', color: '#111827',
      borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      padding: '16px',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });

    const h = document.createElement('div');
    h.textContent = 'Board set to “Junk”. Save changes?';
    Object.assign(h.style, { fontSize: '15px', fontWeight: 600, marginBottom: '8px' });

    const p = document.createElement('div');
    p.textContent = 'Choose an action:';
    Object.assign(p.style, { marginBottom: '12px', color: '#374151' });

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

    const mkBtn = (label, kind) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        borderRadius: '10px', padding: '8px 12px', border: '1px solid', cursor: 'pointer', fontWeight: 600
      });
      if (kind === 'primary') Object.assign(b.style, { background: '#2563EB', borderColor: '#1D4ED8', color: '#fff' });
      else if (kind === 'danger') Object.assign(b.style, { background: '#DC2626', borderColor: '#B91C1C', color: '#fff' });
      else Object.assign(b.style, { background: '#F9FAFB', borderColor: '#E5E7EB', color: '#111827' });
      b.onmouseenter = () => { b.style.filter = 'brightness(0.98)'; };
      b.onmouseleave = () => { b.style.filter = 'none'; };
      return b;
    };

    const btnSave = mkBtn('Save', 'primary');
    const btnSaveClose = mkBtn('Save & Close', 'danger');
    const btnCancel = mkBtn('Cancel (Revert)', 'default');

    btnSave.onclick = () => { removeModal(); onSave?.(); };
    btnSaveClose.onclick = () => { removeModal(); onSaveClose?.(); };
    btnCancel.onclick = () => { removeModal(); onCancel?.(); };

    wrap.onclick = (e) => { if (e.target === wrap) { removeModal(); onCancel?.(); } };
    wrap.tabIndex = -1;
    wrap.onkeydown = (e) => { if (e.key === 'Escape') { removeModal(); onCancel?.(); } };

    row.append(btnCancel, btnSave, btnSaveClose);
    card.append(h, p, row);
    wrap.append(card);
    document.body.append(wrap);
    wrap.focus();
  }

  // ---------- action ----------
  let busy = false;
  async function setBoardToJunkWithConfirm() {
    if (busy) return;
    busy = true;

    const boardSel = 'input.cw_serviceBoard';
    const boardInput = await until(() => $(boardSel), { tries: 60, delay: 120 });
    const prevBoard = (boardInput?.value || '').trim();

    try {
      const ok = await commitComboValue(boardSel, 'Junk');
      if (!ok) { toast('Could not set Board'); return; }
      toast('Board set to Junk');

      showConfirm({
        onSave: () => toast(clickSave() ? 'Saving…' : 'Save button not found'),
        onSaveClose: () => toast(clickSaveAndClose() ? 'Saving & closing…' : 'Save & Close button not found'),
        onCancel: async () => {
          if (prevBoard) {
            const reverted = await commitComboValue(boardSel, prevBoard);
            toast(reverted ? `Reverted to "${prevBoard}"` : 'Revert failed');
          } else {
            nativeSetValue(boardInput, '');
            commitBlur(boardInput);
            toast('Reverted (cleared Board)');
          }
        }
      });
    } finally {
      busy = false;
    }
  }

  // ---------- triage bar (label + slot + buttons) ----------
  const BTN_ID = 'att-cw-junk-btn';
  const BAR_ID = 'att-cw-triage-bar';
  const SLOT_ID = 'att-cw-triage-slot';

  function makeJunkButton() {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    Object.assign(outer.style, { display: 'inline-block', verticalAlign: 'middle', whiteSpace: 'nowrap' });

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = 'Junk';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);
    outer.title = 'Move this ticket to the Junk board';

    const act = (e) => { e.preventDefault(); setBoardToJunkWithConfirm(); };
    outer.addEventListener('click', act);
    outer.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });

    return outer;
  }

  function makeLabel() {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'inline-flex', alignItems: 'center', gap: '6px' });

    const lbl = document.createElement('span');
    lbl.textContent = 'Quick Triage:';
    Object.assign(lbl.style, {
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      fontWeight: 600,
      color: '#374151',
      marginRight: '4px',
      userSelect: 'none'
    });

    wrap.appendChild(lbl);
    return wrap;
  }

  function makeBar() {
    const bar = document.createElement('div');
    bar.id = BAR_ID;
    Object.assign(bar.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 0 8px 0',
      flexWrap: 'wrap',
      position: 'relative',
      zIndex: '0',
      // Added left margin so the label isn't hugging the pod edge
      marginLeft: '8px'
    });

    const left = makeLabel();
    const slot = document.createElement('div');
    slot.id = SLOT_ID;
    Object.assign(slot.style, { display: 'inline-flex', gap: '8px', flexWrap: 'wrap' });

    slot.appendChild(makeJunkButton());
    bar.append(left, slot);
    return bar;
  }

  function findTicketPodRoot() {
    const pod = $('.pod_service_ticket_ticket') || $('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBLGH');
    return pod || null;
  }

  function findHeaderBlock(podRoot) {
    return podRoot?.querySelector('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBHGH') || null;
  }

  function findFieldsBlock(podRoot) {
    return podRoot?.querySelector('.GMDB3DUBDGH') || null;
  }

  // ---------- Project ticket detection & visibility control ----------
  function elementTextIncludes(sel, needle) {
    const n = needle.toLowerCase();
    const nodes = $$(sel);
    return nodes.some(el => visible(el) && (el.textContent || '').trim().toLowerCase().includes(n));
  }

  function isProjectTicket() {
    if (elementTextIncludes('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Board')) return true;
    const projInput = $('input.cw_projectBoard');
    if (projInput && visible(projInput)) return true;
    const projLabel = $('.cw_project');
    if (projLabel && visible(projLabel)) return true;
    return false;
  }

  function removeBar() { $('#' + BAR_ID)?.remove(); }

  function placeBarBetweenHeaderAndFields() {
    if (isProjectTicket()) { removeBar(); return false; }
    if ($('#' + BAR_ID)) return true;

    const pod = findTicketPodRoot();
    if (!pod) return false;

    const header = findHeaderBlock(pod);
    const fields = findFieldsBlock(pod);
    if (!header || !fields) return false;

    const bar = makeBar();
    header.insertAdjacentElement('afterend', bar);
    return true;
  }

  async function ensure() {
    if (isProjectTicket()) { removeBar(); return; }
    const ok = placeBarBetweenHeaderAndFields();
    if (!ok) {
      setTimeout(() => { if (!isProjectTicket()) placeBarBetweenHeaderAndFields(); }, 150);
      setTimeout(() => { if (!isProjectTicket()) placeBarBetweenHeaderAndFields(); }, 400);
    }
  }

  // ---------- SPA-safe wiring ----------
  let lastHref = location.href;

  const mo = new MutationObserver(() => {
    if (lastHref !== location.href) {
      lastHref = location.href;
      removeBar();
    }
    ensure();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);

  ensure();
  setTimeout(ensure, 250);
  setTimeout(ensure, 800);
})();
