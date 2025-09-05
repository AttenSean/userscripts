# Attentus Userscripts (ConnectWise)

A collection of quality-of-life userscripts for ConnectWise Manager (browser UI).  

Tested with Violentmonkey/Tampermonkey on Chromium-based browsers.

Provenance: Human-authored with AI assistance; human-reviewed.


> **Install**: Click a script’s **Raw** link below in your browser and your userscript manager should prompt to install.  
> **Auto-updates**: Each script includes `@downloadURL` and `@updateURL` that point to this repo’s `main` branch. Bump `@version` on changes.

---

## Scripts

| File | What it does | Install / Raw |
|---|---|---|
| `attentus-cw-clear-contact-button.user.js` | Adds **Clear Contact** button (next to **Follow**) that wipes Contact, Email, and Phone fields and shows a quick *Cleared* flash. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-clear-contact-button.user.js |
| `attentus-cw-copy-ticket-link.user.js` | Adds **Copy Ticket** button (next to Clear Contact) that copies a **rich HTML link** to the ticket (with a clean plain-text fallback). Shows a *Copied* flash. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-link.user.js |
| `attentus-cw-copy-timezest-link.user.js` | **Copy TimeZest** button. Left-click copies Help-Desk Team link; **Shift+Click** copies personal link using stored First/Last name. First use prompts for your name. Creates a **30-minute** invite. Need other durations? Use the TimeZest pod in CW. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-timezest-link.user.js |
| `attentus-cw-summary-tag-popup.user.js` | Detects upcoming scheduled time on a ticket and offers a one-click **Summary** suffix: `<Sch m/d @ h:mmAM/PM>` or `<Rem m/d>` for date-only. Popup appears near the top center and hides after use. Handles multiple future entries (chooses the soonest upcoming). | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-summary-tag-popup.user.js |
| `attentus-cw-tab-title-normalize.user.js` | Normalizes tab titles (e.g., fixes new “Time Entry” windows that default to *Agreement*) so tabs are easy to recognize. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-tab-title-normalize.user.js |
| `attentus-cw-ticket-quick-nav-and-dedupe.user.js` | Quick “Go to Ticket #” input + recent tickets, adds a left-side Tickets menu entry, and prevents duplicate tabs for the same ticket. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-ticket-quick-nav-and-dedupe.user.js |
| `attentus-cw-time-entry-clipboard-bar.user.js` | Adds a compact **clipboard bar** to Time Entry for **Copy Signature** and **Copy Review + Signature**. Includes a settings fly-out to customize name and review text, and optional location randomizer with default location choice. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-clipboard-bar.user.js |
| `attentus-cw-time-entry-in-tab.user.js` | Forces new Time Entry forms to open in their own tab for better multitasking. | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-time-entry-in-tab.user.js |
| `attentus-cw-copy-ticket-in-new-tab.user.js` | When you click **Copy** on a Service Ticket, it opens the **new copy** in a **new tab** (keeps your original ticket open). | https://raw.githubusercontent.com/AttenSean/userscripts/main/attentus-cw-copy-ticket-in-new-tab.user.js |

> If a script isn’t listed above but lives in this repo, it’s likely WIP or internal and may not include auto-update headers yet.

---

## How to install (Violentmonkey/Tampermonkey)

1. Install a userscript manager (Violentmonkey or Tampermonkey).
2. Click a **Raw** link above and accept the install prompt.
3. Visit ConnectWise; scripts matching `https://*.myconnectwise.net/*` or `https://*.connectwise.net/*` will run.

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

- **No buttons appear?** Ensure you’re on a matching domain (`myconnectwise.net` or `connectwise.net`) and logged in. Some pages are SPA—allow a second for the mutation observer to place UI.
- **Clipboard blocked?** Some browsers require a user gesture. Try clicking the button again or allow clipboard permission.

---

## License

Licensed under the **MIT License**. See [LICENSE](./LICENSE).

© 2025 Sean Dill
