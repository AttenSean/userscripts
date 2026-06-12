# Helpdesk Toolkit manual pilot checklist

Pilot `attentus-cw-helpdesk-toolkit.user.js` in ConnectWise with the legacy/original userscripts still installed but disabled one at a time. The toolkit must stay browser-UI/clipboard-only: do not add or exercise any ConnectWise or ITGlue API write behavior.

## Pilot metadata

| Item | Value |
| --- | --- |
| Pilot date |  |
| Tester |  |
| ConnectWise site / company |  |
| Browser + version |  |
| Userscript manager + version |  |
| Toolkit version |  |
| Original script disabled for this run |  |
| Test ticket IDs / board views used |  |

## Read-only and safety guardrails

- [ ] Confirm `attentus-cw-helpdesk-toolkit.user.js` is enabled.
- [ ] Confirm the original script being replaced for the current scenario is installed but disabled.
- [ ] Confirm any other original scripts that are not under test are left in their normal pilot state.
- [ ] Use disposable/test tickets for any Save or Save & Close validation.
- [ ] Do not inspect, create, or modify ConnectWise or ITGlue data through API routes.
- [ ] Do not add POST, PUT, PATCH, or DELETE API routes or calls.
- [ ] For mutating UI tests, stop at Revert or Leave Unsaved unless the row explicitly calls for Save or Save & Close.
- [ ] If a selector or mount gate fails, record it in the failure log below before patching.

## Browser setup

1. Open the userscript manager dashboard.
2. Enable `attentus-cw-helpdesk-toolkit.user.js`.
3. Disable one original script at a time for the matching scenario:
   - `attentus-cw-copy-ticket-link.user.js`
   - `attentus-cw-clear-contact-button.user.js`
   - `attentus-cw-ticket-quick-triage.user.js`
   - `attentus-cw-time-entry-clipboard-bar.user.js`
   - `attentus-cw-teams-shoutout.user.js`
   - `attentus-cw-tab-title-normalize.user.js`
4. Reload the ConnectWise page after each enable/disable change.
5. Optional diagnostics: set `localStorage.setItem('attentus-debug', '1')` and reload to enable toolkit console logs. Clear it with `localStorage.removeItem('attentus-debug')` after the pilot.

## 1. Service Ticket copy and contact actions

Prerequisite: open a normal Service Ticket, not a Project Ticket.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm the `Helpdesk:` group appears near ticket actions. | Group appears only on the ticket page. | [ ] |  |
| Click `Copy Ticket`. | Clipboard contains a formatted ticket link using the current ticket number/summary when available. | [ ] |  |
| Click `URL`. | Clipboard contains only the canonical Service Ticket URL. | [ ] |  |
| Click `Copy Contact`. | Clipboard contains available Contact, Email, Phone, and Company lines. | [ ] |  |
| Click `Clear Contact…`, then `Cancel`. | No visible Contact/Email/Phone/Ext field changes occur. | [ ] |  |
| Click `Clear Contact…`, then `Clear Fields`. | Visible Contact/Email/Phone/Ext fields clear in the browser UI only, and the post-action modal appears. | [ ] |  |
| Click `Revert`. | All captured Contact/Email/Phone/Ext field values return to their original values. | [ ] |  |
| Navigate away and back. | No duplicate `Helpdesk:` groups appear. | [ ] |  |

## 2. Service Ticket triage actions

Prerequisite: use disposable/test Service Tickets. Confirm exact initial field values before every test.

### 2.1 Spam/Phish

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Click `Apply Spam/Phish…`, then `Cancel`. | No field changes occur. | [ ] |  |
| Click `Apply Spam/Phish…`, then `Copy Draft Only`. | Clipboard contains a triage draft and planned field values. | [ ] |  |
| Click `Apply Spam/Phish…`, then `Apply Fields`. | Visible fields update to Board `Help Desk`, Status `MUST ASSIGN`, Type `Email`, Subtype `Spam/Phishing`, Ticket Tier `Tier 1`, Priority `Priority 4`, and Summary `Spam/Phishing (...)` where contact is known. | [ ] | `fieldElement` keys to watch: `board`, `status`, `type`, `subtype`, `tier`, `priority`, `summary`. |
| Click `Revert` in the post-action modal. | Captured fields return to their pre-test values. | [ ] |  |

### 2.2 Junk

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Click `Apply Junk…`, then `Apply Fields`. | Visible Board field changes to `Junk` and post-action modal appears. | [ ] | `fieldElement` key to watch: `board`. |
| Click `Leave Unsaved`. | Modal closes; visible UI changes remain unsaved for manual review. | [ ] |  |
| Use ConnectWise native controls or reload without saving to reset the disposable ticket before continuing. | Ticket returns to a known state. | [ ] |  |

### 2.3 Closed/Cancelled

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Click `Apply Closed/Cancelled…`, then `Apply Fields`. | Visible Status changes to `>Closed/Cancelled`, Ticket Tier changes to `N/A - Cancelled Ticket`, and post-action modal appears. | [ ] | `fieldElement` keys to watch: `status`, `tier`. |
| Click `Save` on a disposable ticket. | ConnectWise Save is invoked only after this explicit second click. | [ ] |  |
| Repeat on another disposable ticket and click `Save & Close`. | ConnectWise Save & Close is invoked only after this explicit second click. | [ ] |  |

## 3. Project Ticket gates

Prerequisite: open a Project Ticket.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm the `Helpdesk:` group, if present, only shows non-mutating copy controls. | `Clear Contact…`, `Apply Spam/Phish…`, `Apply Junk…`, and `Apply Closed/Cancelled…` do not appear. | [ ] | Patch `isCanonicalServiceTicketPage()`, `isProjectTicket()`, or `ensureTicketTools()` if mutating controls appear. |
| Try SPA navigation from Service Ticket to Project Ticket. | Mutating Service Ticket controls disappear. | [ ] |  |

## 4. Time Entry standalone clipboard tools

Prerequisite: open a standalone Time Entry page/form, not Time Sheets.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm the `Clipboard:` group appears near the notes/timestamp controls. | Group appears once in the Time Entry form. | [ ] | Patch `isTimeEntryContext()` or `findTimeEntryMount()` if missing/misplaced. |
| Click `Copy signature`. | Clipboard contains the configured signature. | [ ] |  |
| Select a review location and click `Copy review + signature`. | Clipboard contains review request text/link plus signature. | [ ] |  |
| Open `⚙`, change name, location, randomization, and spaced thank-you, then Save. | Toast confirms settings saved. | [ ] |  |
| Reload Time Entry. | Saved settings persist and affect future clipboard output. | [ ] |  |

## 5. Ticket thread time entry clipboard placement

Prerequisite: open a Service Ticket with the ticket thread/auto time entries area visible.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm `Clipboard:` appears on the Thread / Auto Time Entries header or associated time-entry area. | Clipboard bar is attached to the ticket thread time-entry mount, not the main ticket toolbar. | [ ] | Patch `threadTimepadMountTarget()`, `isTicketThreadTimeContext()`, or `findTimeEntryMount()` if missing/misplaced. |
| Click signature and review buttons. | Clipboard output matches the standalone Time Entry behavior. | [ ] |  |
| Collapse/expand the thread pod or navigate within the ticket. | The bar remains single-instance and properly placed. | [ ] |  |

## 6. Time Sheets exclusion

Prerequisite: open Time Sheets / Daily Time Entries.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm no `Clipboard:` group appears. | Time Sheets never shows the Time Entry clipboard bar. | [ ] | Patch `isTimeSheetContext()` if the bar appears. |
| Navigate from Time Sheets to standalone Time Entry. | `Clipboard:` appears only after reaching the Time Entry context. | [ ] |  |
| Navigate back to Time Sheets. | `Clipboard:` disappears. | [ ] |  |

## 7. Service Board mapping and clipboard output

Prerequisite: open a Service Board view with visible rows including, if possible, P0, P1, and P2 tickets.

| Step | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Confirm the `HD Board:` group appears near the board view selector. | Board toolbar contains `Health Update`, `Shoutout`, `P0-P2`, and `Setup Mapping`. | [ ] | Patch `isBoard()`, `getViewInput()`, or `ensureBoardTools()` if missing/misplaced. |
| Click `Setup Mapping`. | Mapping modal opens with column options from visible `td[cellindex]` cells. | [ ] | Patch `boardColumns()` if columns are missing. |
| Map Ticket #, Priority, Summary, Company, Contact, Status, and Resource. Save mapping. | Toast confirms mapping saved per host and exact view name. | [ ] |  |
| Click `Health Update`. | Clipboard contains board health summary with unassigned counts and response counts. | [ ] | Patch `ticketFromRow()` or priority detection if output is wrong. |
| Click `Shoutout`. | Clipboard contains overview plus notable mapped tickets. | [ ] |  |
| Click `P0-P2`. | Clipboard contains only P0, P1, and P2 mapped tickets. | [ ] | Patch `priorityFromText()`, `priorityFromRgb()`, or `readPriorityFromCell()` if priority buckets are wrong. |
| Change to another board view and back. | Mapping is scoped to host + exact view name; no stale mapping is silently reused for a different view. | [ ] |  |

## 8. SPA navigation and stale group cleanup

Run these transitions without full browser reload where ConnectWise supports SPA navigation.

| Transition | Expected result | Pass | Notes / failed selectors |
| --- | --- | --- | --- |
| Service Ticket → Service Board | `Helpdesk:` disappears; `HD Board:` appears. | [ ] |  |
| Service Board → standalone Time Entry | `HD Board:` disappears; `Clipboard:` appears. | [ ] |  |
| standalone Time Entry → Time Sheets | `Clipboard:` disappears. | [ ] |  |
| Time Sheets → non-ticket page | No toolkit groups appear unless the page context is supported. | [ ] |  |
| non-ticket page → Service Ticket | Correct `Helpdesk:` group appears once. | [ ] |  |
| Service Ticket → Project Ticket | Service Ticket mutating controls disappear. | [ ] |  |
| Project Ticket → Service Ticket | Service Ticket mutating controls reappear only on a canonical Service Ticket. | [ ] |  |

## Failed selector / mount-gate log

Use this table to record every failure before patching `fieldElement(key)`, board mapping, or mount gates.

| Timestamp | Scenario | Page URL / ticket / view | Expected control/field | Actual behavior | Failed selector or gate | DOM clue / replacement selector | Patch area | Retest pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  | `fieldElement(key)` / board mapping / mount gate | [ ] |
|  |  |  |  |  |  |  | `fieldElement(key)` / board mapping / mount gate | [ ] |
|  |  |  |  |  |  |  | `fieldElement(key)` / board mapping / mount gate | [ ] |

## Patch targets when failures are found

- `fieldElement(key)` / `resolveFieldElement(key)`: patch when ticket triage fields are not found or the wrong visible input is changed.
- `FIELD_SELECTORS`: add stable selectors for Board, Status, Type, Subtype, Priority, Summary, or Ticket Tier after confirming they only match visible Service Ticket fields.
- `findInputNearLabelResult(labelText)`: patch if ConnectWise label/input structure changed.
- `contactTargets()`: patch if Clear Contact misses or overmatches Contact, Email, Phone, or Ext fields.
- Board mapping helpers: patch `isBoard()`, `getViewInput()`, `boardColumns()`, `ticketFromRow()`, or priority readers when board buttons, mappings, or P0-P2 output fail.
- Mount gates: patch `isCanonicalServiceTicketPage()`, `isProjectTicket()`, `isTimeEntryContext()`, `isTimeSheetContext()`, `isTicketThreadTimeContext()`, `threadTimepadMountTarget()`, or `pageContextSig()` when stale or wrong groups appear.

## Release readiness

- [ ] All checklist rows pass, or every failure is logged with a patch/retest plan.
- [ ] No direct ConnectWise or ITGlue API write behavior was added.
- [ ] Save and Save & Close still require explicit second-step user clicks after UI field changes.
- [ ] `node --check attentus-cw-helpdesk-toolkit.user.js` passes.
- [ ] Static scan for direct network/API write behavior has no matches or every match has documented human approval.
