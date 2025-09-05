// ==UserScript==
// @name         attentus-cw-clear-contact-button
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1
// @description  Adds a button to the right of Follow that clears Contact, Phone, and Email fields in one click
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// ==/UserScript==


(function () {
  'use strict';

  const BTN_ID = 'cw-clear-contact-btn';

  // Inject tiny CSS once for the flash effect
  function ensureFlashStyles() {
    if (document.getElementById('cw-clear-flash-styles')) return;
    const css = document.createElement('style');
    css.id = 'cw-clear-flash-styles';
    css.textContent = `
      @keyframes cwFlashPulse {
        0%   { transform: scale(1);   }
        50%  { transform: scale(1.04);}
        100% { transform: scale(1);   }
      }
      .cw-flash-pulse {
        animation: cwFlashPulse .35s ease-in-out;
        box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset;
        border-radius: 6px;
      }
    `;
    document.head.appendChild(css);
  }

  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function clearContactInfo() {
    // Contact
    const contact = document.querySelector('input.cw_contact');
    if (contact) { contact.value = ''; dispatchAll(contact); }

    // Email
    const email = document.querySelector('input.cw_emailAddress');
    if (email) { email.value = ''; dispatchAll(email); }

    // Phone block, clear number and extension inputs
    const phoneBlock = document.querySelector('.cw_contactPhoneCommunications');
    if (phoneBlock) {
      phoneBlock.querySelectorAll('input[type="text"]').forEach(inp => {
        inp.value = '';
        dispatchAll(inp);
      });
    }
  }

  function flashCleared(btnRoot, labelEl) {
    if (!labelEl) return;

    const original = labelEl.textContent;
    labelEl.textContent = 'Cleared';
    btnRoot.classList.add('cw-flash-pulse');

    // Accessible live region ping
    btnRoot.setAttribute('aria-live', 'polite');

    setTimeout(() => {
      labelEl.textContent = original;
      btnRoot.classList.remove('cw-flash-pulse');
    }, 900);
  }

  function makeButton() {
    ensureFlashStyles();

    // Match CW action button structure for native look
    const outer = document.createElement('div');
    outer.className = 'GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton';
    outer.id = BTN_ID;

    const btn = document.createElement('div');
    btn.className = 'GMDB3DUBIOG mm_button';
    btn.tabIndex = 0;

    const inner = document.createElement('div');
    inner.className = 'GMDB3DUBJOG GMDB3DUBNQG';

    const label = document.createElement('div');
    label.className = 'GMDB3DUBBPG';
    label.textContent = 'Clear Contact';

    inner.appendChild(label);
    btn.appendChild(inner);
    outer.appendChild(btn);

    // Click and keyboard
    const handler = (e) => {
      e.preventDefault();
      clearContactInfo();
      flashCleared(btn, label);
    };
    outer.addEventListener('click', handler);
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });

    // Tooltip
    outer.title = 'Clear Contact, Phone, and Email';

    return outer;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;

    // Find the Follow action button label
    const followLabel = Array.from(document.querySelectorAll('.GMDB3DUBBPG'))
      .find(el => (el.textContent || '').trim().toLowerCase() === 'follow');
    if (!followLabel) return false;

    const followBtn = followLabel.closest('.cw_CwActionButton');
    if (!followBtn) return false;

    const newBtn = makeButton();
    followBtn.insertAdjacentElement('afterend', newBtn);
    return true;
  }

  // Try immediately, then watch for SPA nav changes
  function ensure() { placeButton(); }

  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () { const r = orig.apply(this, arguments); queueMicrotask(ensure); return r; };
  });
  window.addEventListener('popstate', ensure);

  ensure();
})();
