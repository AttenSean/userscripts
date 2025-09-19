// ==UserScript==
// @name         sophos-central-customers-click-launch
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.3.0
// @description  Click a customer name to immediately launch that customer (auto-select row; skip flyout). Shift+Click to open the original flyout.
// @match        https://*.sophos.com/*
// @match        https://*.sophos-central.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/sophos-central-customers-click-launch.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/sophos-central-customers-click-launch.user.js
// ==/UserScript==

(function () {
  'use strict';

  const T_LAUNCH = /launch\s+customer/i;

  function until(fn, { interval = 80, timeout = 4000 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      (function tick() {
        try {
          const v = fn();
          if (v) return resolve(v);
        } catch (_) {}
        if (Date.now() - start > timeout) return reject(new Error('timeout'));
        setTimeout(tick, interval);
      })();
    });
  }

  function findLaunchButton() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a.button'));
    const matches = candidates.filter(el => {
      const text = (el.textContent || '').trim();
      return text && T_LAUNCH.test(text);
    });
    return matches.find(isVisible) || null;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return !!(rect.width && rect.height) && getComputedStyle(el).visibility !== 'hidden';
  }

  function simulateSelectRow(row) {
    const opts = { bubbles: true, cancelable: true, view: window };
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      row.dispatchEvent(new MouseEvent(type, opts));
    });
  }

  async function selectAndLaunch(row) {
    simulateSelectRow(row);
    await new Promise(r => setTimeout(r, 120));
    let btn = findLaunchButton() || await until(() => findLaunchButton()).catch(() => null);
    if (!btn) return;
    if (btn.disabled) {
      await until(() => !btn.disabled).catch(() => {});
    }
    btn.click();
    // Fallback: try an actionable parent if nothing fired
    setTimeout(() => {
      if (document.activeElement === btn) return;
      const parentButton = btn.closest('[class*="toolbar"], [class*="actions"], [role="button"]');
      if (parentButton && parentButton !== btn) parentButton.click();
    }, 300);
  }

  function onCaptureClick(e) {
    const name = e.target.closest('td[id^="customers-table-name-"] .customer-name');
    if (!name) return;

    // Preserve original descriptor flyout on Shift+Click
    if (e.shiftKey) {
      // Allow the native handlers to proceed
      return;
    }

    const row = name.closest('tr[id^="customers-table-body-row-"]');
    if (!row) return;

    // Block native click to avoid the flyout and do instant launch
    e.preventDefault();
    e.stopImmediatePropagation();

    selectAndLaunch(row).catch(() => {});
  }

  // Capture-phase listener so we can suppress the flyout when needed
  window.addEventListener('click', onCaptureClick, true);

  // UX: hint that Shift+Click shows details
  const style = document.createElement('style');
  style.textContent = `
    td[id^="customers-table-name-"] .customer-name {
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
  `;
  document.documentElement.appendChild(style);

  // Add a title hint lazily (works across SPA renders)
  const observer = new MutationObserver(() => {
    document.querySelectorAll('td[id^="customers-table-name-"] .customer-name:not([data-sccl-hinted])')
      .forEach(el => {
        el.setAttribute('title', 'Click: Launch customer • Shift+Click: Show details');
        el.setAttribute('data-sccl-hinted', '1');
      });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  // Run once immediately
  document.dispatchEvent(new Event('DOMContentLoaded'));
})();
