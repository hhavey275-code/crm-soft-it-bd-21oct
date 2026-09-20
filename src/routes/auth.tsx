import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | SOFT IT BD" },
      { name: "description", content: "Sign in securely to your SOFT IT BD account." },
      { property: "og:title", content: "Sign in | SOFT IT BD" },
      { property: "og:description", content: "Sign in securely to your SOFT IT BD account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap" },
    ],
  }),
  component: AuthForm,
});
