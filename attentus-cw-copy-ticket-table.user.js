// ==UserScript==
// @name         attentus-cw-copy-ticket-table  deprecated, forwards to Teams Shoutout
// @namespace    https://github.com/AttenSean/userscripts
// @version      99.0.0
// @description  Deprecated, this script now forwards to attentus-cw-teams-shoutout
// @match        https://*.myconnectwise.net/*
// @match        https://*.connectwise.net/*
// @match        https://*.myconnectwise.com/*
// @run-at       document-idle
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_getValue
// @grant        GM.setValue
// @noframes
// @require      https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-teams-shoutout.user.js
// ==/UserScript==
(function() {
  'use strict';
  // soft notice once per browser
  var KEY = 'att_cw_copy_table_deprecated_notice_shown';
  var shown = false;
  try { shown = (typeof GM_getValue === 'function' ? GM_getValue(KEY, false) : false); } catch(e){}
  if (!shown) {
    try {
      var n = document.createElement('div');
      n.textContent = 'Heads up, Copy Ticket Table was replaced by Teams Shoutout. This is a forwarding shim.';
      var s = n.style; s.position='fixed'; s.right='16px'; s.bottom='70px'; s.zIndex=2147483646; s.background='#0b0f17'; s.color='#e5e7eb';
      s.padding='8px 10px'; s.borderRadius='10px'; s.border='1px solid #1f2937'; s.font='12px system-ui';
      document.body.appendChild(n); setTimeout(function(){ if(n && n.remove) n.remove(); }, 2500);
      if (typeof GM_setValue === 'function') GM_setValue(KEY, true);
    } catch(e){}
  }
})();
