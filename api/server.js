// Vercel Node.js Function entry that hosts the TanStack Start server bundle.
// Vercel rewrites every request to /api/server, then this handler converts
// the Node IncomingMessage into a Web Request and forwards it to TanStack Start.
import server from "../dist/server/server.js";

export const config = {
  runtime: "nodejs20.x",
};

function buildRequest(req) {
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const url = new URL(req.url || "/", `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, String(value));
  }

  const init = { method: req.method, headers };
  if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url.toString(), init);
}

async function writeResponse(webRes, res) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") res.appendHeader("set-cookie", value);
    else res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

export default async function handler(req, res) {
  try {
    const request = buildRequest(req);
    const response = await server.fetch(request);
    await writeResponse(response, res);
  } catch (err) {
    console.error("[ssr] handler error:", err);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("Internal Server Error");
  }
}
