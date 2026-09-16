# Fix CRM helper completion and pacing

## Changes
- Make successful CRM top-ups reliably update the matching pending request without relying on browser-held admin authorization.
- Add a clear amount-review countdown before the final CRM confirmation, showing account and dollar amount.
- Keep automatic submission enabled after the review delay, with failure remaining pending for manual handling.
- Increment and display the helper version, then rebuild the downloadable extension ZIP.

## Verification
- Validate helper scripts and archive contents.
- Check the app build status after the changes.
