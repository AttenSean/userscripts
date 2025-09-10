# Attentus Userscripts (ConnectWise)

A collection of quality-of-life userscripts for ConnectWise Manager (browser UI).  

Tested with Violentmonkey on Chromium-based browsers.

Provenance: Human-authored with AI assistance; human-reviewed.

> **Install**: Click a script’s **Raw** link below in your browser and your userscript manager should prompt to install.  
> **Auto-updates**: Each script includes `@downloadURL` and `@updateURL` that point to this repo’s `main` branch. Bump `@version` on changes.

---

## Scripts

- [**attentus-cw-clear-contact-button.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js)  
  Adds a *Clear Contact* button (next to Follow) that wipes Contact, Email, and Phone fields and shows a quick “Cleared” flash.

- [**attentus-cw-copy-discussion.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-discussion.user.js)  
  Adds a compact *Copy* button next to **New Note** on Service Tickets that copies all visible Discussion notes (Discussion/Internal/Resolution/All tabs).  
  Prepends a header with Ticket #, Company, and Contact. Copies both formatted text and plain text.

- [**attentus-cw-copy-ticket-link.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-link.user.js)  
  Adds a *Copy Ticket* button (next to Clear Contact) that copies a rich HTML link to the ticket (with a clean plain-text fallback). Shows a “Copied” flash.

- [**attentus-cw-copy-ticket-table.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-table.user.js)  
  Adds a blue *Copy Ticket Table* button in the Service Board toolbar (next to Open Calendar View / CLEAR) that copies a table of Ticket (link) + Summary + Company for all visible rows.

- [**attentus-cw-copy-timezest-link.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js)  
  Adds a *Copy TimeZest* button. Left-click copies Help-Desk Team link; **Shift+Click** copies personal link using stored First/Last name.  
  First use prompts for your name. Creates a 30-minute invite. Need other durations? Use the TimeZest pod in CW.

- [**attentus-cw-summary-tag-popup.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js)  
  Detects upcoming scheduled time on a ticket and offers a one-click Summary suffix: `<Sch m/d @ h:mmAM/PM>` or `<Rem m/d>` for date-only.  
  Popup appears near the top center and hides after use. Handles multiple future entries (chooses the soonest upcoming).

- [**attentus-cw-tab-title-normalize.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js)  
  Normalizes tab titles (e.g., fixes new *Time Entry* windows that default to Agreement) so tabs are easier to recognize.

- [**attentus-cw-ticket-open-in-new-tab.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-open-in-new-tab.user.js)  
  Converts ticket # cells into proper links that open in a new tab (v4_6 URL).

- [**attentus-cw-ticket-quick-nav-and-dedupe.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-nav-and-dedupe.user.js)  
  Adds a quick *Go to Ticket #* input + recent tickets menu, a left-side Tickets entry, and prevents duplicate tabs for the same ticket.

- [**attentus-cw-time-entry-clipboard-bar.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js)  
  Adds a compact clipboard bar to *Time Entry* for Copy Signature and Copy Review + Signature.  
  Includes a settings fly-out to customize name and review text, and optional location randomizer with default location choice.

- [**attentus-cw-time-entry-in-tab.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-in-tab.user.js)  
  Forces new *Time Entry* forms to open in their own tab for better multitasking.
  
- [**attentus-cw-ticket-quick-triage.user.js**](https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-triage.user.js)
  Adds a “Quick Triage:” bar with Junk and Spam/Phishing actions. Spam/Phishing sets Help Desk (if not already), MUST ASSIGN → Email → Spam/Phishing, Tier 1, SLA Low/Low → Priority 4, and Summary “Spam/Phishing (Contact)”. Shift+Click (opt-in) applies and Save & Close; Cancel fully reverts (incl. SLA). Hides on Project tickets


> If a script isn’t listed above but lives in this repo, it’s likely WIP or internal and may not include auto-update headers yet.

---

### Tampermonkey (official)
- Website: https://www.tampermonkey.net/
- Chrome Web Store: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
- Firefox Add-ons: https://addons.mozilla.org/firefox/addon/tampermonkey/
- Microsoft Edge Add-ons: https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd

### Violentmonkey (open source)
- Website: https://violentmonkey.github.io/
- GitHub: https://github.com/violentmonkey/violentmonkey
- Chrome Web Store: https://chrome.google.com/webstore/detail/violentmonkey/jinjaccalgkegednnccohejagnlnfdag
- Firefox Add-ons: https://addons.mozilla.org/firefox/addon/violentmonkey/
- Microsoft Edge Add-ons: https://microsoftedge.microsoft.com/addons/detail/violentmonkey/eeagobfjdenkkddmbclomhiblgggliao

> After installing a manager, open any `.user.js` file in this repo via the **Raw** link to install/update.

---

## How to install (Violentmonkey/Tampermonkey)

1. Install a userscript manager (Violentmonkey or Tampermonkey).
2. Click a **Raw** link above and accept the install prompt.
3. Visit ConnectWise; scripts matching `https://*.myconnectwise.net/*`, `https://*.connectwise.net/*`, or `https://*.myconnectwise.com/*` will run.

**Updating**  
- Updates are automatic (per manager settings) or can be forced via **Check for updates**.  
- We bump `@version` with each change—your manager detects that and pulls the latest from `@updateURL`.

---

## Configuration highlights

- **TimeZest link**
  - Left-click: copies **Help-Desk Team** (30-min) link.
  - **Shift+Click**: copies your **personal** (30-min) link: `https://attentus.timezest.com/{firstname}-{lastname}/phone-call-30/ticket/{####}`.
  - First use prompts for your name; Shift+Click again to update it later.
  - **Note:** If your TimeZest subdomain or the session slugs change (e.g., not `attentus.timezest.com` or not `phone-call-30`), update the base domain and session paths near the top of the script (the constants for base URL and slugs).

- **Time Entry Clipboard Bar**  
  - Settings fly-out lets you set **Display Name** and customize the **review** message lines (the Google review URLs remain fixed by location).  
  - **Location randomizer** can be toggled; if off, a **Default Location** selector is shown and used.

---

## Permissions & privacy

- These scripts run **locally** in your browser and do not send data to any server.  
- They only interact with the DOM on ConnectWise pages you’re already viewing.  
- Clipboard actions use the browser/manager clipboard APIs.

---

## Development

- Each script has metadata headers with `@namespace`, `@version`, `@match`, `@downloadURL`, `@updateURL`.
- When editing: increment `@version`, commit, push → users get the update on the next check.
- Keep filenames stable; the URLs in headers are **case-sensitive**.

### Local testing
- You can install directly from a local file during development, then switch to the GitHub **Raw** link for updates once pushed.

---

## Troubleshooting

- **No buttons appear?** Ensure you’re on a matching domain (`myconnectwise.net`, `connectwise.net`, or `myconnectwise.com`) and logged in. Some pages are SPA—allow a second for the mutation observer to place UI.
- **Clipboard blocked?** Some browsers require a user gesture. Try clicking the button again or allow clipboard permission.

---

## License

Licensed under the **MIT License**. See [LICENSE](./LICENSE).

© 2025 Sean Dill
