import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

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
  const [msg, setMsg] = useState("Facebook connect শেষ হচ্ছে…");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const code = p.get("code");
    const err = p.get("error_description") || p.get("error");
    const payload = { type: "fbPagesOAuth", code, error: err, t: Date.now() };
    try { window.opener?.postMessage(payload, window.location.origin); } catch { /* opener cut */ }
    try { const bc = new BroadcastChannel("fbPagesOAuth"); bc.postMessage(payload); bc.close(); } catch { /* unsupported */ }
    try { localStorage.setItem("fbPagesOAuth", JSON.stringify(payload)); localStorage.removeItem("fbPagesOAuth"); } catch { /* blocked */ }
    setMsg(code ? "সম্পন্ন! এই window বন্ধ হচ্ছে… আগের tab-এ ফিরে যান।" : err || "বাতিল হয়েছে");
    setTimeout(() => window.close(), 1200);
  }, []);
  return <p className="p-6 text-center text-sm">{msg}</p>;
}
