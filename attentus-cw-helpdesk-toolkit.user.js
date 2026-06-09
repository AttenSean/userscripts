// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1.0
// @description  Helpdesk toolkit for ConnectWise ticket triage. Confirms before DOM-only field changes and keeps clipboard draft fallback mode.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BAR_ID = 'att-cw-helpdesk-toolkit-bar';
  const SLOT_ID = 'att-cw-helpdesk-toolkit-slot';
  const TRIAGE_MODE_STORAGE_KEY = 'att_hd_triage_mode';
  const TRIAGE_MODES = new Set(['confirmApply']);
  const DEFAULT_TRIAGE_MODE = 'confirmApply';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const TRIAGE_APPLY_TOOLTIP = [
    'Changes visible ConnectWise fields only after confirmation.',
    'Does not call ConnectWise or ITGlue APIs.',
    'Triage button clicks only apply fields to the browser UI; saving is offered only in the post-apply dialog.',
    'No click shortcut will automatically Save & Close.'
  ].join('\n');

  const TRIAGE_DRAFT_TOOLTIP = [
    'Copies a triage draft to the clipboard only.',
    'Does not change visible ConnectWise fields.',
    'Does not call ConnectWise or ITGlue APIs.'
  ].join('\n');

  const TRIAGE_WORKFLOWS = {
    spam: {
      buttonLabel: 'Spam/Phishing…',
      draftLabel: 'Copy Spam Draft',
      confirmationTitle: 'Confirm Spam/Phishing triage',
      fieldSummary: 'Classify the ticket as Spam/Phishing with Help Desk ownership, Tier 1 handling, Priority 4 urgency, and a normalized contact-aware summary.',
      mutations: [
        { field: 'board', value: 'Help Desk' },
        { field: 'status', value: 'MUST ASSIGN' },
        { field: 'type', value: 'Email' },
        { field: 'subtype', value: 'Spam/Phishing' },
        { field: 'tier', value: 'Tier 1' },
        { field: 'priority', value: 'Priority 4' },
        { field: 'summary', valueFrom: 'summaryTemplate' }
      ],
      summaryTemplate: ({ contact }) => `Spam/Phishing${contact ? ` (${contact})` : ''}`,
      postApplyMessage: 'Spam/Phishing fields applied'
    },
    junk: {
      buttonLabel: 'Junk…',
      draftLabel: 'Copy Junk Draft',
      confirmationTitle: 'Confirm Junk triage',
      fieldSummary: 'Move the ticket to the Junk board.',
      mutations: [
        { field: 'board', value: 'Junk' }
      ],
      postApplyMessage: 'Junk fields applied'
    },
    cancel: {
      buttonLabel: 'Closed/Cancelled…',
      draftLabel: 'Copy Cancel Draft',
      confirmationTitle: 'Confirm Closed/Cancelled triage',
      fieldSummary: 'Close/cancel the ticket and mark Ticket Tier? as N/A - Cancelled Ticket.',
      mutations: [
        { field: 'status', value: '>Closed/Cancelled' },
        { field: 'tier', value: 'N/A - Cancelled Ticket' }
      ],
      postApplyMessage: 'Closed/Cancelled fields applied'
    }
  };

  async function until(fn, { tries = 60, delay = 60 } = {}) {
    for (let i = 0; i < tries; i++) {
      const value = fn();
      if (value) return value;
      await sleep(delay);
    }
    return null;
  }

  function toast(message, ms = 1400) {
    const node = document.createElement('div');
    node.textContent = message;
    Object.assign(node.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      zIndex: 2147483646,
      background: '#111827',
      color: '#fff',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,.25)',
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif'
    });
    document.body.appendChild(node);
    setTimeout(() => node.remove(), ms);
  }

  function openChevronFor(input) {
    const wrapper = input?.closest('div, td, .pod-element-row') || input?.parentElement;
    const chevron = wrapper?.querySelector('.GMDB3DUBHWH, .k-select, .k-input-button, button[aria-haspopup="listbox"]');
    if (visible(chevron)) {
      chevron.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      chevron.click();
      chevron.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    }

    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    return true;
  }

  async function openPopupAndGetContainer(input) {
    const popupSelectors = [
      '.GMDB3DUBPDJ.GMDB3DUBGFJ',
      '.k-animation-container',
      '.k-popup',
      '.select2-container--open',
      '[data-popup-open="true"]',
      '.x-layer',
      '.x-menu-floating',
      '.x-combo-list'
    ];
    const before = new Set(popupSelectors.flatMap(selector => $$(selector)).filter(visible));

    openChevronFor(input);
    await sleep(35);

    return await until(() => {
      const after = popupSelectors.flatMap(selector => $$(selector)).filter(visible);
      return after.find(el => !before.has(el)) || after.slice(-1)[0] || null;
    }, { tries: 12, delay: 35 });
  }

  function findClickableOption(container, desiredValue) {
    if (!container) return null;
    const target = norm(desiredValue);
    const candidates = [
      ...$$('[role="option"]', container),
      ...$$('.k-list-item, .k-item, .select2-results__option, li', container),
      ...$$('div, span', container)
    ].filter(el => visible(el) && (el.textContent || '').trim());

    return candidates.find(el => norm(el.textContent) === target)
      || candidates.find(el => norm(el.textContent).startsWith(target))
      || candidates.find(el => norm(el.textContent).includes(target))
      || null;
  }

  async function clickEl(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await sleep(22);
  }

  function dispatchInput(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
  }

  function commitBlur(input) {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.blur();
  }


  function dispatchAll(input) {
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setDomInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, value);
    else input.value = value;
    dispatchAll(input);
  }

  const CONTACT_CLEAR_GROUPS = [
    {
      label: 'Contact',
      selectors: [
        'input.cw_contact',
        'input[aria-label="Contact"]',
        'input[id*="Contact"][role="combobox"]',
        'input[name="ContactRecID"]'
      ]
    },
    {
      label: 'Email',
      selectors: [
        'input.cw_emailAddress',
        'input[aria-label="Email"]',
        'input[name="EmailAddress"]'
      ]
    },
    {
      label: 'Phone / Extension',
      selectors: [
        'input[aria-label="Phone"]',
        'input[name="PhoneNumber"]',
        'input[aria-label*="Ext"]',
        'input[name*="Ext"]'
      ],
      roots: ['.cw_contactPhoneCommunications'],
      rootInputSelector: 'input'
    }
  ];

  const contactSnapshotsByTicket = new Map();

  function describeInput(input) {
    return input.getAttribute('aria-label')
      || input.getAttribute('name')
      || input.id
      || input.className
      || input.type
      || 'input';
  }

  function getContactClearInputs() {
    const seen = new Set();
    const entries = [];

    const addInput = (input, groupLabel) => {
      if (!input || !('value' in input) || seen.has(input)) return;
      seen.add(input);
      entries.push({ input, groupLabel, label: `${groupLabel} (${describeInput(input)})` });
    };

    for (const group of CONTACT_CLEAR_GROUPS) {
      for (const selector of group.selectors || []) {
        $$(selector).forEach(input => addInput(input, group.label));
      }
      for (const rootSelector of group.roots || []) {
        $$(rootSelector).forEach(root => {
          $$(group.rootInputSelector || 'input', root).forEach(input => addInput(input, group.label));
        });
      }
    }

    return entries;
  }

  function snapshotContactInfo(entries = getContactClearInputs()) {
    const ticketId = getTicketId();
    const snapshot = {
      ticketId,
      createdAt: Date.now(),
      entries: entries.map(entry => ({
        ...entry,
        value: String(entry.input.value || ''),
        found: true
      }))
    };

    if (ticketId) contactSnapshotsByTicket.set(ticketId, snapshot);
    return snapshot;
  }

  function buildContactClearPlan(entries = getContactClearInputs()) {
    return entries.map(entry => ({
      ...entry,
      found: true,
      currentValue: String(entry.input.value || ''),
      value: '(blank)'
    }));
  }

  function clearContactInfo(snapshot = snapshotContactInfo()) {
    let didSomething = false;

    for (const entry of snapshot.entries || []) {
      const input = entry.input;
      if (!input || !('value' in input)) continue;
      if (String(input.value || '') !== '') didSomething = true;
      setDomInputValue(input, '');
    }

    if (!didSomething) toast('Contact, email, and phone fields were already blank');
    return didSomething;
  }

  async function revertContactInfo(snapshot) {
    const activeTicketId = getTicketId();
    const savedSnapshot = snapshot || (activeTicketId ? contactSnapshotsByTicket.get(activeTicketId) : null);
    if (!savedSnapshot) {
      toast('No captured contact values found for this ticket');
      return false;
    }
    if (activeTicketId && savedSnapshot.ticketId && savedSnapshot.ticketId !== activeTicketId) {
      toast('Contact revert stopped: active ticket changed');
      return false;
    }

    for (const entry of savedSnapshot.entries || []) {
      const input = entry.input;
      if (!input || !('value' in input) || !input.isConnected) {
        toast(`${entry.label || entry.groupLabel || 'Contact field'} not found for revert`);
        return false;
      }
      setDomInputValue(input, entry.value || '');
      await sleep(20);
    }
    return true;
  }

  function showPostClearContactDialog(plan, snapshot) {
    showActionDialog('Contact fields cleared', {
      message: 'Contact, email, phone, and extension fields were cleared in the visible ConnectWise UI only. The changes are not saved unless you choose Save or Save & Close.',
      fields: plan,
      actions: [
        {
          label: 'Revert',
          primary: true,
          onClick: async () => {
            const ok = await revertContactInfo(snapshot);
            toast(ok ? 'Contact values reverted' : 'Contact revert stopped');
          }
        },
        { label: 'Leave Unsaved', onClick: () => toast('Cleared values left unsaved') },
        {
          label: 'Save',
          onClick: async () => {
            await sleep(120);
            if (!clickSave()) toast('Save button not found');
          }
        },
        {
          label: 'Save & Close',
          onClick: async () => {
            await sleep(120);
            if (!clickSaveAndClose()) toast('Save & Close button not found');
          }
        }
      ]
    });
  }

  function confirmAndClearContactInfo() {
    const entries = getContactClearInputs();
    if (!entries.length) {
      toast('No contact fields found to clear');
      return false;
    }

    const plan = buildContactClearPlan(entries);
    showActionDialog('Confirm Clear Contact', {
      message: 'This clears only visible ConnectWise contact, email, phone, and extension fields through DOM events. No ConnectWise or ITGlue APIs are called, and nothing is saved until you use ConnectWise Save controls.',
      fields: plan,
      actions: [
        { label: 'Cancel', onClick: () => toast('Clear Contact cancelled') },
        {
          label: 'Clear Contact',
          primary: true,
          onClick: () => {
            const snapshot = snapshotContactInfo(entries);
            clearContactInfo(snapshot);
            toast('Contact fields cleared');
            showPostClearContactDialog(plan, snapshot);
          }
        }
      ]
    });
    return true;
  }

  async function commitComboOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (norm(input.value) === norm(desiredValue)) return true;

    const popup = await openPopupAndGetContainer(input);
    const option = popup && findClickableOption(popup, desiredValue);
    if (option) {
      await clickEl(option);
      commitBlur(input);
      await sleep(60);
      return norm(input.value) === norm(desiredValue);
    }

    input.focus();
    dispatchInput(input, '');
    dispatchInput(input, String(desiredValue));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    if (norm(input.value) === norm(desiredValue)) return true;

    await openPopupAndGetContainer(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    await sleep(45);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    commitBlur(input);
    await sleep(80);
    return norm(input.value) === norm(desiredValue);
  }

  async function commitTextOnElement(input, desiredValue) {
    if (!input || input.disabled || input.readOnly || !visible(input)) return false;
    if (String(input.value || '') === String(desiredValue)) return true;

    input.focus();
    dispatchInput(input, String(desiredValue));
    commitBlur(input);
    await sleep(60);
    return String(input.value || '') === String(desiredValue);
  }

  function labelText(el) {
    return norm((el?.textContent || '').replace(/[:?]\s*$/, ''));
  }

  function findUdfInputByLabel(labelTextToFind) {
    const needle = norm(String(labelTextToFind).replace(/[:?]\s*$/, ''));
    const rows = $$('.pod-element-row').filter(visible);

    for (const row of rows) {
      const label = $('.mm_label, .cw_CwLabel, [id$="-label"], label, .gwt-Label', row);
      const text = labelText(label);
      if (text && text === needle) {
        const input = row.querySelector('input.cw_PsaUserDefinedComboBox, input.GMDB3DUBKVH, input:not([type="hidden"]), textarea');
        if (visible(input)) return input;
      }
    }

    return null;
  }

  function findInputByLabel(labelTextToFind) {
    const needle = norm(String(labelTextToFind).replace(/[:?]\s*$/, ''));
    const rows = $$('.pod-element-row, tr, .cw_CwFormRow, .form-group, .x-form-item, .GMDB3DUBHGH');

    for (const row of rows) {
      if (!visible(row)) continue;
      const label = $('.mm_label, .cw_CwLabel, label, [id$="-label"], .gwt-Label', row);
      if (labelText(label) === needle) {
        const input = $('input:not([type="hidden"]), textarea', row);
        if (visible(input)) return input;
      }
    }

    const labels = $$('.mm_label, .cw_CwLabel, label, [id$="-label"], .gwt-Label').filter(visible);
    for (const label of labels) {
      if (labelText(label) !== needle) continue;
      const row = label.closest('.pod-element-row, tr, .cw_CwFormRow, .form-group, .x-form-item, .GMDB3DUBHGH') || label.parentElement;
      const input = row && $('input:not([type="hidden"]), textarea', row);
      if (visible(input)) return input;
    }

    return null;
  }

  function findInputBySelectors(selectors) {
    for (const selector of selectors) {
      const input = $(selector);
      if (visible(input)) return input;
    }
    return null;
  }

  function findSummaryInput() {
    return findInputBySelectors([
      'input.cw_summary',
      'input[name*="summary" i]',
      'textarea[name*="summary" i]'
    ]) || findInputByLabel('Summary');
  }

  function findContactName() {
    const input = findInputBySelectors(['input.cw_contactName', 'input.cw_contact', 'input[name*="contact" i]']) || findInputByLabel('Contact');
    return (input?.value || '').trim();
  }

  function getTicketIdFromHeader() {
    const header = $('.pod_service_ticket_ticket_header, .mm_podHeader.pod_service_ticket_ticket_header');
    if (!header || !visible(header)) return '';

    const label = document.getElementById(`${header.id}-label`) || header.nextElementSibling || header;
    const scanNodes = [label, header, header.parentElement, header.parentElement?.nextElementSibling].filter(Boolean);
    for (const node of scanNodes) {
      const match = String(node.textContent || '').match(/\b(?:service\s+)?ticket\s*#\s*(\d{3,})\b/i);
      if (match) return match[1];
    }
    return '';
  }

  function getTicketIdFromUrl() {
    try {
      const url = new URL(location.href);
      const params = url.searchParams;
      const id = params.get('service_recid') || params.get('srRecID') || params.get('serviceTicketId') || params.get('recid');
      if (id && /^\d{3,}$/.test(id)) return id;

      const match = url.pathname.match(/(?:^|\/)(?:ticket|tickets|sr|service[_-]?ticket)s?\/(\d{3,})/i);
      return match ? match[1] : '';
    } catch {
      return '';
    }
  }

  function getTicketId() {
    return getTicketIdFromHeader() || getTicketIdFromUrl();
  }

  const TRIAGE_FIELD_RESOLVERS = {
    board: { label: 'Board', type: 'combo', find: () => findInputBySelectors(['input.cw_serviceBoard']) || findInputByLabel('Board') },
    status: { label: 'Status', type: 'combo', find: () => findInputBySelectors(['input.cw_status']) || findInputByLabel('Status') },
    type: { label: 'Type', type: 'combo', find: () => findInputBySelectors(['input.cw_type']) || findInputByLabel('Type') },
    subtype: { label: 'Subtype', type: 'combo', find: () => findInputBySelectors(['input.cw_subType']) || findInputByLabel('Sub-Type') || findInputByLabel('Subtype') },
    tier: { label: 'Ticket Tier?', type: 'combo', find: () => findUdfInputByLabel('Ticket Tier?') || findInputByLabel('Ticket Tier?') || findInputByLabel('Item/Tier') },
    priority: { label: 'Priority', type: 'combo', find: () => findInputBySelectors(['input.cw_priority']) || findInputByLabel('Priority') },
    summary: { label: 'Summary', type: 'text', find: findSummaryInput }
  };

  function getTriageWorkflow(kind) {
    const key = norm(kind || '').replace(/[^a-z]/g, '');
    if (key === 'closedcancelled' || key === 'closed' || key === 'cancelled') return TRIAGE_WORKFLOWS.cancel;
    if (key === 'spamphishing' || key === 'phishing') return TRIAGE_WORKFLOWS.spam;
    return TRIAGE_WORKFLOWS[key] || null;
  }

  function getTriageMode() {
    try {
      const saved = localStorage.getItem(TRIAGE_MODE_STORAGE_KEY);
      return TRIAGE_MODES.has(saved) ? saved : DEFAULT_TRIAGE_MODE;
    } catch {
      return DEFAULT_TRIAGE_MODE;
    }
  }

  function setTriageMode(mode) {
    const normalizedMode = TRIAGE_MODES.has(mode) ? mode : DEFAULT_TRIAGE_MODE;
    try {
      localStorage.setItem(TRIAGE_MODE_STORAGE_KEY, normalizedMode);
    } catch {}
    updateTriageButtons();
    return normalizedMode;
  }

  function isDraftOnlyMode() {
    return false;
  }

  function getTriageButtonLabel(workflow) {
    return workflow.buttonLabel;
  }

  function getTriageButtonTooltip() {
    return TRIAGE_APPLY_TOOLTIP;
  }

  function handleTriageButton(kind) {
    return confirmAndApplyTriage(kind);
  }

  function resolveMutationValue(workflow, mutation) {
    if (mutation.valueFrom === 'summaryTemplate') {
      return workflow.summaryTemplate?.({ contact: findContactName() }) || '';
    }
    return typeof mutation.value === 'function' ? mutation.value() : mutation.value;
  }

  function buildFieldPlan(workflow) {
    return workflow.mutations.map(mutation => {
      const field = TRIAGE_FIELD_RESOLVERS[mutation.field];
      const input = field?.find?.() || null;
      const value = resolveMutationValue(workflow, mutation);
      return {
        ...field,
        ...mutation,
        label: mutation.label || field?.label || mutation.field,
        type: mutation.type || field?.type || 'combo',
        input,
        value,
        currentValue: input ? (input.value || '').trim() : '',
        found: !!input
      };
    });
  }

  function describePlan(plan) {
    return plan.map(item => `${item.label}: ${item.currentValue || '(blank)'} → ${item.value}`).join('\n');
  }

  const fieldSnapshotsByTicket = new Map();

  function uniqueWorkflowMutations(workflow) {
    const seen = new Set();
    return (workflow?.mutations || []).filter(mutation => {
      const fieldKey = mutation.field;
      if (seen.has(fieldKey)) return false;
      seen.add(fieldKey);
      return true;
    });
  }

  function snapshotFields(workflow) {
    const ticketId = getTicketId();
    if (!ticketId) {
      toast('Ticket # not found; fields were not changed');
      return null;
    }

    const snapshot = {
      ticketId,
      workflow: workflow?.buttonLabel || '',
      createdAt: Date.now(),
      fields: {},
      entries: []
    };

    for (const mutation of uniqueWorkflowMutations(workflow)) {
      const resolver = TRIAGE_FIELD_RESOLVERS[mutation.field];
      const label = mutation.label || resolver?.label || mutation.field;
      const input = resolver?.find?.() || null;
      const entry = {
        field: mutation.field,
        label,
        type: mutation.type || resolver?.type || 'combo',
        value: input ? (input.value || '').trim() : '',
        found: !!input
      };
      snapshot.fields[label] = entry;
      snapshot.entries.push(entry);
    }

    fieldSnapshotsByTicket.set(ticketId, snapshot);
    return snapshot;
  }

  async function copyText(text) {
    try {
      if (window.GM?.setClipboard) {
        await window.GM.setClipboard(text, 'text');
        return true;
      }
    } catch {}
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    return false;
  }

  async function copyTriage(kind) {
    const workflow = getTriageWorkflow(kind);
    if (!workflow) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(workflow);
    const draft = [workflow.fieldSummary, '', 'Fields:', describePlan(plan)].join('\n');
    const ok = await copyText(draft);
    toast(ok ? `${workflow.draftLabel || workflow.buttonLabel} copied` : 'Could not copy draft');
    return ok;
  }

  async function applyFieldChanges(workflow, ticketInfo = {}) {
    const snapshot = snapshotFields(workflow);
    if (!snapshot) return { ok: false, snapshot: null, plan: [] };

    if (ticketInfo && typeof ticketInfo === 'object') {
      ticketInfo.ticketId = snapshot.ticketId;
      ticketInfo.snapshot = snapshot;
    }

    const plan = buildFieldPlan(workflow);
    for (const item of plan) {
      const input = item.input || item.find?.();
      if (!input) {
        toast(`${item.label} field not found`);
        return { ok: false, snapshot, plan };
      }
      const ok = item.type === 'text'
        ? await commitTextOnElement(input, item.value)
        : await commitComboOnElement(input, item.value);
      if (!ok) {
        toast(`Could not set ${item.label}`);
        return { ok: false, snapshot, plan };
      }
    }
    return { ok: true, snapshot, plan };
  }

  function clickLikeUser(el) {
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.click();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    return true;
  }

  function findToolbarButton(cls) {
    const el = $('.' + cls);
    return visible(el) ? el : null;
  }

  function clickSave() {
    return clickLikeUser(findToolbarButton('cw_ToolbarButton_Save'));
  }

  function clickSaveAndClose() {
    return clickLikeUser(findToolbarButton('cw_ToolbarButton_SaveAndClose'));
  }

  async function clearField(input) {
    input.focus();
    dispatchInput(input, '');
    commitBlur(input);
    await sleep(60);
    return String(input.value || '') === '';
  }

  async function revertFieldChanges(snapshot) {
    const activeTicketId = getTicketId();
    const savedSnapshot = snapshot || (activeTicketId ? fieldSnapshotsByTicket.get(activeTicketId) : null);
    if (!savedSnapshot) {
      toast('No captured field values found for this ticket');
      return false;
    }
    if (activeTicketId && savedSnapshot.ticketId !== activeTicketId) {
      toast('Revert stopped: active ticket changed');
      return false;
    }

    for (const item of savedSnapshot.entries || []) {
      const resolver = TRIAGE_FIELD_RESOLVERS[item.field];
      const input = resolver?.find?.() || null;
      if (!input) {
        toast(`${item.label} field not found for revert`);
        return false;
      }

      const previousValue = item.value || '';
      const ok = previousValue
        ? (item.type === 'text'
          ? await commitTextOnElement(input, previousValue)
          : await commitComboOnElement(input, previousValue))
        : await clearField(input);
      if (!ok) {
        toast(`Could not revert ${item.label}`);
        return false;
      }
    }
    return true;
  }

  function showPostApplyDialog(workflow, plan, snapshot) {
    showActionDialog(workflow.postApplyMessage || `${workflow.buttonLabel} fields applied`, {
      message: 'The requested fields have been changed in the browser UI only. They are not saved in ConnectWise until you choose Save or Save & Close here; otherwise you can leave them unsaved or revert them.',
      fields: plan,
      actions: [
        {
          label: 'Revert',
          onClick: async () => {
            const ok = await revertFieldChanges(snapshot);
            toast(ok ? 'Triage changes reverted' : 'Triage revert stopped');
          }
        },
        { label: 'Leave Unsaved', onClick: () => toast('Changes left unsaved') },
        {
          label: 'Save',
          primary: true,
          onClick: async () => {
            await sleep(120);
            if (!clickSave()) toast('Save button not found');
          }
        },
        {
          label: 'Save & Close',
          onClick: async () => {
            await sleep(120);
            if (!clickSaveAndClose()) toast('Save & Close button not found');
          }
        }
      ]
    });
  }

  function showActionDialog(title, { message, fields = [], actions = [] }) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.38)',
      zIndex: 2147483645,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff',
      borderRadius: '12px',
      minWidth: '420px',
      maxWidth: '680px',
      padding: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      color: '#111827'
    });

    const heading = document.createElement('div');
    heading.textContent = title;
    Object.assign(heading.style, { fontSize: '16px', fontWeight: 700, marginBottom: '8px' });

    const intro = document.createElement('p');
    intro.textContent = message || '';
    Object.assign(intro.style, { margin: '0 0 10px', lineHeight: 1.4, color: '#374151' });

    const list = document.createElement('ul');
    Object.assign(list.style, { margin: '0 0 14px 20px', padding: 0, lineHeight: 1.5 });
    for (const field of fields) {
      const item = document.createElement('li');
      item.textContent = field.found
        ? `${field.label}: ${field.currentValue || '(blank)'} → ${field.value}`
        : `${field.label}: field not found; intended value → ${field.value}`;
      list.appendChild(item);
    }

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

    function makeButton(label, action, primary = false) {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, {
        borderRadius: '10px',
        padding: '8px 12px',
        cursor: 'pointer',
        border: '1px solid',
        fontWeight: 600,
        background: primary ? '#111827' : '#fff',
        color: primary ? '#fff' : '#111827',
        borderColor: primary ? '#111827' : '#D1D5DB'
      });
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await action?.();
        } finally {
          overlay.remove();
        }
      });
      return button;
    }

    actions.forEach(action => row.appendChild(makeButton(action.label, action.onClick, action.primary)));
    card.append(heading, intro, list, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function confirmAndApplyTriage(kind) {
    const workflow = getTriageWorkflow(kind);
    if (!workflow) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(workflow);
    showActionDialog(workflow.confirmationTitle, {
      message: `${workflow.fieldSummary} No ConnectWise fields will change until you choose Apply Fields. This uses only visible UI/DOM automation; Copy Draft only copies this field plan to the clipboard.`,
      fields: plan,
      actions: [
        { label: 'Cancel', onClick: () => toast('Triage cancelled') },
        { label: workflow.draftLabel || 'Copy Draft', onClick: () => copyTriage(kind) },
        {
          label: 'Apply Fields',
          primary: true,
          onClick: async () => {
            const ticketInfo = {};
            const result = await applyFieldChanges(workflow, ticketInfo);
            if (result.ok) {
              toast(workflow.postApplyMessage || `${workflow.buttonLabel} fields applied`);
              showPostApplyDialog(workflow, result.plan, result.snapshot);
            } else {
              toast(`${workflow.buttonLabel} apply stopped`);
            }
          }
        }
      ]
    });
    return true;
  }

  function isProjectTicket() {
    const textIncludes = (selector, needle) => $$(selector).some(el => visible(el) && norm(el.textContent).includes(norm(needle)));
    return textIncludes('.navigationEntry.cw_CwLabel, .mm_label, .gwt-Label', 'Project Board')
      || visible($('input.cw_projectBoard'))
      || visible($('.cw_project'));
  }

  function findTicketPodRoot() {
    return $('.pod_service_ticket_ticket')
      || $('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBLGH')
      || null;
  }

  function findHeaderBlock(podRoot) {
    return podRoot?.querySelector('.pod_service_ticket_ticket_header')?.closest('.GMDB3DUBHGH') || null;
  }

  function makeActionButton(id, text, title, handler) {
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = id;
    outer.dataset.origin = 'attentus';
    outer.title = title;
    Object.assign(outer.style, { display: 'inline-block', verticalAlign: 'middle', whiteSpace: 'nowrap' });

    const button = document.createElement('div');
    button.className = 'GMDB3DUBIOG mm_button';
    button.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = text;

    inner.appendChild(label);
    button.appendChild(inner);
    outer.appendChild(button);

    const act = (event) => {
      event.preventDefault();
      handler(event);
    };
    outer.addEventListener('click', act);
    outer.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') act(event);
    });
    return outer;
  }

  function updateTriageButtons() {
    const buttons = [
      ['att-cw-helpdesk-spam-btn', TRIAGE_WORKFLOWS.spam],
      ['att-cw-helpdesk-junk-btn', TRIAGE_WORKFLOWS.junk],
      ['att-cw-helpdesk-cancel-btn', TRIAGE_WORKFLOWS.cancel]
    ];

    for (const [id, workflow] of buttons) {
      const button = document.getElementById(id);
      if (!button) continue;
      const label = $('.GMDB3DUBBPG', button);
      if (label) label.textContent = getTriageButtonLabel(workflow);
      button.title = getTriageButtonTooltip();
    }
  }

  function showToolkitSettingsDialog() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,.38)',
      zIndex: 2147483645,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
      background: '#fff',
      borderRadius: '12px',
      minWidth: '420px',
      maxWidth: '620px',
      padding: '16px',
      boxShadow: '0 10px 30px rgba(0,0,0,.25)',
      font: '14px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      color: '#111827'
    });

    const heading = document.createElement('div');
    heading.textContent = 'Helpdesk Toolkit Settings';
    Object.assign(heading.style, { fontSize: '16px', fontWeight: 700, marginBottom: '8px' });

    const intro = document.createElement('p');
    intro.textContent = `Triage mode is stored locally as ${TRIAGE_MODE_STORAGE_KEY}. API access remains read-only; confirm/apply mode changes only visible ConnectWise UI fields after confirmation.`;
    Object.assign(intro.style, { margin: '0 0 12px', lineHeight: 1.4, color: '#374151' });

    const form = document.createElement('div');
    Object.assign(form.style, { display: 'grid', gap: '10px', marginBottom: '14px' });

    const currentMode = getTriageMode();
    const options = [
      {
        value: 'confirmApply',
        title: 'Confirm and apply',
        description: 'Triage buttons open the confirmation modal, then apply fields through the visible UI only. Save and Save & Close appear only after fields are applied.'
      }
    ];

    for (const option of options) {
      const label = document.createElement('label');
      Object.assign(label.style, {
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '8px',
        alignItems: 'start',
        padding: '10px',
        border: '1px solid #D1D5DB',
        borderRadius: '10px',
        cursor: 'pointer'
      });

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'att-cw-triage-mode';
      input.value = option.value;
      input.checked = currentMode === option.value;

      const text = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = option.title;
      const description = document.createElement('span');
      description.textContent = option.description;
      Object.assign(description.style, { display: 'block', color: '#4B5563', marginTop: '2px' });
      text.append(title, description);

      label.append(input, text);
      form.appendChild(label);
    }

    const row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' });

    function makeButton(label, action, primary = false) {
      const button = document.createElement('button');
      button.textContent = label;
      Object.assign(button.style, {
        borderRadius: '10px',
        padding: '8px 12px',
        cursor: 'pointer',
        border: '1px solid',
        fontWeight: 600,
        background: primary ? '#111827' : '#fff',
        color: primary ? '#fff' : '#111827',
        borderColor: primary ? '#111827' : '#D1D5DB'
      });
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await action?.();
        } finally {
          overlay.remove();
        }
      });
      return button;
    }

    row.append(
      makeButton('Cancel', () => {}),
      makeButton('Save Settings', () => {
        const selected = $('input[name="att-cw-triage-mode"]:checked', form)?.value || DEFAULT_TRIAGE_MODE;
        const saved = setTriageMode(selected);
        toast(`Triage mode set to ${saved}`);
      }, true)
    );

    card.append(heading, intro, form, row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function mountTicketTools() {
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
      marginLeft: '8px'
    });

    const label = document.createElement('span');
    label.textContent = 'Helpdesk Toolkit:';
    Object.assign(label.style, {
      font: '12px system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
      fontWeight: 600,
      color: '#374151',
      userSelect: 'none'
    });

    const slot = document.createElement('div');
    slot.id = SLOT_ID;
    Object.assign(slot.style, { display: 'inline-flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' });
    slot.append(
      makeActionButton('att-cw-helpdesk-spam-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.spam), getTriageButtonTooltip(), () => handleTriageButton('spam')),
      makeActionButton('att-cw-helpdesk-junk-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.junk), getTriageButtonTooltip(), () => handleTriageButton('junk')),
      makeActionButton('att-cw-helpdesk-cancel-btn', getTriageButtonLabel(TRIAGE_WORKFLOWS.cancel), getTriageButtonTooltip(), () => handleTriageButton('cancel')),
      makeActionButton('att-cw-helpdesk-clear-contact-btn', 'Clear Contact', 'Clear visible contact, email, phone, and extension fields after confirmation. Does not call ConnectWise or ITGlue APIs.', () => confirmAndClearContactInfo()),
      makeActionButton('att-cw-helpdesk-settings-btn', 'Settings…', `Configure ${TRIAGE_MODE_STORAGE_KEY}`, () => showToolkitSettingsDialog())
    );

    bar.append(label, slot);
    return bar;
  }

  function ensureBarPlaced() {
    if (isProjectTicket()) {
      $(`#${BAR_ID}`)?.remove();
      return false;
    }

    if ($(`#${SLOT_ID}`)) return true;
    const pod = findTicketPodRoot();
    const header = pod && findHeaderBlock(pod);
    if (!header) return false;
    header.insertAdjacentElement('afterend', mountTicketTools());
    return true;
  }

  window.attentusHelpdeskToolkit = {
    copyTriage,
    confirmAndApplyTriage,
    getTriageMode,
    setTriageMode,
    showToolkitSettingsDialog,
    mountTicketTools,
    handleTriageButton,
    snapshotFields,
    applyFieldChanges,
    revertFieldChanges,
    clearContactInfo,
    confirmAndClearContactInfo,
    revertContactInfo,
    snapshotContactInfo,
    getTicketId,
    commitComboOnElement,
    openPopupAndGetContainer,
    findInputByLabel,
    showActionDialog
  };

  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (lastHref !== location.href) {
      lastHref = location.href;
      $(`#${BAR_ID}`)?.remove();
    }
    ensureBarPlaced();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach(key => {
    const original = history[key];
    history[key] = function () {
      const result = original.apply(this, arguments);
      queueMicrotask(ensureBarPlaced);
      return result;
    };
  });

  window.addEventListener('popstate', ensureBarPlaced);
  ensureBarPlaced();
  setTimeout(ensureBarPlaced, 200);
  setTimeout(ensureBarPlaced, 700);

  // Board shoutout module: DOM/clipboard-only Teams shoutout tooling ported from attentus-cw-teams-shoutout.
  (function boardShoutoutModule() {
    'use strict';

    var BTN_ID = 'att-cw-teams-shoutout-btn';
    var TOAST_ID = 'att-cw-teams-shoutout-toast';
    var PANEL_ID = 'att-cw-teams-shoutout-setup';
    var STORAGE = 'att_cw_shoutout_settings_exact_views_json';
    var BOARD_ROW = 'table.srboard-grid tr.cw-ml-row';

    var BASE = location.origin;
    var PATH = '/v4_6_release/services/system_io/Service/fv_sr100_request.rails?service_recid=';

    // status ordering for bullets
    var STATUS_ORDER = [
      'New',
      'New (email)',
      'MUST ASSIGN',
      'MUST ASSIGN - Acknowledged',
      'Re-Opened',
      'Client Has Responded',
      'Waiting Approval',
      'Waiting Client Response',
      'On-Hold',
      'Acknowledged'
    ];

    // priority ordering for output
    var PRIORITY_ORDER = ['P0','P1','P2','P3','P4','PM']; // PM = Maintenance

    // Maintenance icon data URI (cyan)
    var MAINT_DATA_PREFIX = 'data:image/gif;base64,R0lGODlhEAAQAJECAAAAAAD49P///wAAACH5BAEAAAIALAAAAAAQABAAAAImlI+pm+APoQGh2lvBxDxoQXXXF4rZZp5gqpYmyXpoSka2w+T6vhcAOw==';

    // ---------- utils
    function txt(el){ return (el && el.textContent || '').replace(/\s+/g,' ').trim(); }
    function isTicketId(s){ return /^\d{5,}$/.test((s||'').trim()); }
    function esc(s){
      s = String(s == null ? '' : s);
      return s.replace(/&/g,'&amp;')
              .replace(/</g,'&lt;')
              .replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;')
              .replace(/'/g,'&#39;');
    }
    function stripSLA(s){
      s = String(s||'');
      s = s.replace(/\b(?:Respond by|Plan by|Waiting|Scheduled|SLA)[^|-\u2014]*$/i,'');
      s = s.replace(/[|\u2014-]\s*$/,'');
      return s.trim();
    }

    function toast(msg, ms){
      if(ms == null) ms = 1100;
      var n = document.getElementById(TOAST_ID);
      if(!n){
        n = document.createElement('div');
        n.id = TOAST_ID;
        var st = n.style;
        st.position='fixed';
        st.right='16px';
        st.bottom='70px';
        st.zIndex=2147483646;
        st.background='#0b0f17';
        st.color='#e5e7eb';
        st.padding='8px 10px';
        st.borderRadius='10px';
        st.border='1px solid #1f2937';
        st.font='12px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
        st.opacity='0';
        st.transition='opacity .15s ease';
        document.body.appendChild(n);
      }
      n.textContent = msg;
      n.style.opacity = '1';
      if(n._h) clearTimeout(n._h);
      n._h = setTimeout(function(){ n.style.opacity = '0'; }, ms);
    }

    // ---------- storage
    function gmGet(key, def){
      if(typeof def === 'undefined') def = null;
      try{
        if(typeof GM_getValue === 'function'){
          var v = GM_getValue(key, def);
          return Promise.resolve(v);
        }
        if(typeof GM !== 'undefined' && typeof GM.getValue === 'function'){
          return GM.getValue(key, def);
        }
      }catch(e){}
      return Promise.resolve(def);
    }
    function gmSet(key, val){
      try{
        if(typeof GM_setValue === 'function'){
          GM_setValue(key, val);
          return Promise.resolve();
        }
        if(typeof GM !== 'undefined' && typeof GM.setValue === 'function'){
          return GM.setValue(key, val);
        }
      }catch(e){}
      try{ localStorage.setItem(key, val); }catch(e){}
      return Promise.resolve();
    }
    function getSettings(){
      return gmGet(STORAGE, '{}').then(function(raw){
        try{
          return typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
        }catch(e){
          return {};
        }
      });
    }
    function setSettings(obj){
      var str = JSON.stringify(obj || {});
      return gmSet(STORAGE, str);
    }

    // ---------- view keys
    function ticketUrl(id){ return BASE + PATH + encodeURIComponent(id); }
    function getViewInput(){
      return document.querySelector('.cw-toolbar-view-dropdown input.cw_CwComboBox') ||
             document.querySelector('.cw-toolbar-view-dropdown [id$="-input"].cw_CwComboBox');
    }
    function stripInvisibles(s){
      return String(s||'')
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g,'')
        .replace(/\u00A0/g,' ')
        .replace(/\s+/g,' ')
        .trim();
    }
    function readViewExact(){
      var inp = getViewInput();
      var val = inp && typeof inp.value === 'string' ? inp.value.trim() : '';
      return val || '(No View)';
    }
    function readViewCanonical(){ return stripInvisibles(readViewExact()); }
    function keyExact(){ return location.host.toLowerCase() + '::' + readViewExact(); }
    function keyCanonical(){ return location.host.toLowerCase() + '::' + readViewCanonical(); }

    // ---------- gating
    function isBoard(){
      return !!document.querySelector('table.srboard-grid') &&
             !!document.querySelector(BOARD_ROW) &&
             !!getViewInput();
    }

    // ---------- grid helpers
    function rows(){
      return Array.prototype.slice.call(document.querySelectorAll(BOARD_ROW));
    }
    function tdByIndex(row, idx){
      return idx >= 0 ? row.querySelector('td[cellindex="' + idx + '"]') : null;
    }
    function valFromCell(row, idx){
      var td = tdByIndex(row, idx);
      if(!td) return '';
      var a = td.querySelector('a');
      return a ? txt(a) : txt(td.querySelector('div') || td);
    }

    function headerCells(){
      var set = new Map();
      var containers = Array.prototype.slice.call(document.querySelectorAll(
        '.cw-ml-header *[cellindex], .x-grid3-hd-row *[cellindex], .x-grid3-header *[cellindex]'
      ));
      for(var i=0;i<containers.length;i++){
        var c = containers[i];
        var idx = c.getAttribute('cellindex');
        if(!idx) continue;
        var label = (txt(c) ||
                     txt(c.querySelector('.gwt-InlineHTML')) ||
                     txt(c.querySelector('.x-grid3-hd-inner'))).toLowerCase();
        if(label) set.set(+idx, label);
      }
      return set;
    }
    function sampleRowCells(){
      var r = rows()[0];
      if(!r) return new Map();
      var map = new Map();
      var tds = r.querySelectorAll('td[cellindex]');
      for(var i=0;i<tds.length;i++){
        var td = tds[i];
        var idx = +td.getAttribute('cellindex');
        var a = td.querySelector('a');
        var v = a ? txt(a) : txt(td.querySelector('div') || td);
        map.set(idx, v);
      }
      return map;
    }

    // Ticket column detection (only for smart prefill)
    function detectTicketIndex(){
      var headers = headerCells();
      var found = null;
      headers.forEach(function(label, idx){
        if(/ticket/.test(label)){
          if(found == null) found = idx;
        }
      });
      if(found != null) return found;

      var rws = rows();
      var counts = {};
      var limit = Math.min(rws.length, 8);
      for(var i=0;i<limit;i++){
        var r = rws[i];
        var tds = r.querySelectorAll('td[cellindex]');
        for(var j=0;j<tds.length;j++){
          var td = tds[j];
          var a = td.querySelector('a');
          if(a){
            var id = txt(a);
            if(/^\d{5,}$/.test(id)){
              var idx = +td.getAttribute('cellindex');
              counts[idx] = (counts[idx] || 0) + 1;
            }
          }
        }
      }
      var bestIdx = null, bestCnt = 0;
      for(var k in counts){
        if(counts.hasOwnProperty(k)){
          if(counts[k] > bestCnt){
            bestCnt = counts[k];
            bestIdx = +k;
          }
        }
      }
      if(bestCnt >= 2) return bestIdx;
      return null;
    }

    // Status column detection (fallback)
    function detectStatusIndex(){
      var headers = headerCells();
      var found = null;
      headers.forEach(function(label, idx){
        if(/status/.test(label)){
          if(found == null) found = idx;
        }
      });
      return found;
    }

    // Resource column detection (fallback)
    function detectResourceIndex(){
      var headers = headerCells();
      var found = null;
      headers.forEach(function(label, idx){
        if(/resource/.test(label)){
          if(found == null) found = idx;
        }
      });
      return found;
    }

    // ---------- priority detection
    function parseRgb(s){
      var m = /rgba?\s*\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s||'');
      return m ? {r:+m[1], g:+m[2], b:+m[3]} : {r:0,g:0,b:0};
    }
    function isBlack(r,g,b){ return r<40&&g<40&&b<40; }
    function isRed(r,g,b){ return r>150&&g<110&&b<110; }
    function isOrange(r,g,b){ return r>200&&g>110&&g<200&&b<90; }
    function isYellow(r,g,b){ return r>200&&g>200&&b<140; }
    function isBlue(r,g,b){ return b>140&&r<120&&g<190; }

    function dot(pr){
      return pr==='P0'?'⚫️':
             pr==='P1'?'🔴':
             pr==='P2'?'🟠':
             pr==='P4'?'🔵':
             pr==='PM'?'Ⓜ️':
             '🟡';
    }

    var PRIORITY_LABELS = {
      P0: 'P0 Flash Critical',
      P1: 'P1 Critical',
      P2: 'P2 High',
      P3: 'P3 Medium',
      P4: 'P4 Low',
      PM: 'Maintenance'
    };

    function extractDataUrlFromNode(n){
      if(!n) return '';
      function pick(s){
        return (s||'').replace(/^.*url\(["']?/, '').replace(/["']?\).*$/, '');
      }
      var inline = (n.style && (n.style.background || n.style.backgroundImage)) || '';
      var url = /url\(/.test(inline) ? pick(inline) : '';
      if(!url){
        var cs = getComputedStyle(n);
        if(/url\(/.test(cs.backgroundImage||'')) url = pick(cs.backgroundImage);
      }
      return /^data:image/.test(url) ? url : '';
    }

    function sampleDataUrl(url){
      return new Promise(function(res){
        if(!url) return res(null);
        var img = new Image();
        img.onload = function(){
          try{
            var c = document.createElement('canvas');
            c.width = img.naturalWidth || 16;
            c.height = img.naturalHeight || 16;
            var g = c.getContext('2d');
            g.drawImage(img,0,0);
            var d = g.getImageData(Math.floor(c.width/2),Math.floor(c.height/2),1,1).data;
            res({r:d[0],g:d[1],b:d[2]});
          }catch(e){
            res(null);
          }
        };
        img.onerror = function(){ res(null); };
        img.src = url;
      });
    }

    function readPriorityFromCell(td){
      return new Promise(function(resolve){
        if(!td) return resolve('P3');
        var node = td.querySelector('img') || td.firstElementChild || td;
        var url = extractDataUrlFromNode(node);

        // Maintenance explicit detection via data URI
        if(url && url.indexOf(MAINT_DATA_PREFIX) === 0){
          resolve('PM');
          return;
        }

        if(url){
          sampleDataUrl(url).then(function(rgb){
            if(rgb){
              var r = rgb.r, g = rgb.g, b = rgb.b;
              if(isBlack(r,g,b)) return resolve('P0');
              if(isRed(r,g,b))   return resolve('P1');
              if(isOrange(r,g,b))return resolve('P2');
              if(isYellow(r,g,b))return resolve('P3');
              if(isBlue(r,g,b))  return resolve('P4');
            }
            fallback();
          });
        }else{
          fallback();
        }
        function fallback(){
          var hint = (td.title||'').toUpperCase() || txt(td).toUpperCase();
          var m = /\bP([0-4])\b/.exec(hint);
          if(m) return resolve('P'+m[1]);
          var rgb = parseRgb(getComputedStyle(node).color);
          var r = rgb.r, g = rgb.g, b = rgb.b;
          if(isBlack(r,g,b)) return resolve('P0');
          if(isRed(r,g,b))   return resolve('P1');
          if(isOrange(r,g,b))return resolve('P2');
          if(isYellow(r,g,b))return resolve('P3');
          if(isBlue(r,g,b))  return resolve('P4');
          resolve('P3');
        }
      });
    }

    // ---------- status helpers for overview
    var UNASSIGNED_LABEL = 'Unassigned';
    var UNASSIGNED_RAW = [
      'New',
      'New (email)',
      'MUST ASSIGN',
      'MUST ASSIGN - Acknowledged'
    ];
    function isUnassignedStatus(s){
      if(!s) return false;
      var norm = s.replace(/\s+/g,' ').trim().toLowerCase();
      return norm === 'new' ||
             norm === 'new (email)' ||
             norm === 'must assign' ||
             norm === 'must assign - acknowledged';
    }
    function isClientHasResponded(s){
      if(!s) return false;
      return s.replace(/\s+/g,' ').trim().toLowerCase() === 'client has responded';
    }

    // ---------- setup panel
    function ensurePanel(columns, samples, savedForView) {
      var host = document.getElementById(PANEL_ID);
      if(!host){
        host = document.createElement('div');
        host.id = PANEL_ID;
        host.style.all='initial';
        host.style.position='fixed';
        host.style.top='72px';
        host.style.right='16px';
        host.style.zIndex=2147483645;
        document.body.appendChild(host);

        var root = host.attachShadow({mode:'open'});
        var wrap = document.createElement('div');
        wrap.innerHTML =
          '<style>\
            :host { all: initial; }\
            @media (prefers-color-scheme: dark) {\
              .card { background:#0b0f17; color:#e5e7eb; border-color:#1f2937; }\
              select, textarea { background:#0f172a; color:#e5e7eb; border-color:#334155; }\
              .hdr { background:#111827; color:#e5e7eb; }\
              .btn { background:#1f2937; color:#e5e7eb; border-color:#334155; }\
              .btn.primary { background:#2563eb; color:white; border-color:#1d4ed8; }\
            }\
            @media (prefers-color-scheme: light) {\
              .card { background:#fff; color:#111; border-color:rgba(0,0,0,.08); }\
              select, textarea { background:white; color:#111; border-color:#cbd5e1; }\
              .hdr { background:#0f172a; color:#fff; }\
              .btn { background:#f1f5f9; color:#111; border-color:#cbd5e1; }\
              .btn.primary { background:#1f73b7; color:white; border-color:#1b659f; }\
            }\
            .card { font:13px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; width:460px; border:1px solid; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.22); overflow:hidden; }\
            .hdr { padding:10px 12px; font-weight:700; display:flex; justify-content:space-between; align-items:center; }\
            .body{ padding:10px 12px; }\
            .row { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:8px 0; }\
            select,button,textarea { font:inherit; }\
            select,textarea { width:100%; border:1px solid; border-radius:10px; padding:8px 10px; }\
            textarea { height:84px; resize:vertical; }\
            .actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }\
            .btn { border:1px solid; border-radius:10px; padding:6px 12px; cursor:pointer; }\
            .viewtag { font-size:12px; opacity:.8; border:1px solid; padding:2px 8px; border-radius:999px; }\
            .hint { font-size:11px; opacity:.7; margin-top:4px; }\
          </style>\
          <div class="card" role="dialog" aria-label="Teams shoutout setup">\
            <div class="hdr"><div>Teams shoutout setup</div><div class="viewtag" id="viewtag"></div></div>\
            <div class="body">\
              <div class="row">\
                <div><label>Ticket # column</label><select id="col-ticket"></select></div>\
                <div><label>Priority column</label><select id="col-prio"></select></div>\
              </div>\
              <div class="row">\
                <div><label>Summary column</label><select id="col-sum"></select></div>\
                <div><label>Company column</label><select id="col-comp"></select></div>\
              </div>\
              <div class="row">\
                <div><label>Contact column</label><select id="col-cont"></select></div>\
                <div><label>Status column (for overview)</label><select id="col-status"></select></div>\
              </div>\
              <div class="row">\
                <div><label>Resource column (for responses)</label><select id="col-resource"></select></div>\
                <div></div>\
              </div>\
              <div class="hint">Status is only used for the Ctrl+Click overview. Resource is only used for the "Tickets with Responses" section.</div>\
              <div style="margin-top:10px;">\
                <label>Preview</label>\
                <textarea id="preview" readonly></textarea>\
              </div>\
              <div class="actions">\
                <button class="btn" id="close">Close</button>\
                <button class="btn primary" id="save">Save</button>\
              </div>\
            </div>\
          </div>';
        root.appendChild(wrap);
        host._root = root;
      }

      var root = host._root;
      var $ = function(sel){ return root.querySelector(sel); };
      $('#viewtag').textContent = readViewExact();

      var cols = columns;
      var samp = samples;

      function buildOptions(sel, selectedIdx){
        var s = $(sel);
        s.innerHTML = '';
        var entries = [];
        cols.forEach(function(label, idx){ entries.push({idx:idx, label:label}); });
        samp.forEach(function(val, idx){
          if(!cols.has(idx)) entries.push({idx:idx, label:'(no header)'});
        });
        entries.sort(function(a,b){ return a.idx - b.idx; });
        for(var i=0;i<entries.length;i++){
          var it = entries[i];
          var sample = samp.get(it.idx) || '';
          var o = document.createElement('option');
          o.value = String(it.idx);
          o.textContent = '#' + it.idx + ' - ' + (it.label||'(no header)') + '  •  ' + (sample ? sample.slice(0,60) : '');
          if(String(it.idx) === String(selectedIdx)) o.selected = true;
          s.appendChild(o);
        }
      }

      buildOptions('#col-ticket', savedForView && savedForView.ticket);
      buildOptions('#col-prio',   savedForView && savedForView.priority);
      buildOptions('#col-sum',    savedForView && savedForView.summary);
      buildOptions('#col-comp',   savedForView && savedForView.company);
      buildOptions('#col-cont',   savedForView && savedForView.contact);
      buildOptions(
        '#col-status',
        savedForView && typeof savedForView.status === 'number'
          ? savedForView.status
          : detectStatusIndex()
      );
      buildOptions(
        '#col-resource',
        savedForView && typeof savedForView.resource === 'number'
          ? savedForView.resource
          : detectResourceIndex()
      );

      function readSel(){
        return {
          ticket:+root.getElementById('col-ticket').value,
          priority:+root.getElementById('col-prio').value,
          summary:+root.getElementById('col-sum').value,
          company:+root.getElementById('col-comp').value,
          contact:+root.getElementById('col-cont').value,
          status:+root.getElementById('col-status').value,
          resource:+root.getElementById('col-resource').value
        };
      }

      function refreshPreview(){
        try{
          var sel = readSel();
          var r = rows()[0];
          var pv = root.getElementById('preview');
          if(!r){
            pv.value = 'No rows to preview.';
            return;
          }
          function get(i){
            var td = r.querySelector('td[cellindex="' + i + '"]');
            if(!td) return '';
            var a = td.querySelector('a');
            return a ? txt(a) : txt(td.querySelector('div')||td);
          }
          var ticket = get(sel.ticket);
          var summary = stripSLA(get(sel.summary));
          var company = stripSLA(get(sel.company));
          var contact = stripSLA(get(sel.contact));
          readPriorityFromCell(r.querySelector('td[cellindex="' + sel.priority + '"]')).then(function(pr){
            var url = ticket ? ticketUrl(ticket) : '';
            pv.value = dot(pr) + ' #' + ticket + ' - ' + summary +
                       (company ? ' - ' + company : '') +
                       (contact ? ' - ' + contact : '') +
                       (url ? ' ('+url+')' : '');
          });
        }catch(e){
          console.error('[teams-shoutout] preview error', e);
        }
      }

      root.getElementById('save').onclick = function(){
        var sel = readSel();
        getSettings().then(function(all){
          var ex = keyExact();
          var ca = keyCanonical();
          all[ex] = sel;
          all[ca] = sel;
          return setSettings(all);
        }).then(function(){
          toast('Saved mapping for this View');
          var el = document.getElementById(PANEL_ID);
          if(el) el.remove();
        }).catch(function(e){
          console.error('[teams-shoutout] save error', e);
          toast('Save failed');
        });
      };
      root.getElementById('close').onclick = function(){
        var el = document.getElementById(PANEL_ID);
        if(el) el.remove();
      };

      refreshPreview();
      ['#col-ticket','#col-prio','#col-sum','#col-comp','#col-cont','#col-status','#col-resource'].forEach(function(id){
        root.querySelector(id).addEventListener('change', refreshPreview);
      });
    }

    // ---------- clipboard
    function writeBoth(html, text){
      return new Promise(function(res){
        try{
          if(navigator.clipboard && window.ClipboardItem){
            var item = new ClipboardItem({
              'text/html':new Blob([html],{type:'text/html'}),
              'text/plain':new Blob([text],{type:'text/plain'})
            });
            navigator.clipboard.write([item]).then(function(){
              res(true);
            }).catch(function(){
              legacy();
            });
            return;
          }
        }catch(e){}
        try{
          if(typeof GM_setClipboard === 'function'){
            GM_setClipboard(html,{type:'text/html'});
            return res(true);
          }
          if(typeof GM !== 'undefined' && typeof GM.setClipboard === 'function'){
            GM.setClipboard(html,{type:'text/html'});
            return res(true);
          }
        }catch(e){}
        legacy();
        function legacy(){
          try{
            navigator.clipboard.writeText(text).then(function(){
              res(true);
            }).catch(domCopy);
          }catch(e){
            domCopy();
          }
        }
        function domCopy(){
          try{
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position='fixed';
            ta.style.left='-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            res(true);
          }catch(e2){
            res(false);
          }
        }
      });
    }

    // ---------- shoutout copy (per ticket list)
    function copyWithMapping(map, onlyHigh){
      if(onlyHigh == null) onlyHigh = false;
      try{
        var rws = rows();
        if(!rws.length){
          toast('No rows');
          return;
        }

        var items = [];
        (function step(i){
          if(i >= rws.length){
            var htmlParts = ['<strong>Tickets needing attention (' + items.length + ')</strong>','<br><br>'];
            for(var k=0;k<items.length;k++){
              var it = items[k];
              var metaPieces = [];
              if(it.company) metaPieces.push(esc(it.company));
              if(it.contact) metaPieces.push(esc(it.contact));
              var meta = metaPieces.length ? ('ㅤ <i>' + metaPieces.join(' - ') + '</i>') : '';
              htmlParts.push(
                it.dot + ' <a href="' + it.url + '">#' + it.ticket + '</a> <u>' + esc(it.summary) + '</u><br>' +
                meta
              );
              if(k !== items.length - 1) htmlParts.push('<br><br>');
            }
            var html = htmlParts.join('');

            var plainLines = ['Tickets needing attention (' + items.length + ')',''];
            for(var p=0;p<items.length;p++){
              var it2 = items[p];
              plainLines.push(it2.dot + ' #' + it2.ticket + ' ' + it2.summary + ' (' + it2.url + ')');
              var metaTxt = [];
              if(it2.company) metaTxt.push(it2.company);
              if(it2.contact) metaTxt.push(it2.contact);
              if(metaTxt.length) plainLines.push('ㅤ ' + metaTxt.join(' - '));
              if(p !== items.length - 1) plainLines.push('');
            }
            var plain = plainLines.join('\n');

            writeBoth(html, plain).then(function(ok){
              toast(ok ? ('Copied ' + items.length + ' entr' + (items.length===1?'y':'ies')) : 'Copy failed');
            });
            return;
          }

          var r = rws[i];
          var ticket = valFromCell(r, map.ticket);
          if(!ticket || !isTicketId(ticket)){
            step(i+1);
            return;
          }

          var summary = stripSLA(valFromCell(r, map.summary));
          var company = stripSLA(valFromCell(r, map.company));
          var contact = stripSLA(valFromCell(r, map.contact));

          readPriorityFromCell(tdByIndex(r, map.priority)).then(function(pr){
            if(onlyHigh && !/^P[0-2]$/.test(pr)){
              step(i+1);
              return;
            }
            items.push({
              dot: dot(pr),
              ticket: ticket,
              url: ticketUrl(ticket),
              summary: summary,
              company: company,
              contact: contact
            });
            step(i+1);
          });
        })(0);
      }catch(e){
        console.error('[teams-shoutout] copy error', e);
        toast('Copy error, see console');
      }
    }

    // ---------- overview copy: table of unassigned + tickets-with-responses
    function copyOverview(map){
      try{
        var rws = rows();
        if(!rws.length){
          toast('No rows');
          return;
        }

        var statusIdx = (map && typeof map.status === 'number' && !isNaN(map.status))
          ? map.status
          : detectStatusIndex();

        var resourceIdx = (map && typeof map.resource === 'number' && !isNaN(map.resource))
          ? map.resource
          : null;

        if(resourceIdx == null){
          toast('Resource column not mapped, open setup');
          return;
        }

        var buckets = {};   // { P2: { unassigned: n } }
        var responses = {}; // { resourceName: count } for Client Has Responded
        var jobs = [];

        rws.forEach(function(r){
          var prCell = tdByIndex(r, map.priority);
          var statusRaw = statusIdx != null ? valFromCell(r, statusIdx) : '';
          var statusNorm = statusRaw.replace(/\s+/g,' ').trim();

          var resource = valFromCell(r, resourceIdx) || '';
          resource = resource.replace(/\s+/g,' ').trim();

          var job = readPriorityFromCell(prCell).then(function(pr){
            var b = buckets[pr] || (buckets[pr] = { unassigned:0 });

            // unassigned tickets = no resource, any status
            if(!resource){
              b.unassigned++;
            }

            // tickets with responses (Client Has Responded), by resource (blank => Unassigned)
            if(isClientHasResponded(statusNorm)){
              var key = resource || 'Unassigned';
              responses[key] = (responses[key] || 0) + 1;
            }
          });
          jobs.push(job);
        });

        Promise.all(jobs).then(function(){
          // total = total unassigned tickets across all priorities
          var totalUnassigned = 0;
          Object.keys(buckets).forEach(function(pr){
            totalUnassigned += buckets[pr].unassigned;
          });

          var activePriorities = PRIORITY_ORDER.filter(function(pr){
            return buckets[pr] && buckets[pr].unassigned > 0;
          });

          if(!activePriorities.length && !Object.keys(responses).length){
            toast('No unassigned tickets or responses to report');
            return;
          }

          // build HTML
          var htmlParts = [
            '<strong>HD Board Health Update</strong>',
            totalUnassigned ? ' (' + totalUnassigned + ' unassigned)' : '',
            '<br><br>'
          ];

          if(activePriorities.length){
            htmlParts.push('<table cellpadding="4" cellspacing="0" border="1">');
            htmlParts.push('<thead><tr><th>Priority</th><th>Unassigned tickets</th></tr></thead><tbody>');
            activePriorities.forEach(function(pr){
              var b = buckets[pr];
              var label = PRIORITY_LABELS[pr] || pr;
              htmlParts.push(
                '<tr><td>' + dot(pr) + ' ' + esc(label) + '</td><td>' +
                String(b.unassigned) + '</td></tr>'
              );
            });
            htmlParts.push('</tbody></table>');
          }

          // Tickets with Responses section
          var responseKeys = Object.keys(responses);
          if(responseKeys.length){
            if(activePriorities.length) htmlParts.push('<br><br>');
            htmlParts.push('<strong>Tickets with Responses</strong><br><br>');

            // Unassigned first, then others alpha
            var orderedRes = [];
            if(responseKeys.indexOf('Unassigned') !== -1){
              orderedRes.push('Unassigned');
            }
            responseKeys.sort(function(a,b){
              var aa = a.toLowerCase();
              var bb = b.toLowerCase();
              if(aa < bb) return -1;
              if(aa > bb) return 1;
              return 0;
            });
            responseKeys.forEach(function(k){
              if(orderedRes.indexOf(k) === -1) orderedRes.push(k);
            });

            orderedRes.forEach(function(name){
              var cnt = responses[name] || 0;
              htmlParts.push('• ' + esc(name) + ', ' + cnt + '<br>');
            });
          }

          var html = htmlParts.join('');

          // plain text fallback
          var plainLines = [];
          plainLines.push(
            'HD Board Health Update' +
            (totalUnassigned ? ' (' + totalUnassigned + ' unassigned)' : '')
          );
          plainLines.push('');

          if(activePriorities.length){
            plainLines.push('Priority vs Unassigned');
            activePriorities.forEach(function(pr){
              var b = buckets[pr];
              var label = PRIORITY_LABELS[pr] || pr;
              plainLines.push(dot(pr) + ' ' + label + ': ' + b.unassigned);
            });
          }

          var responseKeys2 = Object.keys(responses);
          if(responseKeys2.length){
            if(activePriorities.length) plainLines.push('');
            plainLines.push('Tickets with Responses');
            // same ordering as HTML
            var orderedRes2 = [];
            if(responseKeys2.indexOf('Unassigned') !== -1){
              orderedRes2.push('Unassigned');
            }
            responseKeys2.sort(function(a,b){
              var aa = a.toLowerCase();
              var bb = b.toLowerCase();
              if(aa < bb) return -1;
              if(aa > bb) return 1;
              return 0;
            });
            responseKeys2.forEach(function(k){
              if(orderedRes2.indexOf(k) === -1) orderedRes2.push(k);
            });
            orderedRes2.forEach(function(name){
              var cnt = responses[name] || 0;
              plainLines.push('  • ' + name + ', ' + cnt);
            });
          }

          var plain = plainLines.join('\n');

          writeBoth(html, plain).then(function(ok){
            toast(ok ? 'Copied HD Board Health Update' : 'Copy failed');
          });
        }).catch(function(err){
          console.error('[teams-shoutout] overview error', err);
          toast('Overview error, see console');
        });

      }catch(e){
        console.error('[teams-shoutout] overview error', e);
        toast('Overview error, see console');
      }
    }


    // ---------- setup open with smart prefill
    function firstSavedMapping(all){
      var keys = Object.keys(all || {});
      for(var i=0;i<keys.length;i++){
        var m = all[keys[i]];
        if(m && typeof m === 'object' && typeof m.ticket === 'number') return m;
      }
      return null;
    }

    function openSetup(){
      try{
        var cols = headerCells();
        var samp = sampleRowCells();
        getSettings().then(function(all){
          var existing = all[keyExact()] || all[keyCanonical()];
          if(!existing){
            var guessTicket = detectTicketIndex();
            var candidate = firstSavedMapping(all);
            if(candidate && guessTicket != null && +candidate.ticket === +guessTicket){
              existing = candidate;
            }
          }
          ensurePanel(cols, samp, existing);
        });
      }catch(e){
        console.error('[teams-shoutout] openSetup error', e);
        toast('Setup error, see console');
      }
    }

    // ---------- toolbar mount
    function findToolbarCanvas() {
      var canvas = document.querySelector('.x-panel-toolbar .GMDB3DUBHYI .GMDB3DUBALJ') ||
                   document.querySelector('.GMDB3DUBHYI .GMDB3DUBALJ') ||
                   document.querySelector('.x-panel-toolbar') ||
                   null;
      return canvas;
    }
    function positionToolbarButton(btn) {
      var canvas = findToolbarCanvas();
      if (!canvas) return;
      var searchEl = canvas.querySelector('.cw-toolbar-search');
      var actionsEl = canvas.querySelector('.cw-toolbar-actions');
      var clearEl  = canvas.querySelector('.cw-toolbar-clear');

      function boxLeft(node) {
        if (!node) return null;
        var left = parseInt(node.style.left || '0', 10);
        var width = (node.getBoundingClientRect ? node.getBoundingClientRect().width : 0) || 64;
        return Math.max(0, left + width + 8);
      }

      var left = boxLeft(searchEl);
      if (left == null) left = boxLeft(actionsEl);
      if (left == null) left = boxLeft(clearEl);
      if (left == null) left = 8;

      btn.style.position = 'absolute';
      btn.style.top = '3px';
      btn.style.left = left + 'px';
      btn.style.zIndex = '2';
      btn.style.marginLeft = '0';
      btn.style.height = '20px';
      btn.style.lineHeight = '18px';
    }

    function ensureButton(){
      if(!isBoard()) return;

      var existing = document.getElementById(BTN_ID);
      if(existing && !document.body.contains(existing)) existing = null;
      if(existing){
        positionToolbarButton(existing);
        return;
      }

      var canvas = findToolbarCanvas();
      if (!canvas) return;

      var b = document.createElement('button');
      b.id = BTN_ID;
      b.type='button';
      b.textContent = 'Teams Shoutout';
      b.className = 'attentus-btn';
      b.style.border = '1px solid #334155';
      b.style.borderRadius = '8px';
      b.style.padding = '0 10px';
      b.style.background = '#1f2937';
      b.style.color = '#e5e7eb';
      b.style.font = '600 12px/18px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';
      b.style.cursor = 'pointer';

      canvas.appendChild(b);
      positionToolbarButton(b);

      b.addEventListener('click', function(e){
        if(e.altKey){ debugDump(); return; }
        if(e.shiftKey){ openSetup(); return; }

        var wantOverview = e.ctrlKey || e.metaKey;

        getSettings().then(function(all){
          var map = all[keyExact()] || all[keyCanonical()];
          if(!map){
            openSetup();
            toast('No mapping for this View, opened setup');
            return;
          }
          if(wantOverview){
            copyOverview(map);
          }else{
            copyWithMapping(map, false);
          }
        }).catch(function(err){
          console.error('[teams-shoutout] click path error', err);
          toast('Click error, see console');
        });
      });

      b.addEventListener('contextmenu', function(e){
        e.preventDefault();
        getSettings().then(function(all){
          var map = all[keyExact()] || all[keyCanonical()];
          if(!map){
            openSetup();
            toast('No mapping for this View, opened setup');
            return;
          }
          copyWithMapping(map, true);
        }).catch(function(err){
          console.error('[teams-shoutout] context path error', err);
          toast('Click error, see console');
        });
      });

      window.addEventListener('resize', function(){
        var btn = document.getElementById(BTN_ID);
        if(btn) positionToolbarButton(btn);
      });
      var mo = new MutationObserver(function(){
        var btn = document.getElementById(BTN_ID);
        if(btn && isBoard()) positionToolbarButton(btn);
        if(btn && !isBoard()){
          btn.remove();
        }
      });
      mo.observe(canvas, { attributes:true, childList:true, subtree:true });
    }

    function debugDump(){
      var ex = keyExact();
      var ca = keyCanonical();
      var vExact = readViewExact();
      var vCanon = readViewCanonical();
      getSettings().then(function(all){
        console.debug('[teams-shoutout] view exact:', JSON.stringify(vExact));
        console.debug('[teams-shoutout] view canonical:', JSON.stringify(vCanon));
        console.debug('[teams-shoutout] key exact:', ex);
        console.debug('[teams-shoutout] key canonical:', ca);
        console.debug('[teams-shoutout] keys saved:', Object.keys(all));
        console.debug('[teams-shoutout] mapping hit exact?', !!all[ex], 'hit canonical?', !!all[ca]);
        toast('Debug info, see console');
      });
    }

    function init(){
      if(!isBoard()) return;
      ensureButton();
    }

    (function boot(){
      var delays = [0, 250, 750, 1500, 2500];
      (function step(i){
        if(i >= delays.length){
          var mo = new MutationObserver(function(){
            if(!document.getElementById(BTN_ID)){
              if(isBoard()) ensureButton();
            }else if(!isBoard()){
              var x = document.getElementById(BTN_ID);
              if(x) x.remove();
            }
          });
          mo.observe(document.body, { childList:true, subtree:true });
          return;
        }
        setTimeout(function(){
          init();
          step(i+1);
        }, delays[i]);
      })(0);
    })();
  })();

})();
