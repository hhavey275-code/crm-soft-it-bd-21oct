import { createFileRoute, redirect } from "@tanstack/react-router";

// Pages are now connected straight from My Ads (Connect Facebook).
export const Route = createFileRoute("/my-pages")({
  beforeLoad: () => { throw redirect({ to: "/my-ads" }); },
});
