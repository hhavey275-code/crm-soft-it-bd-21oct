# Project Architecture Rules

- Declare stateful wizard input components at module scope and pass dependencies as props, so parent updates preserve input focus and caret while editing budgets and bids.

- Resolve pasted Facebook Page links through the selected authorized account's BM client_pages/owned_pages, the consenting client's me/accounts, or a Page-specific BM read; exact BM membership skips duplicate access requests and personal Page login requirements, while unreadable typed IDs remain unverified requests and CRM save failures must surface.

- Use the searchable AccountPicker for My Ads account selection, so keyboard search and selection remain in one focused control.

- Share My Ads filtering and deletion-cache rules between screen sizes in a browser-safe helper; delete Meta objects only through the API's existing ownership-checked mutation path.

- Share Facebook OAuth permission scopes between client connection entry points so Page and campaign access cannot diverge.
- On the client's own ad accounts, My Ads uses the client's saved Facebook login (client_user_tokens, server-only) when it can read the account, so Pages our Business Manager cannot access still work; shared accounts keep the BM token.

- Derive My Ads Create availability and its separate warning/blur presentation from the selected account's verified Meta summary through browser-safe helpers; failed or pending reads cannot enable creation but remain visually quiet, and Refresh must recheck the summary.

- Keep external CRM retry business logic in a server-only helper shared by authenticated server functions and the public API route, so both admin and client actions enforce identical checks.
- Send bulk Meta ad-account creation through the authenticated JSON route and the configured Meta proxy, so browser domains and Meta egress restrictions cannot turn responses into HTML.
- Keep CRM Helper result requests short and let the extension repeat Meta cap checks, so edge request timeouts cannot strand completed top-ups in Updating.- Route every managed (shared ad account) Meta read/write through /api/managed-ads, which derives ownership from approved client pages + managed_campaigns, so clients can never see or edit another page's campaigns.
- My Ads may create campaigns on shared accounts (admin assigns the account to the client in managed_account_assignments; the client may use any of their non-rejected pages) or on the client's own accounts (only when Campaign Management is on); only shared-account campaigns are registered in managed_campaigns and charged to the wallet, because own accounts spend their own Meta limit.
- Keep SoftCards deposit sync (callback, retry, SMS auto-match) in a server-only helper shared by the public webhook route and admin server functions, so manual and auto approvals send the identical callback.
- Display SoftCards callback failures from their existing log table in System Log, not the top-up tab, so historic and new errors share one diagnostic view without duplicate storage.
- The My Ads create wizard supports multiple ad sets and ads per campaign: the form fields are an editing buffer for the selected node, flushed into an adsets[] store on navigation, and /api/managed-ads create accepts an adsets[] payload (wrapping legacy single-ad-set calls into the same shape), so one code path handles both.
- Scope every My Ads browser cache and draft key (localStorage/sessionStorage) by the logged-in user id, so one client never sees another client's accounts, campaigns or drafts on a shared device.
- Keep My Ads metric visibility and ordering in one per-user column layout shared by table headers, rows, drafts, totals and mobile metrics, so rearranging a column never separates a value from its label.
- On every client Facebook connect, share each returned Page with every Business Manager behind the client's ad accounts through the server-only Page-to-BM share helper (direct grant with the Page token, else BM request), so Pages never need manual linking one by one.
- The My Ads AI Assistant (/api/ads-assistant) only drafts campaigns as structured JSON; creation always happens after client confirmation through /api/managed-ads create, so AI never bypasses ownership, wallet or page checks.
