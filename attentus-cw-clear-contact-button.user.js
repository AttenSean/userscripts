// ==UserScript==
// @name         attentus-cw-clear-contact-button
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.2.0
// @description  Adds a button near the action toolbar that clears Contact, Phone, and Email fields in one click. Robust to Follow/Unfollow text and class changes.
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'cw-clear-contact-btn';

  // ---------- utils ----------
  const $  = (s, r = document) => (r || document).querySelector(s);
  const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));
  const txt = (el) => (el && el.textContent || '').trim();

  function isInModal(el) {
    return !!(el && el.closest && el.closest('.cw-gxt-wnd'));
  }

  function ensureFlashStyles() {
    if (document.getElementById('cw-clear-flash-styles')) return;
    const css = document.createElement('style');
    css.id = 'cw-clear-flash-styles';
    css.textContent = `
      @keyframes cwFlashPulse { 0%{transform:scale(1)}50%{transform:scale(1.04)}100%{transform:scale(1)} }
      .cw-flash-pulse { animation: cwFlashPulse .35s ease-in-out; box-shadow: 0 0 0 2px rgba(59,130,246,.25) inset; border-radius: 6px; }
    `;
    document.head.appendChild(css);
  }

  function dispatchAll(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
  }

  // ---------- field clearing (classic + new skins) ----------
  function clearContactInfo() {
    // Contact (lookup input)
    const contact =
      $('input.cw_contact') ||
      $('[data-cwid="contact"] input[readonly]') ||
      $('[data-cwid="contact"] input');
    if (contact && !isInModal(contact)) { contact.value = ''; dispatchAll(contact); }

    // Email
    const email =
      $('input.cw_emailAddress') ||
      $('[data-cwid="email"] input[readonly]') ||
      $('[data-cwid="email"] input');
    if (email && !isInModal(email)) { email.value = ''; dispatchAll(email); }

    // Phone (classic comms block or new single field)
    const phoneCandidates = [
      '.cw_contactPhoneCommunications input[type="text"]',      // classic phone grid
      '[data-cwid="phone"] input[readonly]',                    // new skin readonly display
      '[data-cwid="phone"] input'                               // new skin editable
    ];
    const seen = new Set();
    phoneCandidates.forEach(sel => {
      $$(sel).forEach(inp => {
        if (isInModal(inp)) return;
        if (seen.has(inp)) return;
        seen.add(inp);
        inp.value = '';
        dispatchAll(inp);
      });
    });
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
    }, 900);
  }

  // ---------- button ----------
  function makeButton() {
    ensureFlashStyles();

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

    const handler = (e) => {
      e.preventDefault();
      clearContactInfo();
      flashCleared(btn, label);
    };
    outer.addEventListener('click', handler);
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler(e);
    });

    outer.title = 'Clear Contact, Phone, and Email';
    return outer;
  }

  // ---------- placement (robust to Follow/Unfollow + class changes) ----------
  function findToolbarButtonByName(name) {
    const want = String(name || '').trim().toLowerCase();
    const candidates = $$('.cw_CwActionButton, [role="button"], .mm_button, .gwt-Button');
    for (const c of candidates) {
      const label = (txt(c) || '').toLowerCase();
      const aria  = (c.getAttribute && c.getAttribute('aria-label') || '').toLowerCase();
      if (label === want || aria === want) return c.closest('.cw_CwActionButton') || c;
      // handle first-word exact match (e.g., "Follow" vs "Following")
      if (label.split(/\s+/)[0] === want) return c.closest('.cw_CwActionButton') || c;
    }
    return null;
  }

  function toolbarContainer() {
    // Prefer a parent that already contains action buttons
    const anyAction = $('.cw_CwActionButton');
    return anyAction ? anyAction.parentElement : null;
  }

  function placeButton() {
    if (document.getElementById(BTN_ID)) return true;

    // 1) Preferred: after Follow/Unfollow action by accessible name
    const follow = findToolbarButtonByName('follow') || findToolbarButtonByName('unfollow');
    if (follow && !isInModal(follow)) {
      follow.insertAdjacentElement('afterend', makeButton());
      return true;
    }

    // 2) Fallback: append at end of the toolbar row
    const row = toolbarContainer();
    if (row && !isInModal(row)) {
      row.appendChild(makeButton());
      return true;
    }

    return false;
  }

  // ---------- SPA safety / retries ----------
  function ensure() { try { placeButton(); } catch {} }

  const mo = new MutationObserver(() => ensure());
  mo.observe(document.documentElement, { subtree: true, childList: true });

  ['pushState', 'replaceState'].forEach(k => {
    const orig = history[k];
    history[k] = function () {
      const r = orig.apply(this, arguments);
      queueMicrotask(ensure);
      return r;
    };
  });
  window.addEventListener('popstate', ensure);

  // gentle retries for late toolbars
  setTimeout(ensure, 0);
  setTimeout(ensure, 250);
  setTimeout(ensure, 750);
  setTimeout(ensure, 1500);

  ensure();
})();
