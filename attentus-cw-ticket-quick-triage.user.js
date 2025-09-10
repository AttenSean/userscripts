// ==UserScript==
// @name         attentus-cw-ticket-quick-triage
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.11.0
// @description  Quick Triage bar with Junk and Spam/Phishing. Spam/Phishing: Help Desk (unless already Help Desk) · MUST ASSIGN · Email · Spam/Phishing · Tier 1 · Low/Low (SLA) → Priority 4; Summary -> "Spam/Phishing (Contact)". Shift+Click any triage button to auto Apply + Save & Close (global toggle in dialog, opt-in). Full revert incl. SLA on Cancel. Waits for Status to refresh after Board changes (fast). SPA-safe. Hides on Project tickets.
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

  // ---------- persistent setting: Shift-click auto Save&Close (opt-in) ----------
  const PREF_KEY_SHIFT_AUTOSAVE = 'att_cw_shiftAutoSave';
  async function getPref(key, defVal) {
    try { if (window.GM?.getValue) return await window.GM.getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }
  async function setPref(key, val) {
    try { if (window.GM?.setValue) await window.GM.setValue(key, val); } catch {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
  // default = false (opt-in)
  let shiftAutoSaveEnabled = false;
  (async () => { shiftAutoSaveEnabled = await getPref(PREF_KEY_SHIFT_AUTOSAVE, false); })();

  // ---------- input helpers ----------
  function nativeSetValue(input, value) {
    if (!input) return;
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(input.__proto__, 'value');
    if (desc?.set) desc.set.call(input, value); else input.value = value;
  }
  function openChevronFor(input) {
    const chev = input?.closest('div')?.querySelector('.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]');
    if (visible(chev)) {
      chev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); chev.click();
      chev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
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
  async function typeFast(input, text) {
    nativeSetValue(input, '');
    input.focus();
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    nativeSetValue(input, String(text));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(text) }));
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

    // Virtualized fallback
    await typeFast(input, desiredValue);
    await sleep(60);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    if (norm(input.value) === norm(desiredValue)) return true;

    // One retry with prefix + ArrowDown
    await openPopupAndGetContainer(input);
    await typeFast(input, String(desiredValue).slice(0, 3));
    await sleep(70);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(45);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    return norm(input.value) === norm(desiredValue);
  }
  async function commitComboValue(selector, value) {
    const input = await until(() => $(selector), { tries: 40, delay: 60 });
    if (!input) return false;
    return commitComboOnElement(input, value);
  }

  // ---------- save buttons ----------
  function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  }
  function findToolbarButton(className) {
    const el = $('.' + className);
    return visible(el) ? el : null;
  }
  const clickSave         = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_Save'));
  const clickSaveAndClose = () => clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose'));

  // ---------- action dialog (with Shift-click toggle) ----------
  function showActionDialog(title, onSave, onSaveClose, onRevert) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.38)', zIndex: 2147483645,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff', borderRadius: '12px', minWidth: '340px', maxWidth: '560px',
      padding: '16px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    const h = document.createElement('div');
    h.textContent = title;
    Object.assign(h.style, { fontSize: '15px', fontWeight: 600, marginBottom: '8px' });

    const blurb = document.createElement('div');
    blurb.innerHTML = `<div style="font-size:12px;color:#4B5563;margin:6px 0 10px;">
      <strong>Tip:</strong> <kbd>Shift</kbd> + Click any triage button to <em>apply</em> and <em>Save & Close</em> immediately (no prompt).
    </div>`;
    const prefRow = document.createElement('label');
    prefRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0 12px 0;color:#111827;font-size:13px;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!shiftAutoSaveEnabled; // default false until user opts in
    cb.addEventListener('change', async () => {
      shiftAutoSaveEnabled = cb.checked;
      await setPref(PREF_KEY_SHIFT_AUTOSAVE, shiftAutoSaveEnabled);
      toast(`Shift-click auto Save & Close ${shiftAutoSaveEnabled ? 'enabled' : 'disabled'}`);
    });
    const cbLbl = document.createElement('span');
    cbLbl.textContent = 'Enable Shift-click auto Save & Close (applies to all triage buttons)';
    prefRow.append(cb, cbLbl);

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
      b.addEventListener('click', () => { action(); overlay.remove(); });
      return b;
    }

    const btnRevert    = mkBtn('Cancel (revert)', () => onRevert?.());
    const btnSaveClose = mkBtn('Save & Close',     () => onSaveClose?.());
    const btnSave      = mkBtn('Save',             () => onSave?.(), true);

    row.append(btnRevert, btnSaveClose, btnSave);
    card.append(h, blurb, prefRow, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ---------- SLA helpers ----------
  function activeSlaFlyouts() {
    return [
      ...$$('.GMDB3DUBOMH'),
      ...$$('.cw_PsaFlyoutRootContainer'),
      ...$$('.x-window, .x-panel')
    ].filter(visible);
  }
  function readSlaPillText() {
    const pillText = $('.cw_impact .GMDB3DUBORG')?.textContent?.trim()
                  || $('.cw_impact')?.textContent?.trim()
                  || '';
    return pillText;
  }
  function mapWord(w) {
    w = (w || '').trim().toLowerCase();
    if (w.startsWith('med')) return 'Med';
    if (w.startsWith('low')) return 'Low';
    if (w.startsWith('hi'))  return 'High';
    return null;
  }
  function slaClassFromText(txt) {
    const m = (txt || '').split('/');
    if (m.length !== 2) return null;
    const impact = mapWord(m[0]);
    const urgency = mapWord(m[1]);
    if (!impact || !urgency) return null;
    return `cw_btn${impact}${urgency}`;
  }
  function findSlaLauncher() {
    const impactBtn = $('.cw_impact .mm_button') || $('.cw_impact');
    if (visible(impactBtn)) return impactBtn;
    const priInput = $('input.cw_priority');
    const iconNeighbor = priInput?.closest('div')?.querySelector('.mm_icon, .cwsvg, .k-input-button, .k-select, button[aria-haspopup="listbox"]');
    if (visible(iconNeighbor)) return iconNeighbor;
    return null;
  }
  async function openSlaGrid() {
    const launcher = await until(() => findSlaLauncher(), { tries: 40, delay: 80 });
    if (!launcher) return false;
    launcher.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); launcher.click();
    launcher.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const wnd = await until(() => activeSlaFlyouts()[0], { tries: 40, delay: 80 });
    return !!wnd;
  }
  async function clickSlaButtonClassAndDone(cls) {
    const wnd = await until(() => activeSlaFlyouts()[0], { tries: 30, delay: 80 });
    if (!wnd) return false;
    const btn = await until(() => $('.' + cls, wnd), { tries: 30, delay: 80 });
    if (!btn) return false;
    await clickEl(btn);
    await sleep(45);
    const doneBtn = $('.cw_confirmButton .mm_button', wnd)
                 || Array.from($$('.mm_button', wnd)).find(el => /(^|\b)done\b/i.test(el.textContent || ''));
    if (doneBtn) await clickEl(doneBtn);
    const closed = await until(() => activeSlaFlyouts().length === 0, { tries: 30, delay: 80 });
    return !!closed;
  }
  async function setImpactUrgencyLowLowOrFallbackPriority() {
    if (await openSlaGrid()) {
      const ok = await clickSlaButtonClassAndDone('cw_btnLowLow');
      if (ok) return true;
    }
    return commitComboValue('input.cw_priority', 'Priority 4 - Low');
  }
  async function restoreSlaByText(prevText) {
    const cls = slaClassFromText(prevText);
    if (!cls) return false;
    if (!(await openSlaGrid())) return false;
    return clickSlaButtonClassAndDone(cls);
  }

  // ---------- UDF by label ----------
  function findUdfInputByLabel(labelText) {
    const rows = $$('.pod-element-row');
    const needle = norm(String(labelText).replace(/[:?]\s*$/,''));
    for (const row of rows) {
      const labelEl = $('.mm_label', row);
      const text = norm((labelEl?.textContent || '').replace(/[:?]\s*$/,''));
      if (text && text === needle) {
        const input = row.querySelector('input.cw_PsaUserDefinedComboBox, input.GMDB3DUBKVH');
        if (input) return input;
      }
    }
    return null;
  }

  // ---------- capture & restore ----------
  function captureValues() {
    return {
      board:    $('input.cw_serviceBoard')?.value || '',
      status:   $('input.cw_status')?.value || '',
      type:     $('input.cw_type')?.value || '',
      subtype:  $('input.cw_subType')?.value || '',
      tier:     (findUdfInputByLabel('Ticket Tier?')?.value || ''),
      priority: $('input.cw_priority')?.value || '',
      summary:  $('input.cw_PsaSummaryHeader')?.value || '',
      slaText:  readSlaPillText() || ''
    };
  }
  async function restoreValues(prev) {
    if (!prev) return;
    if (prev.slaText) {
      const ok = await restoreSlaByText(prev.slaText);
      if (!ok && prev.priority) await commitComboValue('input.cw_priority', prev.priority);
    } else if (prev.priority) {
      await commitComboValue('input.cw_priority', prev.priority);
    }
    if ($('input.cw_status') && prev.status)   await commitComboValue('input.cw_status', prev.status);
    if ($('input.cw_type') && prev.type)       await commitComboValue('input.cw_type', prev.type);
    if ($('input.cw_subType') && prev.subtype) await commitComboValue('input.cw_subType', prev.subtype);
    const tierInput = findUdfInputByLabel('Ticket Tier?');
    if (tierInput && prev.tier) await commitComboOnElement(tierInput, prev.tier);
    if ($('input.cw_serviceBoard') && prev.board) await commitComboValue('input.cw_serviceBoard', prev.board);
    const s = $('input.cw_PsaSummaryHeader');
    if (s) { nativeSetValue(s, prev.summary || ''); s.dispatchEvent(new InputEvent('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); s.blur(); }
  }

  // ---------- Summary commit ----------
  async function commitSummary(newText) {
    const summary = await until(() => $('input.cw_PsaSummaryHeader'), { tries: 40, delay: 60 });
    if (!summary) return false;
    nativeSetValue(summary, '');
    summary.dispatchEvent(new InputEvent('input', { bubbles: true }));
    nativeSetValue(summary, newText);
    summary.dispatchEvent(new InputEvent('input', { bubbles: true }));
    summary.dispatchEvent(new Event('change', { bubbles: true }));
    summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    summary.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    summary.blur();
    await sleep(90);
    if (norm(summary.value) !== norm(newText)) { summary.focus(); summary.blur(); await sleep(80); }
    return norm(summary.value) === norm(newText);
  }

  // ---------- Board-change status watcher (fast) ----------
  async function waitStatusRefresh(prevStatus) {
    const statusInput = await until(() => $('input.cw_status'), { tries: 20, delay: 40 }); // quick find
    if (!statusInput) return false;

    // Race: (1) first change event OR (2) polling for non-empty different value
    let resolved = false;
    const done = () => { resolved = true; };
    const prev = norm(prevStatus || '');

    const onChange = () => {
      const val = norm(statusInput.value || '');
      if (val && val !== prev) done();
    };
    statusInput.addEventListener('change', onChange, { once: true, passive: true });

    // Poll at ~40ms for up to 1.2s
    for (let i = 0; i < 30 && !resolved; i++) {
      const val = norm(statusInput.value || '');
      if (val && val !== prev) { resolved = true; break; }
      await sleep(40);
    }

    statusInput.removeEventListener('change', onChange);
    if (resolved) await sleep(100); // tiny settle so dependent lists keep up
    return resolved;
  }

  // ---------- actions ----------
  async function applySpamPhish({ showPrompt = true, autoSaveClose = false } = {}) {
    const prev = captureValues();

    // BOARD: only set if not already a Help Desk variant
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    let boardChanged = false;
    if (boardInput) {
      const curr = norm(boardInput.value);
      if (!curr.includes('help desk')) {
        const prevStatus = $('input.cw_status')?.value || '';
        const setOk = await commitComboOnElement(boardInput, 'Help Desk');
        if (setOk) {
          boardChanged = true;
          await waitStatusRefresh(prevStatus); // fast path (~0.1–1.2s)
        }
      }
    }

    // Status / Type / Subtype
    const steps = [
      ['input.cw_status',  'MUST ASSIGN',   'Status'],
      ['input.cw_type',    'Email',         'Type'],
      ['input.cw_subType', 'Spam/Phishing', 'Subtype'],
    ];
    for (const [sel, val, label] of steps) {
      const input = await until(() => $(sel), { tries: 30, delay: 50 });
      if (!input) { toast(`Could not find ${label}`); continue; }
      if (norm(input.value) !== norm(val)) {
        const ok = await commitComboOnElement(input, val);
        if (!ok) toast(`Could not set ${label}`);
      }
    }

    // Ticket Tier?
    const tierInput = await until(() => findUdfInputByLabel('Ticket Tier?'), { tries: 30, delay: 50 });
    if (tierInput && norm(tierInput.value) !== norm('Tier 1')) {
      const tierOk = await commitComboOnElement(tierInput, 'Tier 1');
      if (!tierOk) toast('Could not set Ticket Tier? to Tier 1');
    }

    // SLA Low/Low -> Priority 4
    await setImpactUrgencyLowLowOrFallbackPriority();

    // Summary
    const contact = $('input.cw_contact')?.value?.trim();
    await commitSummary(`Spam/Phishing${contact ? ` (${contact})` : ''}`);

    if (autoSaveClose) {
      await sleep(boardChanged ? 180 : 120);
      if (!clickSaveAndClose()) toast('Save & Close button not found');
      return;
    }

    if (showPrompt) {
      showActionDialog(
        'Apply Spam/Phishing triage — Save changes?',
        async () => { await sleep(boardChanged ? 180 : 120); if (!clickSave()) toast('Save button not found'); },
        async () => { await sleep(boardChanged ? 180 : 120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        async () => { await restoreValues(prev); toast('Reverted changes'); }
      );
    }
    toast('Spam/Phishing defaults applied');
  }

  async function applyJunk({ showPrompt = true, autoSaveClose = false } = {}) {
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (!boardInput) { toast('Board input not found'); return; }
    const prevBoard = (boardInput.value || '').trim();
    const ok = await commitComboOnElement(boardInput, 'Junk');
    if (!ok) { toast('Could not set Board to Junk'); return; }

    // Ensure CW reflects "Junk" before any save (short)
    await until(() => norm(boardInput.value) === norm('Junk'), { tries: 10, delay: 45 });
    await sleep(150);

    if (autoSaveClose) { if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog(
        'Board set to “Junk”. Save changes?',
        async () => { await sleep(150); if (!clickSave()) toast('Save button not found'); },
        async () => { await sleep(150); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        () => {
          if (prevBoard) {
            commitComboValue('input.cw_serviceBoard', prevBoard).then(ret => toast(ret ? `Reverted to "${prevBoard}"` : 'Revert failed'));
          } else {
            commitComboValue('input.cw_serviceBoard', '').then(() => toast('Reverted (cleared Board)'));
          }
        }
      );
    }
  }

  // ---------- triage UI ----------
  const BAR_ID='att-cw-triage-bar', SLOT_ID='att-cw-triage-slot', JUNK_BTN_ID='att-cw-junk-btn', SPAM_BTN_ID='att-cw-spamphish-btn';

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
      await handler({ useAuto });
    };
    outer.addEventListener('click', act);
    outer.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
    return outer;
  }

  function makeJunkButton() {
    return mkActionButton(
      JUNK_BTN_ID, 'Junk', 'Set Board to Junk (Shift-click = apply + Save & Close)',
      ({ useAuto }) => applyJunk({ showPrompt: !useAuto, autoSaveClose: useAuto })
    );
  }
  const makeSpamButton = () => mkActionButton(
    SPAM_BTN_ID, 'Spam/Phishing', 'Apply Spam/Phishing triage (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applySpamPhish({ showPrompt: !useAuto, autoSaveClose: useAuto })
  );

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

  function makeBar() {
    const bar = document.createElement('div');
    bar.id = BAR_ID;
    Object.assign(bar.style, {
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '6px 0 8px 0', flexWrap: 'wrap', position: 'relative', zIndex: '0', marginLeft: '8px'
    });
    const left = makeLabel();
    const slot = document.createElement('div');
    slot.id = SLOT_ID;
    Object.assign(slot.style, { display: 'inline-flex', gap: '8px', flexWrap: 'wrap' });
    slot.appendChild(makeJunkButton());
    slot.appendChild(makeSpamButton());
    bar.append(left, slot);
    return bar;
  }

  // ---------- placement & SPA ----------
  function isProjectTicket() {
    const n = (s) => (s || '').toLowerCase();
    const has = (sel, needle) => $$(sel).some(el => visible(el) && n(el.textContent).includes(n(needle)));
    if (has('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Board')) return true;
    if (visible($('input.cw_projectBoard'))) return true;
    if (visible($('.cw_project'))) return true;
    return false;
  }
  function findTicketPodRoot() {
    return $('.pod_service_ticket_ticket') || $('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBLGH') || null;
  }
  function findHeaderBlock(podRoot) {
    return podRoot?.querySelector('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBHGH') || null;
  }

  function ensureBarPlaced() {
    if (isProjectTicket()) { $('#'+BAR_ID)?.remove(); return false; }
    const existingSlot = $('#'+SLOT_ID);
    if (existingSlot) {
      if (!$('#'+JUNK_BTN_ID)) existingSlot.appendChild(makeJunkButton());
      if (!$('#'+SPAM_BTN_ID)) existingSlot.appendChild(makeSpamButton());
      return true;
    }
    const pod = findTicketPodRoot();
    const header = pod && findHeaderBlock(pod);
    if (!header) return false;
    if (!$('#'+BAR_ID)) header.insertAdjacentElement('afterend', makeBar());
    return true;
  }

  let lastHref = location.href;
  const mo = new MutationObserver(() => {
    if (lastHref !== location.href) { lastHref = location.href; $('#'+BAR_ID)?.remove(); }
    ensureBarPlaced();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensureBarPlaced); return r; };
  });
  window.addEventListener('popstate', ensureBarPlaced);

  ensureBarPlaced();
  setTimeout(ensureBarPlaced, 200);
  setTimeout(ensureBarPlaced, 700);
})();
