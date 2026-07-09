// ==UserScript==
// @name         attentus-cw-ticket-quick-triage
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.21.0
// @description  Quick Triage — provides buttons for Junk and Cancel, with board-specific learned cancel status support. Optional Save/S&C prompt, Shift+Click turbo. SPA-safe, hides on Project tickets.
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
  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.debug('[Quick Triage]', ...args); };

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
  const PREF_KEY_BOARD_CONFIGS = 'att_cw_triage_boardConfigs';
  const DEFAULT_CANCEL_STATUS = '>Closed/Cancelled';
  let shiftAutoSaveEnabled = false;
  let savePrompts  = { junk: true, cancel: true };
  let boardConfigs = {};

  function sanitizeBoardConfigs(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const clean = {};
    for (const [board, config] of Object.entries(value)) {
      const boardName = String(board || '').trim();
      if (!boardName || config == null || Array.isArray(config)) continue;

      const cancelStatus = String(typeof config === 'string' ? config : config.cancelStatus || '').trim();
      if (!cancelStatus) continue;

      clean[boardName] = { cancelStatus };
    }

    return clean;
  }

  function sanitizeSavePrompts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...savePrompts };
    return {
      junk: typeof value.junk === 'boolean' ? value.junk : savePrompts.junk,
      cancel: typeof value.cancel === 'boolean' ? value.cancel : savePrompts.cancel
    };
  }

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
    shiftAutoSaveEnabled = await getPref(PREF_KEY_SHIFT_AUTOSAVE, false) === true;
    savePrompts = sanitizeSavePrompts(await getPref(PREF_KEY_SAVE_PROMPTS, savePrompts));
    boardConfigs = sanitizeBoardConfigs(await getPref(PREF_KEY_BOARD_CONFIGS, {}));
  })();

  // ---------- action model ----------
  const ACTIONS = {
    junk: {
      label: 'Junk',
      targetField: 'input.cw_serviceBoard',
      value: () => 'Junk'
    },
    cancel: {
      label: 'Cancel',
      targetField: 'input.cw_status',
      value: () => getCancelStatusForCurrentBoard()
    }
  };

  // ---------- combo helpers ----------
  function openChevronFor(input) {
    const combo = input?.closest('.mm_comboBox') || input?.closest('div');

    const chev =
      combo?.querySelector('.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]');

    if (visible(chev)) {
      chev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      chev.click();
      chev.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }

    if (!input) return false;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    return true;
  }
  async function openPopupAndGetContainer(input) {
    const before = new Set([
      ...$$('.GMDB3DUBPDJ.GMDB3DUBGFJ'),
      ...$$('.k-animation-container, .k-popup, .select2-container--open, [data-popup-open="true"]'),
      ...$$('.x-layer, .x-menu-floating, .x-combo-list')
    ].filter(visible));
    openChevronFor(input);
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
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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
      return !!(await until(() => norm(input.value) === norm(desiredValue), { tries: 6, delay: 50 }));
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
    if (await until(() => norm(input.value) === norm(desiredValue), { tries: 8, delay: 50 })) return true;

    // Last try: open, ArrowDown, Enter
    await openPopupAndGetContainer(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    return !!(await until(() => norm(input.value) === norm(desiredValue), { tries: 8, delay: 50 }));
  }


  async function setComboValue(input, desiredValue) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ok = await commitComboOnElement(input, desiredValue);
      if (ok) return true;

      await until(() => norm(input?.value) === norm(desiredValue), { tries: 5, delay: 100 });
      if (norm(input?.value) === norm(desiredValue)) return true;

      await sleep(250);
    }

    return false;
  }

  function getBoardName() {
    return $('input.cw_serviceBoard')?.value?.trim() || '';
  }

  function getCurrentStatus() {
    return $('input.cw_status')?.value?.trim() || '';
  }

  function getCancelStatusForCurrentBoard() {
    const board = getBoardName();
    return boardConfigs?.[board]?.cancelStatus || DEFAULT_CANCEL_STATUS;
  }

  async function learnCancelStatusForCurrentBoard() {
    const board = getBoardName();
    const status = getCurrentStatus();

    if (!board) {
      toast('Board not found');
      return false;
    }

    if (!status) {
      toast('Status not found');
      return false;
    }

    boardConfigs[board] = {
      ...(boardConfigs[board] || {}),
      cancelStatus: status
    };

    boardConfigs = sanitizeBoardConfigs(boardConfigs);
    await setPref(PREF_KEY_BOARD_CONFIGS, boardConfigs);
    toast(`Learned cancel status: ${board} -> ${status}`, 2200);
    return true;
  }

  async function forgetCancelStatusForCurrentBoard() {
    const board = getBoardName();
    if (!board) {
      toast('Board not found');
      return false;
    }

    if (!boardConfigs?.[board]) {
      toast(`No learned cancel status for ${board}`, 1800);
      return false;
    }

    delete boardConfigs[board];
    boardConfigs = sanitizeBoardConfigs(boardConfigs);
    await setPref(PREF_KEY_BOARD_CONFIGS, boardConfigs);
    toast(`Forgot cancel status for ${board}`, 1800);
    return true;
  }

  function boardMappingsJson() {
    return JSON.stringify(sanitizeBoardConfigs(boardConfigs), null, 2);
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

  async function applyAction(actionKey, { showPrompt = true, autoSaveClose = false } = {}) {
    const action = ACTIONS[actionKey];
    const input = await until(() => $(action.targetField), { tries: 40, delay: 60 });
    if (!input) { toast(`${action.label} input not found`); return false; }

    const prevValue = input.value || '';
    const desiredValue = typeof action.value === 'function' ? action.value() : action.value;
    log('Applying action', { actionKey, targetField: action.targetField, desiredValue });

    const ok = await setComboValue(input, desiredValue);
    if (!ok) { toast(`Could not set ${actionKey === 'cancel' ? 'Status' : action.label} to ${desiredValue}`, 2200); return false; }

    await until(() => norm(input.value) === norm(desiredValue), { tries: 20, delay: 100 });

    if (autoSaveClose) { if (!clickSaveAndClose()) toast('Save & Close button not found'); return true; }

    if (showPrompt) {
      showActionDialog(actionKey === 'junk' ? 'Board set to “Junk”. Save changes?' : `Set Status to "${desiredValue}". Save changes?`, {
        onSave:      async () => { if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    async () => {
          const currentInput = $(action.targetField);
          if (currentInput && prevValue) {
            const reverted = await setComboValue(currentInput, prevValue);
            toast(reverted && actionKey === 'junk' ? `Reverted to "${prevValue}"` : 'Reverted changes');
          } else if (currentInput) {
            currentInput.focus();
            currentInput.value = '';
            currentInput.dispatchEvent(new Event('change', { bubbles: true }));
            toast(actionKey === 'junk' ? 'Reverted (cleared Board)' : 'Reverted changes');
          }
        },
        onDismiss:   () => {}
      });
    } else {
      toast(actionKey === 'junk' ? 'Junk applied' : `Cancel status applied: ${desiredValue}`, actionKey === 'junk' ? 1100 : 1600);
    }

    return true;
  }

  // ---------- Junk action ----------
  async function applyJunk({ showPrompt = true, autoSaveClose = false } = {}) {
    return applyAction('junk', { showPrompt, autoSaveClose });
  }

  // ---------- Cancel action ----------
  async function applyClosedCancelled({ showPrompt = true, autoSaveClose = false } = {}) {
    return applyAction('cancel', { showPrompt, autoSaveClose });
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
        mkRow('cancel', 'Show Save pop-up for Cancel')
      );

      const shiftRow = document.createElement('label');
      shiftRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;color:#111827;font-size:13px;';
      const shiftCb = document.createElement('input');
      shiftCb.type = 'checkbox';
      shiftCb.checked = !!shiftAutoSaveEnabled;
      shiftCb.addEventListener('change', () => { shiftAutoSaveEnabled = shiftCb.checked; });
      const shiftText = document.createElement('span');
      shiftText.textContent = 'Enable Shift+Click Auto Save & Close';
      shiftRow.append(shiftCb, shiftText);
      rows.appendChild(shiftRow);

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

      const boardInfo = document.createElement('div');
      boardInfo.style.cssText = 'font-size:12px;color:#374151;margin-top:10px;line-height:1.5;';
      const currentBoardText = document.createElement('span');
      const currentStatusText = document.createElement('span');
      const learnedStatusText = document.createElement('span');

      const mappingsTitle = document.createElement('div');
      mappingsTitle.textContent = 'Learned board mappings';
      mappingsTitle.style.cssText = 'font-size:12px;font-weight:700;color:#111827;margin-top:12px;';
      const mappingsList = document.createElement('pre');
      mappingsList.style.cssText = 'font-size:12px;color:#374151;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:8px;max-height:120px;overflow:auto;white-space:pre-wrap;margin:6px 0 0;';

      const mappingJson = document.createElement('textarea');
      mappingJson.style.cssText = 'width:100%;min-height:90px;margin-top:8px;font:12px ui-monospace,SFMono-Regular,Consolas,monospace;border:1px solid #D1D5DB;border-radius:8px;padding:8px;box-sizing:border-box;';
      mappingJson.placeholder = 'Export/import learned board mappings as JSON';

      const refreshBoardInfo = () => {
        currentBoardText.textContent = getBoardName() || '(not found)';
        currentStatusText.textContent = getCurrentStatus() || '(not found)';
        learnedStatusText.textContent = getCancelStatusForCurrentBoard();
        const entries = Object.entries(sanitizeBoardConfigs(boardConfigs)).sort(([a], [b]) => a.localeCompare(b));
        mappingsList.textContent = entries.length
          ? entries.map(([board, cfg]) => `${board} -> ${cfg.cancelStatus}`).join('\n')
          : '(no learned board mappings)';
        mappingJson.value = boardMappingsJson();
      };

      boardInfo.append(
        'Current Board: ', currentBoardText,
        document.createElement('br'),
        'Current Status: ', currentStatusText,
        document.createElement('br'),
        'Learned Cancel Status: ', learnedStatusText
      );

      const learnRow = document.createElement('div');
      Object.assign(learnRow.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-start', marginTop: '8px' });
      const learnBtn = mkBtn('Learn Cancel Status For This Board', async () => {
        await learnCancelStatusForCurrentBoard();
        refreshBoardInfo();
      }, false);
      const forgetBtn = mkBtn('Forget This Board', async () => {
        await forgetCancelStatusForCurrentBoard();
        refreshBoardInfo();
      }, false);
      learnRow.append(learnBtn, forgetBtn);

      const importExportRow = document.createElement('div');
      Object.assign(importExportRow.style, { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-start', marginTop: '8px' });
      const exportBtn = mkBtn('Export Mappings', () => { mappingJson.value = boardMappingsJson(); mappingJson.select(); }, false);
      const importBtn = mkBtn('Import Mappings', () => {
        try {
          const parsed = JSON.parse(mappingJson.value || '{}');
          boardConfigs = sanitizeBoardConfigs(parsed);
          refreshBoardInfo();
          toast('Mappings imported; click Save to keep them', 2200);
        } catch (err) {
          log('Mapping import failed', err);
          toast('Invalid mapping JSON', 2200);
        }
      }, false);
      importExportRow.append(exportBtn, importBtn);

      const saveBtn = mkBtn('Save', async () => {
        boardConfigs = sanitizeBoardConfigs(boardConfigs);
        await setPref(PREF_KEY_SAVE_PROMPTS, savePrompts);
        await setPref(PREF_KEY_SHIFT_AUTOSAVE, !!shiftAutoSaveEnabled);
        await setPref(PREF_KEY_BOARD_CONFIGS, boardConfigs);
        toast('Settings saved'); overlay.remove();
      }, true);
      const cancelBtn = mkBtn('Cancel', () => overlay.remove());

      actions.append(cancelBtn, saveBtn);
      refreshBoardInfo();
      card.append(h, rows, tip, boardInfo, learnRow, mappingsTitle, mappingsList, mappingJson, importExportRow, actions);
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
    'att-cw-cancel-btn', 'Cancel', 'Set Status to the learned cancel status for this board. Shift-click = apply + Save & Close',
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
    // Buttons: Junk • Cancel • ⚙︎
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
