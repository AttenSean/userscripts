// ==UserScript==
// @name         attentus-cw-ticket-quick-triage
// @namespace    https://github.com/AttenSean/userscripts
// @version      2.18.0
// @description  Quick Triage bar with Junk, Spam/Phishing, Invoice, and MAC (dropdown). Per-action Save pop-up settings, summary settings, and Shift+Click auto Save & Close. Invoice clears Contact/Phone/Email. SPA-safe, waits for dependent list refresh after Board changes. Hides on Project tickets.
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
  const PREF_KEY_SUMMARY_FLAGS  = 'att_cw_triage_summaryFlags'; // { spam:true, invoice:false (hidden), mac:true, junk:false (hidden) }
  const PREF_KEY_SAVE_PROMPTS   = 'att_cw_triage_savePrompts';  // { junk:true, spam:true, invoice:true, mac:false }

  async function getPref(key, defVal) {
    try { if (window.GM?.getValue) return await window.GM.getValue(key, defVal); } catch {}
    try { const raw = localStorage.getItem(key); return raw == null ? defVal : JSON.parse(raw); } catch {}
    return defVal;
  }
  async function setPref(key, val) {
    try { if (window.GM?.setValue) await window.GM.setValue(key, val); } catch {}
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  const defaultSummaryFlags = { spam:true, invoice:false, mac:true, junk:false };
  const defaultSavePrompts  = { junk:true, spam:true, invoice:true, mac:false };

  let shiftAutoSaveEnabled = false;
  let summaryFlags = { ...defaultSummaryFlags };
  let savePrompts  = { ...defaultSavePrompts };

  (async () => {
    shiftAutoSaveEnabled = await getPref(PREF_KEY_SHIFT_AUTOSAVE, false);
    summaryFlags = { ...defaultSummaryFlags, ...(await getPref(PREF_KEY_SUMMARY_FLAGS, defaultSummaryFlags)) };
    savePrompts  = { ...defaultSavePrompts,  ...(await getPref(PREF_KEY_SAVE_PROMPTS,  defaultSavePrompts )) };
  })();

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

    await typeFast(input, desiredValue);
    await sleep(60);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    if (norm(input.value) === norm(desiredValue)) return true;

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

  // ---------- SLA helpers (Spam/Phishing only) ----------
  function activeSlaFlyouts() {
    return [
      ...$$('.GMDB3DUBOMH'),
      ...$$('.cw_PsaFlyoutRootContainer'),
      ...$$('.x-window, .x-panel')
    ].filter(visible);
  }
  function readSlaPillText() {
    const pillText = $('.cw_impact .GMDB3DUBORG')?.textContent?.trim()
                  || $('.cw_impact')?.textContent?.trim() || '';
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
      contact:  $('input.cw_contact')?.value || '',
      email:    $('input.cw_emailAddress')?.value || '',
      phoneInputs: Array.from($('.cw_contactPhoneCommunications')?.querySelectorAll('input[type="text"]') || [])
                       .map(inp => inp.value || ''),
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
    const tierInput = await until(() => findUdfInputByLabel('Ticket Tier?'), { tries: 20, delay: 60 });
    if (tierInput && prev.tier) await commitComboOnElement(tierInput, prev.tier);
    if ($('input.cw_serviceBoard') && prev.board) await commitComboValue('input.cw_serviceBoard', prev.board);

    const s = $('input.cw_PsaSummaryHeader');
    if (s) { nativeSetValue(s, prev.summary || ''); s.dispatchEvent(new InputEvent('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); s.blur(); }

    const contact = $('input.cw_contact');
    if (contact) { nativeSetValue(contact, prev.contact || ''); contact.dispatchEvent(new Event('input', { bubbles: true })); contact.dispatchEvent(new Event('change', { bubbles: true })); contact.blur(); }

    const email = $('input.cw_emailAddress');
    if (email) { nativeSetValue(email, prev.email || ''); email.dispatchEvent(new Event('input', { bubbles: true })); email.dispatchEvent(new Event('change', { bubbles: true })); email.blur(); }

    const phoneBlock = $('.cw_contactPhoneCommunications');
    if (phoneBlock && Array.isArray(prev.phoneInputs)) {
      const inputs = Array.from(phoneBlock.querySelectorAll('input[type="text"]'));
      inputs.forEach((inp, idx) => {
        nativeSetValue(inp, prev.phoneInputs[idx] || '');
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.blur();
      });
    }
  }

  // ---------- clear helpers (Invoice) ----------
  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }
  function clearContactPhoneEmail_BakedIn() {
    const contact = $('input.cw_contact');
    if (contact) { nativeSetValue(contact, ''); dispatchAll(contact); }
    const email = $('input.cw_emailAddress');
    if (email) { nativeSetValue(email, ''); dispatchAll(email); }
    const phoneBlock = $('.cw_contactPhoneCommunications');
    if (phoneBlock) {
      phoneBlock.querySelectorAll('input[type="text"]').forEach(inp => {
        nativeSetValue(inp, ''); dispatchAll(inp);
      });
    }
    const stillHas = !!($('input.cw_contact')?.value?.trim()
                     || $('input.cw_emailAddress')?.value?.trim()
                     || Array.from($('.cw_contactPhoneCommunications')?.querySelectorAll('input[type="text"]') || [])
                            .some(i => (i.value || '').trim()));
    return !stillHas;
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

  // ---------- action dialog (with Shift-click toggle) ----------
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

    const blurb = document.createElement('div');
    blurb.innerHTML = `<div style="font-size:12px;color:#4B5563;margin:6px 0 10px;">
      <strong>Tip:</strong> <kbd>Shift</kbd> + Click any triage button to <em>apply</em> and <em>Save & Close</em> immediately (no prompt).
    </div>`;

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

    // Order: Dismiss (keep changes), Cancel (revert), Save & Close, Save
    row.append(
      mkBtn('Dismiss (keep changes)', () => onDismiss?.(), false),
      mkBtn('Cancel (revert)',        () => onRevert?.(), false),
      mkBtn('Save & Close',           () => onSaveClose?.(), false),
      mkBtn('Save',                   () => onSave?.(), true)
    );

    card.append(h, blurb, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ---------- Board-change status watcher ----------
  async function waitStatusRefresh(prevStatus) {
    const statusInput = await until(() => $('input.cw_status'), { tries: 20, delay: 40 });
    if (!statusInput) return false;

    let resolved = false;
    const prev = norm(prevStatus || '');
    const onChange = () => {
      const val = norm(statusInput.value || '');
      if (val && val !== prev) resolved = true;
    };
    statusInput.addEventListener('change', onChange, { once: true, passive: true });

    for (let i = 0; i < 30 && !resolved; i++) {
      const val = norm(statusInput.value || '');
      if (val && val !== prev) { resolved = true; break; }
      await sleep(40);
    }
    statusInput.removeEventListener('change', onChange);
    if (resolved) await sleep(100);
    return resolved;
  }

  // ---------- actions ----------
  async function applySpamPhish({ showPrompt = true, autoSaveClose = false } = {}) {
    const prev = captureValues();

    // Board: Help Desk (if not already)
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (boardInput && !norm(boardInput.value).includes('help desk')) {
      const prevStatus = $('input.cw_status')?.value || '';
      if (await commitComboOnElement(boardInput, 'Help Desk')) await waitStatusRefresh(prevStatus);
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

    // Summary (optional)
    if (summaryFlags.spam) {
      const contact = $('input.cw_contact')?.value?.trim();
      await commitSummary(`Spam/Phishing${contact ? ` (${contact})` : ''}`);
    }

    if (autoSaveClose) { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog('Apply Spam/Phishing triage — Save changes?', {
        onSave:      async () => { await sleep(120); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    async () => { await restoreValues(prev); toast('Reverted changes'); },
        onDismiss:   () => {} // keep changes, do nothing
      });
    }
    toast('Spam/Phishing defaults applied');
  }

  async function applyInvoice({ showPrompt = true, autoSaveClose = false } = {}) {
    const prev = captureValues();

    // Board: Help Desk (if not already)
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (boardInput && !norm(boardInput.value).includes('help desk')) {
      const prevStatus = $('input.cw_status')?.value || '';
      if (await commitComboOnElement(boardInput, 'Help Desk')) await waitStatusRefresh(prevStatus);
    }

    // Status / Type / Subtype
    const steps = [
      ['input.cw_status',  '>Closed/Cancelled', 'Status'],
      ['input.cw_type',    'Company',           'Type'],
      ['input.cw_subType', 'Invoice',           'Subtype'],
    ];
    for (const [sel, val, label] of steps) {
      const input = await until(() => $(sel), { tries: 30, delay: 50 });
      if (!input) { toast(`Could not find ${label}`); continue; }
      if (norm(input.value) !== norm(val)) {
        const ok = await commitComboOnElement(input, val);
        if (!ok) toast(`Could not set ${label}`);
      }
    }

    // Ticket Tier? -> N/A - Cancelled Ticket
    const tierInput = await until(() => findUdfInputByLabel('Ticket Tier?'), { tries: 30, delay: 50 });
    if (tierInput && norm(tierInput.value) !== norm('N/A - Cancelled Ticket')) {
      const tierOk = await commitComboOnElement(tierInput, 'N/A - Cancelled Ticket');
      if (!tierOk) toast('Could not set Ticket Tier? to "N/A - Cancelled Ticket"');
    }

    // Clear Contact/Phone/Email (leave Company)
    clearContactPhoneEmail_BakedIn();

    // (Summary toggle hidden; default false)
    if (summaryFlags.invoice) await commitSummary('Invoice');

    if (autoSaveClose) { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog('Apply Invoice triage — Save changes?', {
        onSave:      async () => { await sleep(120); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    async () => { await restoreValues(prev); toast('Reverted changes'); },
        onDismiss:   () => {}
      });
    }
    toast('Invoice defaults applied');
  }

  async function applyJunk({ showPrompt = true, autoSaveClose = false } = {}) {
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (!boardInput) { toast('Board input not found'); return; }
    const prevBoard = (boardInput.value || '').trim();
    const ok = await commitComboOnElement(boardInput, 'Junk');
    if (!ok) { toast('Could not set Board to Junk'); return; }

    await until(() => norm(boardInput.value) === norm('Junk'), { tries: 10, delay: 45 });
    await sleep(150);

    if (autoSaveClose) { if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog('Board set to “Junk”. Save changes?', {
        onSave:      async () => { await sleep(150); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(150); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    () => {
          if (prevBoard) {
            commitComboValue('input.cw_serviceBoard', prevBoard).then(ret => toast(ret ? `Reverted to "${prevBoard}"` : 'Revert failed'));
          } else {
            commitComboValue('input.cw_serviceBoard', '').then(() => toast('Reverted (cleared Board)'));
          }
        },
        onDismiss:   () => {}
      });
    }
  }

  // ---------- MAC actions ----------
  const MAC_OPTIONS = [
    { key: 'onboard_user', label: 'Onboard User',        subtype: 'Onboard User',         udf: 'User/Computer Setup or Replacement', summaryPrefix: 'Onboard User -' },
    { key: 'offboard_user',label: 'Offboard User',       subtype: 'Offboard User',        udf: 'User/Computer Decommission',         summaryPrefix: 'Offboard User -' },
    { key: 'onboard_ws',  label: 'Onboard Workstation',  subtype: 'Onboard Workstation',  udf: 'User/Computer Setup or Replacement', summaryPrefix: 'Onboard Workstation -' },
    { key: 'offboard_ws', label: 'Offboard Workstation', subtype: 'Offboard Workstation', udf: 'User/Computer Decommission',         summaryPrefix: 'Offboard Workstation -' },
    { key: 'move',        label: 'User/Workstation Move',subtype: 'User Workstation Move',udf: 'User/Computer Move/Change (Ex. User moving from one computer to another)', summaryPrefix: 'User/Workstation Move -' },
  ];

  async function applyMacOption(opt, { showPrompt = false, autoSaveClose = false } = {}) {
    const prev = captureValues();

    // Board: MoveAddChange (if not already)
    const boardInput = await until(() => $('input.cw_serviceBoard'), { tries: 40, delay: 60 });
    if (boardInput && !norm(boardInput.value).includes('moveaddchange')) {
      const prevStatus = $('input.cw_status')?.value || '';
      if (await commitComboOnElement(boardInput, 'MoveAddChange')) await waitStatusRefresh(prevStatus);
    }

    // Type / Subtype
    const steps = [
      ['input.cw_type',    'Company',       'Type'],
      ['input.cw_subType', opt.subtype,     'Subtype'],
    ];
    for (const [sel, val, label] of steps) {
      const input = await until(() => $(sel), { tries: 30, delay: 50 });
      if (!input) { toast(`Could not find ${label}`); continue; }
      if (norm(input.value) !== norm(val)) {
        const ok = await commitComboOnElement(input, val);
        if (!ok) toast(`Could not set ${label}`);
      }
    }

    // MAC Ticket Type? UDF
    const macUdf = await until(() => findUdfInputByLabel('MAC Ticket Type?'), { tries: 30, delay: 50 });
    if (macUdf && norm(macUdf.value) !== norm(opt.udf)) {
      const ok = await commitComboOnElement(macUdf, opt.udf);
      if (!ok) toast('Could not set MAC Ticket Type?');
    }

    // Summary (optional)
    if (summaryFlags.mac) {
      const contact = $('input.cw_contact')?.value?.trim() || '';
      const suffix = contact ? ` (${contact})` : '';
      await commitSummary(`${opt.summaryPrefix} ${suffix}`.replace(/\s+$/, ''));
    }

    if (autoSaveClose) { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); return; }

    if (showPrompt) {
      showActionDialog(`Apply MAC: ${opt.label} — Save changes?`, {
        onSave:      async () => { await sleep(120); if (!clickSave()) toast('Save button not found'); },
        onSaveClose: async () => { await sleep(120); if (!clickSaveAndClose()) toast('Save & Close button not found'); },
        onRevert:    async () => { await restoreValues(prev); toast('Reverted changes'); },
        onDismiss:   () => {}
      });
    }

    toast(`MAC applied: ${opt.label}`);
  }

  // ---------- triage UI ----------
  const BAR_ID='att-cw-triage-bar',
        SLOT_ID='att-cw-triage-slot',
        JUNK_BTN_ID='att-cw-junk-btn',
        SPAM_BTN_ID='att-cw-spamphish-btn',
        INVOICE_BTN_ID='att-cw-invoice-btn',
        MAC_BTN_ID='att-cw-mac-btn',
        SETTINGS_BTN_ID='att-cw-triage-settings-btn',
        MAC_MENU_ID='att-cw-mac-menu';

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
    JUNK_BTN_ID, 'Junk', 'Set Board to Junk (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applyJunk({ showPrompt: !useAuto && !!savePrompts.junk, autoSaveClose: useAuto })
  );
  const makeSpamButton = () => mkActionButton(
    SPAM_BTN_ID, 'Spam/Phishing', 'Apply Spam/Phishing triage (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applySpamPhish({ showPrompt: !useAuto && !!savePrompts.spam, autoSaveClose: useAuto })
  );
  const makeInvoiceButton = () => mkActionButton(
    INVOICE_BTN_ID, 'Invoice', 'Apply Invoice triage (Shift-click = apply + Save & Close)',
    ({ useAuto }) => applyInvoice({ showPrompt: !useAuto && !!savePrompts.invoice, autoSaveClose: useAuto })
  );

  // Floating MAC menu (portal to <body>) to avoid clipping behind CW panels
  function ensureMacMenu() {
    let menu = document.getElementById(MAC_MENU_ID);
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = MAC_MENU_ID;
    Object.assign(menu.style, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      display: 'none',
      background: '#fff',
      border: '1px solid #E5E7EB',
      borderRadius: '10px',
      boxShadow: '0 14px 40px rgba(0,0,0,.25)',
      padding: '8px',
      zIndex: 2147483646,
      minWidth: '260px'
    });

    MAC_OPTIONS.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
      Object.assign(item.style, { display: 'block', margin: '4px 0' });

      const btn = document.createElement('div');
      btn.className = 'GMDB3DUBIOG mm_button';
      btn.tabIndex = 0;

      const inner = document.createElement('div');
      inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

      const label = document.createElement('div');
      label.className = 'GMDB3DUBBPG';
      label.textContent = opt.label;

      inner.appendChild(label);
      btn.appendChild(inner);
      item.appendChild(btn);

      const click = async (e) => {
        e.preventDefault(); e.stopPropagation();
        hideMacMenu();
        const useAuto = e.shiftKey && shiftAutoSaveEnabled;
        await applyMacOption(opt, { showPrompt: !useAuto && !!savePrompts.mac, autoSaveClose: useAuto });
      };
      item.addEventListener('click', click);
      item.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') click(e); });

      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    return menu;
  }
  function showMacMenu(anchorEl) {
    const menu = ensureMacMenu();
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 20, rect.bottom + 6);
    const left = Math.max(10, Math.min(window.innerWidth - 270, rect.left));
    Object.assign(menu.style, { top: `${top}px`, left: `${left}px`, display: 'block' });

    const close = (ev) => { if (!menu.contains(ev.target)) hideMacMenu(); };
    setTimeout(() => document.addEventListener('mousedown', close, { once: true }), 0);
    window.addEventListener('resize', hideMacMenu, { once: true });
    window.addEventListener('scroll', hideMacMenu, { once: true });
  }
  function hideMacMenu() {
    const menu = document.getElementById(MAC_MENU_ID);
    if (menu) menu.style.display = 'none';
  }
  function makeMacButton() {
    return mkActionButton(
      MAC_BTN_ID, 'MAC ▾', 'Choose a MAC option (Shift-click = apply + Save & Close)',
      ({ outer }) => {
        const menu = document.getElementById(MAC_MENU_ID);
        if (menu && menu.style.display === 'block') hideMacMenu();
        else showMacMenu(outer);
      }
    );
  }

  // ---------- Settings gear ----------
  function makeSettingsButton() {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = SETTINGS_BTN_ID;
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
        background: '#fff', borderRadius: '12px', minWidth: '340px', maxWidth: '560px',
        padding: '16px', boxShadow: '0 10px 30px rgba(0,0,0,.25)',
        font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
      });

      const h = document.createElement('div');
      h.textContent = 'Quick Triage Settings';
      Object.assign(h.style, { fontSize: '15px', fontWeight: 600, marginBottom: '10px' });

      const sec1 = document.createElement('div');
      sec1.textContent = 'Summary updates';
      Object.assign(sec1.style, { fontWeight: 600, fontSize: '12px', margin: '8px 0 4px', color: '#374151' });

      function mkRow(getter, setter, key, labelText) {
        const row = document.createElement('label');
        row.style.cssText = 'display:flex;align-items:center;gap:8px;margin:4px 0;color:#111827;font-size:13px;';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!getter()[key];
        cb.addEventListener('change', () => { setter(key, cb.checked); });
        const span = document.createElement('span');
        span.textContent = labelText;
        row.append(cb, span);
        return row;
      }

      const rows1 = document.createElement('div');
      // Hide Junk/Invoice summary toggles as requested
      rows1.append(
        mkRow(() => summaryFlags, (k,v)=>{ summaryFlags[k]=v; }, 'spam', 'Update Summary for Spam/Phishing'),
        mkRow(() => summaryFlags, (k,v)=>{ summaryFlags[k]=v; }, 'mac',  'Update Summary for MAC options')
      );

      const sec2 = document.createElement('div');
      sec2.textContent = 'Save pop-up';
      Object.assign(sec2.style, { fontWeight: 600, fontSize: '12px', margin: '12px 0 4px', color: '#374151' });

      const rows2 = document.createElement('div');
      rows2.append(
        mkRow(() => savePrompts, (k,v)=>{ savePrompts[k]=v; }, 'junk',    'Show Save pop-up for Junk'),
        mkRow(() => savePrompts, (k,v)=>{ savePrompts[k]=v; }, 'spam',    'Show Save pop-up for Spam/Phishing'),
        mkRow(() => savePrompts, (k,v)=>{ savePrompts[k]=v; }, 'invoice', 'Show Save pop-up for Invoice'),
        mkRow(() => savePrompts, (k,v)=>{ savePrompts[k]=v; }, 'mac',     'Show Save pop-up for MAC (all options)')
      );

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
        await setPref(PREF_KEY_SUMMARY_FLAGS, summaryFlags);
        await setPref(PREF_KEY_SAVE_PROMPTS,  savePrompts);
        toast('Settings saved'); overlay.remove();
      }, true);
      const cancelBtn = mkBtn('Cancel', () => overlay.remove());

      actions.append(cancelBtn, saveBtn);

      card.append(h, sec1, rows1, sec2, rows2, actions);
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
    // ORDER: Junk • Spam/Phishing • Invoice • MAC • ⚙︎
    slot.appendChild(makeJunkButton());
    slot.appendChild(makeSpamButton());
    slot.appendChild(makeInvoiceButton());
    slot.appendChild(makeMacButton());
    slot.appendChild(makeSettingsButton());
    bar.append(left, slot);
    return bar;
  }

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
    if (isProjectTicket()) { $('#att-cw-triage-bar')?.remove(); hideMacMenu(); return false; }
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
    if (lastHref !== location.href) { lastHref = location.href; $('#att-cw-triage-bar')?.remove(); hideMacMenu(); }
    ensureBarPlaced();
  });
  mo.observe(document.documentElement, { subtree: true, childList: true });
  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensureBarPlaced); return r; };
  });
  window.addEventListener('popstate', () => { ensureBarPlaced(); hideMacMenu(); });

  ensureBarPlaced();
  setTimeout(ensureBarPlaced, 200);
  setTimeout(ensureBarPlaced, 700);
})();
