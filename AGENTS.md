# Project Architecture Rules

- Keep external CRM retry business logic in a server-only helper shared by authenticated server functions and the public API route, so both admin and client actions enforce identical checks.
- Send bulk Meta ad-account creation through the authenticated JSON route and the configured Meta proxy, so browser domains and Meta egress restrictions cannot turn responses into HTML.
- Keep CRM Helper result requests short and let the extension repeat Meta cap checks, so edge request timeouts cannot strand completed top-ups in Updating.