// ==UserScript==
// @name         attentus-cw-clear-contact-button
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.2.1
// @description  Adds a “Clear Contact” action on Ticket/Time Entry pages only; clears Contact, Email, and Phone fields. SPA-safe; mounts in header actions.
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

/* ==Shared Core (inline) == */
const AttentusCW = (() => {
  const DEBUG = !!localStorage.getItem("attentus-debug");
  const log = (...a) => DEBUG && console.log("[AttentusCW]", ...a);

  function isTicketOrTimeEntryPage() {
    const href = (location.href || "").toLowerCase();
    const path = (location.pathname || "").toLowerCase();
    const search = location.search || "";

    if (/[?&](service_recid|recid|serviceticketid)=\d+/i.test(search)) return true;
    if (/connectwise\.aspx/.test(path)) {
      if (/\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;
      if (/\?\?[^#]*timeentry/i.test(href)) return true;
    }
    if (document.querySelector(".pod_ticketHeaderActions, .pod_ticketSummary")) return true;
    if ([...document.querySelectorAll(".cw_CwLabel,.gwt-Label")]
        .some(el => /service\s*ticket\s*#/i.test(el.textContent || ""))) return true;
    if (document.querySelector(".pod_timeEntryDetails, input.cw_ChargeToTextBox, input[id$='ChargeToTextBox']")) return true;

    if (document.getElementById("mytimesheetdaygrid-listview-scroller")) return false;
    return false;
  }

(function ensureClearContactStyles(){
  if (document.getElementById('attentus-clear-contact-style')) return;
  const s = document.createElement('style');
  s.id = 'attentus-clear-contact-style';
  s.textContent = `
    #cw-clear-contact-btn { margin-right: 6px; } /* space before ScreenConnect */
  `;
  document.head.appendChild(s);
})();



  function spaRoot() {
    return document.querySelector("#cwContent") ||
           document.querySelector(".cw-WorkspaceView") ||
           document.body;
  }

  function observeSpa(callback) {
    const root = spaRoot();
    if (!root) return;
    const mo = new MutationObserver(() => callback());
    mo.observe(root, { childList: true, subtree: true });
    window.addEventListener("popstate", callback, { passive: true });
    window.addEventListener("hashchange", callback, { passive: true });
    return mo;
  }

  function ensureMounted(testFn, mountFn, opts = {}) {
    const { attempts = 40, delay = 200 } = opts;
    let tries = 0;
    const loop = () => {
      try {
        if (testFn()) { mountFn(); return; }
      } catch (e) { log("ensureMounted error", e); }
      if (++tries < attempts) setTimeout(loop, delay);
    };
    loop();
  }

  return { log, isTicketOrTimeEntryPage, observeSpa, ensureMounted, spaRoot };
})();

/* == Script: Clear Contact == */
(function () {
  "use strict";

  const BTN_ID = "cw-clear-contact-btn";

  // ---- placement helpers (broadened) ----
  function headerActionsPod() {
    // cover multiple skins/layouts
    return (
      document.querySelector(".pod_ticketHeaderActions") ||
      document.querySelector(".cw-CwActionBar") ||
      document.querySelector(".cw-CwActionButtons") ||
      document.querySelector(".mm_toolbar") ||
      null
    );
  }

function findAnchor() {
  // Prefer to colocate with our own buttons if present
  const ourBefore =
    document.getElementById('cw-copy-ticket-link-btn') ||
    document.getElementById('cw-copy-timezest-btn');

  if (ourBefore && ourBefore.parentElement) {
    return { container: ourBefore.parentElement, before: ourBefore }; // insert before for left-to-right ordering
  }

  // Otherwise, use any existing CW action button as the “before” point
  const anyAction = document.querySelector('.cw_CwActionButton');
  if (anyAction && anyAction.parentElement) {
    return { container: anyAction.parentElement, before: anyAction };
  }

  // Last resort: fall back to broader toolbars if present
  const pod =
    document.querySelector('.pod_ticketHeaderActions') ||
    document.querySelector('.cw-CwActionBar') ||
    document.querySelector('.cw-CwActionButtons') ||
    document.querySelector('.mm_toolbar') ||
    null;

  return pod ? { container: pod, before: null } : null;
}



function makeActionButton(onRun) {
  const outer = document.createElement("div");
  outer.className = "GMDB3DUBHFJ GMDB3DUBAQG GMDB3DUBOFJ cw_CwActionButton";
  outer.id = "cw-clear-contact-btn";
  outer.setAttribute("data-origin", "attentus");
  outer.tabIndex = 0;

  const btn = document.createElement("div");
  btn.className = "GMDB3DUBIOG mm_button";
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", "Clear Contact");
  btn.title = "Clear contact, email, and phone fields";

  const inner = document.createElement("div");
  inner.className = "GMDB3DUBJOG GMDB3DUBNQG";

  const label = document.createElement("div");
  label.className = "GMDB3DUBBPG";
  label.textContent = "Clear Contact";

  inner.appendChild(label);
  btn.appendChild(inner);
  outer.appendChild(btn);

  const run = (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { onRun(); } catch (err) { console.error("[Clear Contact] click error", err); }
  };

  // Bind on OUTER in capture phase to beat toolbar delegates
  outer.addEventListener("pointerup", run, true);
  outer.addEventListener("click", run, true);
  outer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); run(e); }
  });

  return outer;
}


  function insertAfterLast(container, node) {
    container.appendChild(node);
  }

function clearContactFields() {
  // Fire the events CW listens for
  const fireAll = (el) => {
    try {
      el.dispatchEvent(new Event('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur',   { bubbles: true }));
    } catch {}
  };
  const clear = (el) => {
    if (!el || !('value' in el)) return false;
    const before = el.value;
    el.value = '';
    fireAll(el);
    return !!before;
  };

  let did = false;

  // ---------- CONTACT ----------
  // Original working selector (legacy CW)
  const contactLegacy = document.querySelector('input.cw_contact');
  if (clear(contactLegacy)) did = true;

  // Newer/fallback selectors
  ['input[aria-label="Contact"]',
   'input[id*="Contact"][role="combobox"]',
   'input[name="ContactRecID"]'
  ].forEach(sel => document.querySelectorAll(sel).forEach(el => { if (clear(el)) did = true; }));

  // ---------- EMAIL ----------
  const emailLegacy = document.querySelector('input.cw_emailAddress');
  if (clear(emailLegacy)) did = true;

  ['input[aria-label="Email"]','input[name="EmailAddress"]']
    .forEach(sel => document.querySelectorAll(sel).forEach(el => { if (clear(el)) did = true; }));

  // ---------- PHONE (number + extension) ----------
  // Original working container (legacy CW)
  const phoneBlock = document.querySelector('.cw_contactPhoneCommunications');
  if (phoneBlock) {
    phoneBlock.querySelectorAll('input[type="text"]').forEach(inp => { if (clear(inp)) did = true; });
  }
  // Fallbacks if layout changes later
  ['input[aria-label="Phone"]','input[name="PhoneNumber"]','input[aria-label*="Ext"]','input[name*="Ext"]']
    .forEach(sel => document.querySelectorAll(sel).forEach(el => { if (clear(el)) did = true; }));

  if (!did) {
    console.warn('[Clear Contact] No matching fields found to clear on this layout');
  }
}



  // ---- mount ----
function addButton() {
  if (document.getElementById(BTN_ID)) return;
  const spot = findAnchor();
  if (!spot || !spot.container) return AttentusCW.log('Clear Contact: no anchor');

  const button = makeActionButton(clearContactFields);

  if (spot.before && spot.before.parentElement === spot.container) {
    spot.container.insertBefore(button, spot.before);
  } else {
    spot.container.appendChild(button);
  }
  AttentusCW.log('Clear Contact mounted', { container: spot.container, before: !!spot.before });
}



function tryMount() {
  if (!AttentusCW.isTicketOrTimeEntryPage()) return;

  AttentusCW.ensureMounted(
    () => !!document.querySelector('.cw_CwActionButton') || !!document.querySelector('.pod_ticketHeaderActions,.cw-CwActionBar,.cw-CwActionButtons,.mm_toolbar'),
    () => addButton(),
    { attempts: 80, delay: 150 }
  );
}




  tryMount();
  AttentusCW.observeSpa(tryMount);

  /* Selectors QA — Ticket / Time Entry
     Gating: URL id params or connectwise.aspx??ticket/timeentry OR pods .pod_ticketHeaderActions/.pod_ticketSummary/.pod_timeEntryDetails
     Must-not-fire: #mytimesheetdaygrid-listview-scroller, .cw-gxt-wnd
     Anchor: .pod_ticketHeaderActions | .cw-CwActionBar | .cw-CwActionButtons | .mm_toolbar (or parent of Follow)
     Placement: append to the action container
  */
})();
