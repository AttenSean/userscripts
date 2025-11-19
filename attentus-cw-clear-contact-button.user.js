// ==UserScript==
// @name         attentus-cw-clear-contact-button
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.3.1
// @description  Adds a button next to Follow that clears Contact, Phone, and Email on the Service Ticket page only
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM.setValue
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'cw-clear-contact-btn';
  const DEBUG = !!localStorage.getItem('attentus-debug');
  const log = (...args) => { if (DEBUG) console.log('[ClearContact]', ...args); };

  // ---------- feedback flash ----------

  function ensureFlashStyles() {
    if (document.getElementById('cw-clear-flash-styles')) return;
    const css = document.createElement('style');
    css.id = 'cw-clear-flash-styles';
    css.textContent = `
      @keyframes cwClearPulse {
        0%   { transform: scale(1); }
        50%  { transform: scale(1.04); box-shadow: 0 0 0 2px rgba(59,130,246,0.45) inset; }
        100% { transform: scale(1); box-shadow: none; }
      }
      .cw-flash-pulse {
        animation: cwClearPulse 0.35s ease-in-out;
        border-radius: 6px;
      }
    `;
    document.head.appendChild(css);
  }

  function flashCleared(btnRoot, labelEl) {
    if (!labelEl) return;
    const original = labelEl.textContent;
    labelEl.textContent = 'Cleared';
    btnRoot.classList.add('cw-flash-pulse');
    btnRoot.setAttribute('aria-live', 'polite');
    setTimeout(() => {
      labelEl.textContent = original;
      btnRoot.classList.remove('cw-flash-pulse');
      btnRoot.removeAttribute('aria-live');
    }, 800);
  }

  // ---------- positive gating: only the correct Service Ticket page ----------

  function hasServiceTicketNavLabel() {
    const nodes = document.querySelectorAll(
      '.navigationEntry.cw_CwLabel, .navigationEntry.mm_label, .navigationEntry.gwt-Label'
    );
    return Array.from(nodes).some(el => {
      const t = (el.textContent || '').trim();
      // be a bit loose, match "Service Ticket" anywhere in the nav entry
      return /service\s+ticket/i.test(t);
    });
  }

  function hasAgeLabel() {
    const nodes = document.querySelectorAll('.cw_CwHTML.mm_label, .gwt-HTML.mm_label.cw_CwHTML');
    return Array.from(nodes).some(el => /age\s*:/i.test((el.textContent || '').trim()));
  }

  // optional, debug only, do not gate on this
  function hasContactLabelLoose() {
    // your original example had "cw_contact contact label", but that may vary
    const byClass = document.querySelector('.cw_contact.contact.label');
    if (byClass) return true;

    // fallbacks: any element whose text is "Contact" near the contact field
    const labels = document.querySelectorAll('.mm_label, .cw_CwLabel, .gwt-Label');
    return Array.from(labels).some(el => {
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'contact' || t === 'contact:';
    });
  }

  function isCanonicalServiceTicketPage() {
    const nav = hasServiceTicketNavLabel();
    const age = hasAgeLabel();
    const contactLabel = hasContactLabelLoose(); // debug only
    const ok = nav && age;

    if (DEBUG) {
      log('isCanonicalServiceTicketPage', { nav, age, contactLabel, ok });
    }
    return ok;
  }

  // ---------- field clearing ----------

  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function clearContactInfo() {
    let didSomething = false;

    const clearSet = (selectorList) => {
      selectorList.forEach(sel => {
        document.querySelectorAll(sel).forEach(inp => {
          if (!('value' in inp)) return;
          if (!inp.value) return;
          inp.value = '';
          dispatchAll(inp);
          didSomething = true;
        });
      });
    };

    // Contact
    clearSet([
      'input.cw_contact',
      'input[aria-label="Contact"]',
      'input[id*="Contact"][role="combobox"]',
      'input[name="ContactRecID"]'
    ]);

    // Email
    clearSet([
      'input.cw_emailAddress',
      'input[aria-label="Email"]',
      'input[name="EmailAddress"]'
    ]);

    // Phone block, number and extension
    const phoneBlock = document.querySelector('.cw_contactPhoneCommunications');
    if (phoneBlock) {
      phoneBlock.querySelectorAll('input[type="text"]').forEach(inp => {
        if (!inp.value) return;
        inp.value = '';
        dispatchAll(inp);
        didSomething = true;
      });
    }
    clearSet([
      'input[aria-label="Phone"]',
      'input[name="PhoneNumber"]',
      'input[aria-label*="Ext"]',
      'input[name*="Ext"]'
    ]);

    if (!didSomething) {
      log('No contact related fields found to clear on this layout');
    }
  }

  // ---------- button creation and placement ----------

  function makeButton() {
    ensureFlashStyles();

    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;
    outer.setAttribute('data-origin', 'attentus');
    outer.tabIndex = 0;

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Clear Contact');

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = 'Clear Contact';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearContactInfo();
      flashCleared(btn, label);
    };

    outer.addEventListener('pointerup', run, true);
    outer.addEventListener('click', run, true);
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        run(e);
      }
    });

    outer.title = 'Clear Contact, Phone, and Email';

    return outer;
  }

  function findFollowButton() {
    const followLabel = Array.from(document.querySelectorAll('.GMDB3DUBBPG'))
      .find(el => (el.textContent || '').trim().toLowerCase() === 'follow');
    if (!followLabel) return null;
    const followBtn = followLabel.closest('.cw_CwActionButton');
    return followBtn || null;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;
    if (!isCanonicalServiceTicketPage()) {
      log('gating blocked, not canonical Service Ticket page');
      return false;
    }

    const followBtn = findFollowButton();
    if (!followBtn) {
      log('Follow button not found, cannot place Clear Contact');
      return false;
    }

    const newBtn = makeButton();
    followBtn.insertAdjacentElement('afterend', newBtn);
    log('Clear Contact mounted next to Follow');
    return true;
  }

  // ---------- SPA safe wiring ----------

  function getSpaRoot() {
    return document.querySelector('#cwContent') ||
           document.querySelector('.cw-WorkspaceView') ||
           document.body;
  }

  function ensure() {
    if (!isCanonicalServiceTicketPage()) {
      const existing = document.getElementById(BTN_ID);
      if (existing && existing.parentElement) {
        existing.parentElement.removeChild(existing);
        log('Clear Contact removed due to gating change');
      }
      return;
    }
    placeButton();
  }

  const root = getSpaRoot();
  if (root) {
    const mo = new MutationObserver(() => ensure());
    mo.observe(root, { subtree: true, childList: true });
  }

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    if (!orig) return;
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(ensure);
      return r;
    };
  });
  window.addEventListener('popstate', ensure);
  window.addEventListener('hashchange', ensure);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensure();
  });

  setTimeout(ensure, 0);
  setTimeout(ensure, 250);
  setTimeout(ensure, 750);
  setTimeout(ensure, 1500);
})();

/*
Selectors QA - Clear Contact button

Positive gating
- isCanonicalServiceTicketPage() true only when:
  - Navigation label:
    - .navigationEntry.cw_CwLabel or related
    - text contains "Service Ticket" (case insensitive)
  - Age label:
    - .cw_CwHTML.mm_label or .gwt-HTML.mm_label.cw_CwHTML
    - text contains "Age:"

Optional signals (debug)
- Contact label:
  - .cw_contact.contact.label or a label with text "Contact"

Must not fire on
- Any view missing either the Service Ticket nav label or the Age line
- Timesheets, Daily Time Entries, finance, etc are implicitly excluded

Placement
- Anchor:
  - Follow button found via .GMDB3DUBBPG text "Follow"
  - Clear Contact inserts immediately after that .cw_CwActionButton
*/
