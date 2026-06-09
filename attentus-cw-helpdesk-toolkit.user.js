// ==UserScript==
// @name         attentus-cw-helpdesk-toolkit
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.0.0
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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

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

  const TRIAGE_DEFINITIONS = {
    junk: {
      label: 'Junk',
      draft: 'Triage draft: mark the ticket as Junk.',
      fields: [
        { label: 'Board', value: 'Junk', type: 'combo', find: () => findInputBySelectors(['input.cw_serviceBoard']) || findInputByLabel('Board') }
      ]
    },
    cancel: {
      label: 'Closed/Cancelled',
      draft: 'Triage draft: close/cancel the ticket and mark Ticket Tier? as N/A - Cancelled Ticket.',
      fields: [
        { label: 'Status', value: '>Closed/Cancelled', type: 'combo', find: () => findInputBySelectors(['input.cw_status']) || findInputByLabel('Status') },
        { label: 'Ticket Tier?', value: 'N/A - Cancelled Ticket', type: 'combo', find: () => findInputByLabel('Ticket Tier?') }
      ]
    },
    spam: {
      label: 'Spam/Phishing',
      draft: 'Triage draft: classify the ticket as Spam/Phishing with low SLA/priority and a normalized summary.',
      fields: [
        { label: 'Board', value: 'Help Desk', type: 'combo', find: () => findInputBySelectors(['input.cw_serviceBoard']) || findInputByLabel('Board') },
        { label: 'Status', value: 'MUST ASSIGN', type: 'combo', find: () => findInputBySelectors(['input.cw_status']) || findInputByLabel('Status') },
        { label: 'Type', value: 'Email', type: 'combo', find: () => findInputBySelectors(['input.cw_type']) || findInputByLabel('Type') },
        { label: 'Sub-Type', value: 'Spam/Phishing', type: 'combo', find: () => findInputBySelectors(['input.cw_subType']) || findInputByLabel('Sub-Type') || findInputByLabel('Subtype') },
        { label: 'Ticket Tier?', value: 'Tier 1', type: 'combo', find: () => findInputByLabel('Ticket Tier?') },
        { label: 'Impact', value: 'Low', type: 'combo', find: () => findInputBySelectors(['input.cw_impact']) || findInputByLabel('Impact') },
        { label: 'Urgency', value: 'Low', type: 'combo', find: () => findInputBySelectors(['input.cw_urgency']) || findInputByLabel('Urgency') },
        { label: 'Priority', value: 'Priority 4', type: 'combo', find: () => findInputBySelectors(['input.cw_priority']) || findInputByLabel('Priority') },
        {
          label: 'Summary',
          value: () => {
            const contact = findContactName();
            return `Spam/Phishing${contact ? ` (${contact})` : ''}`;
          },
          type: 'text',
          find: findSummaryInput
        }
      ]
    }
  };

  function getTriageDefinition(kind) {
    const key = norm(kind || '').replace(/[^a-z]/g, '');
    if (key === 'closedcancelled' || key === 'closed' || key === 'cancelled') return TRIAGE_DEFINITIONS.cancel;
    if (key === 'spamphishing' || key === 'phishing') return TRIAGE_DEFINITIONS.spam;
    return TRIAGE_DEFINITIONS[key] || null;
  }

  function buildFieldPlan(definition) {
    return definition.fields.map(field => {
      const input = field.find?.() || null;
      const value = typeof field.value === 'function' ? field.value() : field.value;
      return {
        ...field,
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
    const definition = getTriageDefinition(kind);
    if (!definition) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(definition);
    const draft = [definition.draft, '', 'Fields:', describePlan(plan)].join('\n');
    const ok = await copyText(draft);
    toast(ok ? `${definition.label} draft copied` : 'Could not copy draft');
    return ok;
  }

  async function applyFieldPlan(plan) {
    for (const item of plan) {
      const input = item.input || item.find?.();
      if (!input) {
        toast(`${item.label} field not found`);
        return false;
      }
      const ok = item.type === 'text'
        ? await commitTextOnElement(input, item.value)
        : await commitComboOnElement(input, item.value);
      if (!ok) {
        toast(`Could not set ${item.label}`);
        return false;
      }
    }
    return true;
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
    const definition = getTriageDefinition(kind);
    if (!definition) {
      toast(`Unknown triage kind: ${kind}`);
      return false;
    }

    const plan = buildFieldPlan(definition);
    showActionDialog(`Confirm ${definition.label} triage`, {
      message: 'No ConnectWise fields will change until you choose Apply Fields. This uses only visible UI/DOM automation; Copy Draft Only keeps draft-mode behavior.',
      fields: plan,
      actions: [
        { label: 'Cancel', onClick: () => toast('Triage cancelled') },
        { label: 'Copy Draft Only', onClick: () => copyTriage(kind) },
        {
          label: 'Apply Fields',
          primary: true,
          onClick: async () => {
            const ok = await applyFieldPlan(plan);
            toast(ok ? `${definition.label} fields applied` : `${definition.label} apply stopped`);
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
      makeActionButton('att-cw-helpdesk-spam-btn', 'Spam/Phishing', 'Confirm and apply Spam/Phishing triage fields', () => confirmAndApplyTriage('spam')),
      makeActionButton('att-cw-helpdesk-junk-btn', 'Junk', 'Confirm and apply Junk triage fields', () => confirmAndApplyTriage('junk')),
      makeActionButton('att-cw-helpdesk-cancel-btn', 'Closed/Cancelled', 'Confirm and apply Closed/Cancelled triage fields', () => confirmAndApplyTriage('cancel'))
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
