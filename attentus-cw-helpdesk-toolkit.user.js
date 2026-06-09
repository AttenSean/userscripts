// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.0.1
// @description  Helpdesk toolkit for ConnectWise ticket triage. Confirms before DOM-only field changes and keeps clipboard draft fallback mode.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-helpdesk-toolkit.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BAR_ID = 'att-cw-helpdesk-toolkit-bar';
  const SLOT_ID = 'att-cw-helpdesk-toolkit-slot';
  const TRIAGE_MODE_STORAGE_KEY = 'att_hd_triage_mode';
  const TRIAGE_MODES = new Set(['draftOnly', 'confirmApply']);
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
      buttonLabel: 'Apply Spam/Phish…',
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
      buttonLabel: 'Apply Junk…',
      draftLabel: 'Copy Junk Draft',
      confirmationTitle: 'Confirm Junk triage',
      fieldSummary: 'Move the ticket to the Junk board.',
      mutations: [
        { field: 'board', value: 'Junk' }
      ],
      postApplyMessage: 'Junk fields applied'
    },
    cancel: {
      buttonLabel: 'Apply Cancel…',
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
    tier: { label: 'Item/Tier', type: 'combo', find: () => findInputByLabel('Ticket Tier?') || findInputByLabel('Item/Tier') },
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
    return getTriageMode() === 'draftOnly';
  }

  function getTriageButtonLabel(workflow) {
    return isDraftOnlyMode() ? (workflow.draftLabel || workflow.buttonLabel) : workflow.buttonLabel;
  }

  function getTriageButtonTooltip() {
    return isDraftOnlyMode() ? TRIAGE_DRAFT_TOOLTIP : TRIAGE_APPLY_TOOLTIP;
  }

  function handleTriageButton(kind) {
    return isDraftOnlyMode() ? copyTriage(kind) : confirmAndApplyTriage(kind);
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
      message: `${workflow.fieldSummary} No ConnectWise fields will change until you choose Apply Fields. This uses only visible UI/DOM automation; the copy-draft action keeps draft-mode behavior.`,
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
        value: 'draftOnly',
        title: 'Draft only',
        description: 'Triage buttons copy drafts to the clipboard only and do not change fields.'
      },
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
    header.insertAdjacentElement('afterend', makeBar());
    return true;
  }

  window.attentusHelpdeskToolkit = {
    copyTriage,
    confirmAndApplyTriage,
    getTriageMode,
    setTriageMode,
    showToolkitSettingsDialog,
    handleTriageButton,
    snapshotFields,
    applyFieldChanges,
    revertFieldChanges,
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
})();
