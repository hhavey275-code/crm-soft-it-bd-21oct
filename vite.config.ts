import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// On Vercel we need a Node server bundle (dist/server/server.js) instead of
// the Cloudflare Worker bundle, so disable the Cloudflare plugin in that env.
// On Lovable preview/published (Cloudflare Workers) we keep the default.
const isVercel = !!process.env.VERCEL;

export default defineConfig({
  cloudflare: isVercel ? false : undefined,
});
