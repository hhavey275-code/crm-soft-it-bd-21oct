I understand — the last update is still showing the old visible limit (250), sync is fragile when switching tabs, and cards are not reliably reaching the CRM. I will change the approach from “Graph API only” to a SMIT-style billing-page reader, because the screenshot proves the real values are available in the rendered Facebook Billing UI.

Plan:

1. Upgrade extension to v1.4.0 with a billing-page live panel
   - Inject a right-side CRM panel on Facebook Billing pages, similar to the SMIT panel.
   - Show live parsed values beside the ad account:
     - Account status
     - Visible limit
     - Hidden daily limit
     - Billing threshold
     - Balance / outstanding balance
     - Total spending
     - Account type
     - Timezone
     - Payment methods, including default and backup cards
     - Card expiry when visible
     - Payment method remove button
   - Add clear sync status inside the panel: parsed, syncing, synced, failed.

2. Fix hidden limit accuracy by parsing Facebook Billing DOM text
   - Stop relying only on `adtrust_dsl`, because in your screenshot that gives 250 while the actual billing-page daily limit is 134.52.
   - Parse the Billing page text directly for:
     - `Daily spending limit (set by Meta): $134.52`
     - SMIT-style labels if present: `Hidden Limit`, `Threshold`, `Balance`, `Total spending`, etc.
   - Store parsed hidden limit separately in CRM, and display hidden limit before the older visible limit where appropriate.

3. Fix cards not syncing by reading the visible Payment methods section
   - Parse all visible card rows from Billing page:
     - Visa/MasterCard/etc.
     - last 4 digits
     - default badge
     - backup cards
     - expiry date where shown
   - Sync these cards into:
     - `ad_account_last_known_state.cards`
     - `ad_account_insights.cards`
     - card assignment history, so CRM card panels show them immediately.

4. Make sync survive tab changes
   - Move the manual sync flow to the background service worker instead of depending on the popup staying open.
   - Popup button will only start the background job and show status from `chrome.storage.local`.
   - If you click another tab or the popup closes, sync continues.
   - Auto-sync will run every 6 hours as requested, not every hour.

5. Only sync CRM accounts
   - Keep the existing CRM account filter from `list-managed-accounts`.
   - Extension will only sync accounts whose Meta account IDs exist in the CRM.
   - No random BM accounts will be pushed to the CRM.

6. Add richer CRM storage for live billing fields
   - Add columns to store billing-page data accurately, for example:
     - `account_type`
     - `timezone_name`
     - `billing_threshold`
     - `total_spending`
     - `outstanding_balance`
     - `billing_raw_snapshot` JSON for debugging/parsing fallback
   - Add equivalent fields to the last-known-state table where needed.

7. Update CRM ad account detail page
   - Add a “Live Billing Data from Extension” card on the ad account details page.
   - Show hidden daily limit prominently, e.g. “Hidden Limit: $134.52”.
   - Show visible limit separately, e.g. “Visible Limit: $250.00”.
   - Show threshold, balance, total spend, account type, timezone, last synced time, and cards.
   - Make synced cards appear in the existing Payment Methods section too.

8. Improve payment method removal
   - Keep removal inside Facebook Billing page using the logged-in Facebook session.
   - Add the remove action beside parsed cards in the injected CRM panel.
   - After removal, re-parse the page and sync the updated card list back to CRM.
   - If Facebook changes DOM/API and the card ID cannot be detected, show a clear message instead of silent failure.

9. Package and update download
   - Repackage `public/dsl-sync-extension.zip` from the updated extension.
   - Update CRM download label and filename to `dsl-sync-extension-v1.4.0.zip` / “Download extension v1.4.0”.

Technical notes:

- This will use a hybrid data source:
  - Facebook Billing page DOM parser for hidden limit, visible cards, threshold, account type, timezone, and billing-page-only data.
  - Graph API only as fallback for fields it can reliably return.
- I will not embed the screenshot as an app asset; I will use it only as reference for the parser/UI.
- The database migration will be needed for the new billing fields.
- After implementation, you will need to install the new v1.4.0 extension and open the Facebook billing page while logged in for the live parser to read the same data SMIT reads.