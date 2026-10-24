# Project Architecture Rules

- Use the searchable AccountPicker for My Ads account selection, so keyboard search and selection remain in one focused control.

- Share My Ads filtering and deletion-cache rules between screen sizes in a browser-safe helper; delete Meta objects only through the API's existing ownership-checked mutation path.

- Share Facebook OAuth permission scopes between client connection entry points so Page and campaign access cannot diverge.
- On the client's own ad accounts, My Ads uses the client's saved Facebook login (client_user_tokens, server-only) when it can read the account, so Pages our Business Manager cannot access still work; shared accounts keep the BM token.

- Derive My Ads Create availability from the selected account's verified Meta summary through the browser-safe availability helper; failed or pending reads cannot enable creation, and Refresh must recheck the summary.

- Keep external CRM retry business logic in a server-only helper shared by authenticated server functions and the public API route, so both admin and client actions enforce identical checks.
- Send bulk Meta ad-account creation through the authenticated JSON route and the configured Meta proxy, so browser domains and Meta egress restrictions cannot turn responses into HTML.
- Keep CRM Helper result requests short and let the extension repeat Meta cap checks, so edge request timeouts cannot strand completed top-ups in Updating.- Route every managed (shared ad account) Meta read/write through /api/managed-ads, which derives ownership from approved client pages + managed_campaigns, so clients can never see or edit another page's campaigns.
- My Ads may create campaigns on shared accounts (admin assigns the account to the client in managed_account_assignments; the client may use any of their non-rejected pages) or on the client's own accounts (only when Campaign Management is on); only shared-account campaigns are registered in managed_campaigns and charged to the wallet, because own accounts spend their own Meta limit.
- Keep SoftCards deposit sync (callback, retry, SMS auto-match) in a server-only helper shared by the public webhook route and admin server functions, so manual and auto approvals send the identical callback.
- Display SoftCards callback failures from their existing log table in System Log, not the top-up tab, so historic and new errors share one diagnostic view without duplicate storage.
- The My Ads create wizard supports multiple ad sets and ads per campaign: the form fields are an editing buffer for the selected node, flushed into an adsets[] store on navigation, and /api/managed-ads create accepts an adsets[] payload (wrapping legacy single-ad-set calls into the same shape), so one code path handles both.
- Scope every My Ads browser cache and draft key (localStorage/sessionStorage) by the logged-in user id, so one client never sees another client's accounts, campaigns or drafts on a shared device.
