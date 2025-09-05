// ==UserScript==
// @name         attentus-cw-time-entry-in-tab
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.1
// @description  Force ConnectWise popups to open in tabs instead of new windows
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @grant        none
// @run-at       document-start
// @downloadURL  https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-in-tab.user.js
// @updateURL    https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-in-tab.user.js
// ==/UserScript==


(function () {
  'use strict';

  // Keep a bound reference to the original open so we do not recurse
  const origOpen = window.open.bind(window);

  // Helper, decide if we should intercept
  function isTimeEntryUrl(u) {
    if (!u) return false;
    try {
      const url = new URL(u, location.href);
      const path = url.pathname.toLowerCase();
      const qs = url.search.toLowerCase();
      return (
        path.includes('time') ||
        path.includes('timeentry') ||
        qs.includes('time') ||
        qs.includes('timeentry')
      );
    } catch {
      // If it is a weird relative string, fall back to a simple test
      const s = String(u).toLowerCase();
      return s.includes('time') || s.includes('timeentry');
    }
  }

  window.open = function (url, name, features) {
    try {
      if (isTimeEntryUrl(url)) {
        // Force a tab, not a popup
        return origOpen(url, '_blank');
      }
      // Let other popups behave normally
      return origOpen(url, name, features);
    } catch (e) {
      // Safety net, do not break CW
      return origOpen(url, name, features);
    }
  };
})();
