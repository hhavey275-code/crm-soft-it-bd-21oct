import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { call } from "@/components/client/FacebookPagesConnect";

export const Route = createFileRoute("/fb-pages-callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Facebook connect | SOFT IT BD" },
      { name: "description", content: "Finishing Facebook page connection." },
      { property: "og:title", content: "Facebook connect | SOFT IT BD" },
      { property: "og:description", content: "Finishing Facebook page connection." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Callback,
});

function Callback() {
  const [msg, setMsg] = useState("Facebook থেকে page-এর তালিকা আনা হচ্ছে…");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const err = p.get("error_description") || p.get("error");
    const back = sessionStorage.getItem("fbPagesReturn") || "/my-ads";
    const finish = (result: unknown) => {
      sessionStorage.setItem("fbPagesResult", JSON.stringify(result));
      window.location.replace(back);
    };
    if (!code) { finish({ error: err || "Facebook connect বাতিল হয়েছে" }); return; }
    call({ action: "pages", code, redirectUri: `${window.location.origin}/fb-pages-callback` })
      .then((r) => finish({ pages: r.pages, signedIn: r.signedIn, added: r.added }))
      .catch((e) => { setMsg(e.message); finish({ error: e.message }); });
  }, []);
  return <p className="p-6 text-center text-sm">{msg}</p>;
}
