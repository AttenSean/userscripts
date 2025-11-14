// ==UserScript==
// @name         attentus-cw-clear-contact-button
// @namespace    https://github.com/AttenSean/userscripts
// @version      1.2.3
// @description  Adds a "Clear Contact" action on Ticket/Time Entry pages only, clears Contact, Email, and Phone fields. SPA-safe, mounts in header actions.
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

  // ---------- gating helpers ----------

  function isTimeSheet() {
    // Classic timesheet grids
    if (
      document.getElementById("mytimesheetdaygrid-listview-scroller") ||
      document.querySelector(".mytimesheetlist, .TimeSheet")
    ) {
      return true;
    }

    // Daily Time Entries navigation banner
    const navLabels = Array.from(
      document.querySelectorAll(
        ".navigationEntry.cw_CwLabel, .navigationEntry, .cw-main-banner .gwt-Label, .cw-main-banner .cw_CwLabel"
      )
    );
    if (
      navLabels.some((el) =>
        /daily\s+time\s+entries/i.test((el.textContent || "").trim())
      )
    ) {
      return true;
    }

    return false;
  }

  function isTimeEntryPage() {
    if (document.querySelector(".pod_timeEntryDetails")) return true;
    if (document.querySelector(".cw_ToolbarButton_TimeStamp")) return true;
    if (
      document.querySelector("input.cw_ChargeToTextBox") ||
      document.querySelector("input[id$='ChargeToTextBox']")
    ) {
      return true;
    }
    return false;
  }

  function isTicketPage() {
    if (isTimeSheet() || isTimeEntryPage()) return false;

    const href = (location.href || "").toLowerCase();
    const path = (location.pathname || "").toLowerCase();
    const search = location.search || "";

    // URL hints for ticket
    if (/[?&](service_recid|recid|serviceticketid|srrecid)=\d+/i.test(search)) {
      return true;
    }
    if (/connectwise\.aspx/.test(path)) {
      if (/\?\?[^#]*(ticket|service.?ticket)/i.test(href)) return true;
    }

    // Ticket pods present
    if (document.querySelector(".pod_ticketHeaderActions, .pod_ticketSummary")) {
      return true;
    }

    // Banner text, Service Ticket #
    if (
      [...document.querySelectorAll(".cw_CwLabel,.gwt-Label")]
        .some((el) => /service\s*ticket\s*#/i.test(el.textContent || ""))
    ) {
      return true;
    }

    return false;
  }

  function isTicketOrTimeEntryPage() {
    if (isTimeSheet()) return false; // hard block on any timesheet context, including Daily Time Entries
    if (isTimeEntryPage()) return true;
    if (isTicketPage()) return true;
    return false;
  }

  // ---- spacing normalization (replace old per-ID margin) ----
  (function ensureClearContactStyles() {
    if (document.getElementById('attentus-clear-contact-style')) return;
    const s = document.createElement('style');
    s.id = 'attentus-clear-contact-style';
    s.textContent = `
      /* zero ad hoc margins on our three actions */
      #cw-clear-contact-btn,
      #cw-copy-ticket-link-btn,
      #cw-copy-timezest-btn { margin: 0 !important; }

      /* consistent sibling spacing regardless of pod or bar */
      .pod_ticketHeaderActions .cw_CwActionButton + .cw_CwActionButton,
      .cw-CwActionButtons     .cw_CwActionButton + .cw_CwActionButton,
      .cw-CwActionBar         .cw_CwActionButton + .cw_CwActionButton,
      .mm_toolbar             .cw_CwActionButton + .cw_CwActionButton {
        margin-left: 6px !important;
      }

      /* stronger spacing for the HorizontalPanel action bar */
      .cw_CwHorizontalPanel > .cw_CwActionButton { margin-left: 6px !important; }
      .cw_CwHorizontalPanel > .cw_CwActionButton:first-of-type { margin-left: 0 !important; }

      /* physical spacer used when CW nukes margins in cw_CwHorizontalPanel */
      .att-action-spacer { display:inline-block; width:6px; height:1px; }
    `;
    document.head.appendChild(s);
  })();

  function spaRoot() {
    return (
      document.querySelector("#cwContent") ||
      document.querySelector(".cw-WorkspaceView") ||
      document.body
    );
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
        if (testFn()) {
          mountFn();
          return;
        }
      } catch (e) {
        log("ensureMounted error", e);
      }
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
    return (
      document.querySelector(".pod_ticketHeaderActions") ||
      document.querySelector(".cw-CwActionBar") ||
      document.querySelector(".cw-CwActionButtons") ||
      document.querySelector(".mm_toolbar") ||
      null
    );
  }

  function findHorizontalPanel() {
    return document.querySelector(".cw_CwHorizontalPanel");
  }

  function findAgeTable(panel) {
    if (!panel) return null;
    const ageDiv = panel.querySelector(".cw_CwHTML, .gwt-HTML.mm_label");
    if (ageDiv && /(^|\b)age:\s*/i.test((ageDiv.textContent || "").trim())) {
      return ageDiv.closest("table");
    }
    return null;
  }

  function lastNativeButton(panel) {
    if (!panel) return null;
    const natives = Array.from(
      panel.querySelectorAll(".cw_CwActionButton:not([data-origin='attentus'])")
    );
    return natives.length ? natives[natives.length - 1] : null;
  }

  function pickAfterAnchor(container) {
    const panel = findHorizontalPanel() || container;
    if (!panel) return null;

    const age = findAgeTable(panel);
    const nativeLast = lastNativeButton(panel);

    if (age && nativeLast) {
      // choose whichever is further to the right in DOM order
      return (age.compareDocumentPosition(nativeLast) & Node.DOCUMENT_POSITION_FOLLOWING)
        ? nativeLast
        : age;
    }
    return nativeLast || age || null;
  }

  // spacer utilities
  const isBtn = (el) =>
    el && el.classList && el.classList.contains("cw_CwActionButton");
  function makeSpacer() {
    const s = document.createElement("span");
    s.className = "att-action-spacer";
    return s;
  }
  function insertAfterWithSpacer(afterEl, node) {
    const parent = afterEl?.parentElement;
    if (!parent) return;
    let spacer = afterEl.nextSibling;
    if (
      !(
        spacer &&
        spacer.nodeType === 1 &&
        spacer.classList.contains("att-action-spacer")
      )
    ) {
      spacer = makeSpacer();
      parent.insertBefore(spacer, afterEl.nextSibling);
    }
    parent.insertBefore(node, spacer.nextSibling);
  }

  function findAnchor() {
    // Prefer the parent of any existing CW action button to land in the correct container
    const anyAction = document.querySelector(".cw_CwActionButton");
    if (anyAction && anyAction.parentElement) {
      return { container: anyAction.parentElement, before: null };
    }
    const pod = headerActionsPod();
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
      try {
        onRun();
      } catch (err) {
        console.error("[Clear Contact] click error", err);
      }
    };

    outer.addEventListener("pointerup", run, true);
    outer.addEventListener("click", run, true);
    outer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        run(e);
      }
    });

    return outer;
  }

  // ---- ordered mounting, Clear Contact should be left most of the three ----
  function mountIntoOrdered(container, node) {
    if (!container || !node) return;

    const afterAnchor = pickAfterAnchor(container);
    if (afterAnchor) {
      // Clear Contact should be first among Attentus, but still start after Age or native buttons
      insertAfterWithSpacer(afterAnchor, node);
    } else {
      // no anchor found, put at the very start
      container.insertBefore(node, container.firstChild);
    }
  }

  function clearContactFields() {
    const fireAll = (el) => {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      } catch {}
    };
    const clear = (el) => {
      if (!el || !("value" in el)) return false;
      const before = el.value;
      el.value = "";
      fireAll(el);
      return !!before;
    };

    let did = false;

    // CONTACT
    const contactLegacy = document.querySelector("input.cw_contact");
    if (clear(contactLegacy)) did = true;

    [
      'input[aria-label="Contact"]',
      'input[id*="Contact"][role="combobox"]',
      'input[name="ContactRecID"]',
    ].forEach((sel) =>
      document.querySelectorAll(sel).forEach((el) => {
        if (clear(el)) did = true;
      })
    );

    // EMAIL
    const emailLegacy = document.querySelector("input.cw_emailAddress");
    if (clear(emailLegacy)) did = true;

    ['input[aria-label="Email"]', 'input[name="EmailAddress"]'].forEach((sel) =>
      document.querySelectorAll(sel).forEach((el) => {
        if (clear(el)) did = true;
      })
    );

    // PHONE (number + extension)
    const phoneBlock = document.querySelector(".cw_contactPhoneCommunications");
    if (phoneBlock) {
      phoneBlock
        .querySelectorAll('input[type="text"]')
        .forEach((inp) => {
          if (clear(inp)) did = true;
        });
    }
    [
      'input[aria-label="Phone"]',
      'input[name="PhoneNumber"]',
      'input[aria-label*="Ext"]',
      'input[name*="Ext"]',
    ].forEach((sel) =>
      document.querySelectorAll(sel).forEach((el) => {
        if (clear(el)) did = true;
      })
    );

    if (!did) {
      console.warn(
        "[Clear Contact] No matching fields found to clear on this layout"
      );
    }
  }

  // ---- mount ----
  function addButton() {
    if (document.getElementById(BTN_ID)) return;
    const spot = findAnchor();
    if (!spot || !spot.container) return AttentusCW.log("Clear Contact: no anchor");

    const button = makeActionButton(clearContactFields);
    mountIntoOrdered(spot.container, button);
    AttentusCW.log("Clear Contact mounted (ordered)", { container: spot.container });
  }

  function tryMount() {
    if (!AttentusCW.isTicketOrTimeEntryPage()) return;

    AttentusCW.ensureMounted(
      () =>
        !!document.querySelector(".cw_CwActionButton") ||
        !!document.querySelector(
          ".pod_ticketHeaderActions,.cw-CwActionBar,.cw-CwActionButtons,.mm_toolbar"
        ),
      () => addButton(),
      { attempts: 80, delay: 150 }
    );
  }

  tryMount();
  AttentusCW.observeSpa(tryMount);

  /* Selectors QA, Clear Contact button, Ticket and Time Entry
     Gating
       - Uses AttentusCW.isTicketOrTimeEntryPage()
       - Hard block on:
         - Classic timesheets: #mytimesheetdaygrid-listview-scroller, .mytimesheetlist, .TimeSheet
         - Daily Time Entries: any .navigationEntry or banner label with text "Daily Time Entries"
     Ticket detection
       - URL params: ?service_recid=, ?recid=, ?serviceticketid=, ?srrecid=
       - connectwise.aspx with encoded "ticket" or "service ticket" in hash query
       - Pods: .pod_ticketHeaderActions, .pod_ticketSummary
       - Banner labels containing "Service Ticket #"
     Time Entry detection
       - .pod_timeEntryDetails
       - .cw_ToolbarButton_TimeStamp
       - input.cw_ChargeToTextBox or input[id$="ChargeToTextBox"]
     Must not fire on
       - Any timesheet context including Daily Time Entries
       - (Modal windows would be handled by separate checks if needed)
     Anchor region
       - Observer root: #cwContent, .cw-WorkspaceView, or body
       - Container: .pod_ticketHeaderActions, .cw-CwActionBar, .cw-CwActionButtons, .mm_toolbar
     Placement
       - Button mounts after Age or last native CW action
       - Clear Contact is left most among Attentus actions, spacing via .att-action-spacer
  */
})();
