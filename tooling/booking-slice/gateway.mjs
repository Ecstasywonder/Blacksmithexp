// Disposable local OIDC fixture + trusted proxy. Never deploy this service.
import { createServer, request as proxyRequest } from "node:http";
import {
  createHash,
  createHmac,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";

const origin = "http://127.0.0.1:3310";
const issuer = `${origin}/local-oidc`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "local",
  use: "sig",
  alg: "RS256",
};
const codes = new Map();
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function json(res, status, value) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 8192) throw new Error("body limit");
  }
  return new URLSearchParams(value);
}
async function oidc(req, res, url) {
  const path = url.pathname;
  if (path.endsWith("/.well-known/openid-configuration"))
    return json(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
  if (path === "/local-oidc/jwks") return json(res, 200, { keys: [jwk] });
  if (path === "/local-oidc/authorize") {
    const q = url.searchParams;
    if (
      q.get("client_id") !== process.env.AUTH_CLIENT_ID ||
      q.get("redirect_uri") !== `${origin}/auth/callback` ||
      q.get("response_type") !== "code" ||
      q.get("code_challenge_method") !== "S256" ||
      !q.get("code_challenge") ||
      !q.get("nonce") ||
      !q.get("state")
    )
      return json(res, 400, {
        error: "Invalid local sign-in request. Start again at /sign-in.",
      });
    if (req.method === "GET") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      return res.end(
        '<!doctype html><html lang="en"><title>Local booking sign-in</title><main><h1>Local booking sign-in</h1><p>Disposable demo accounts only. Password: booking-demo</p><form method="post"><label>Business <select name="business"><option value="luma-studio">Luma Studio</option><option value="ember-studio">Ember Studio</option></select></label><label>Password <input name="password" type="password" required></label><button>Sign in</button></form></main></html>',
      );
    }
    const form = await body(req);
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin ||
      form.get("password") !== "booking-demo" ||
      !["luma-studio", "ember-studio"].includes(form.get("business"))
    )
      return json(res, 401, {
        error:
          "Use a demo business and password booking-demo. Return to /sign-in to retry.",
      });
    for (const [key, value] of codes)
      if (value.expires < Date.now()) codes.delete(key);
    const code = randomUUID();
    codes.set(code, {
      subject: form.get("business"),
      challenge: q.get("code_challenge"),
      nonce: q.get("nonce"),
      expires: Date.now() + 60_000,
    });
    const callback = new URL(`${origin}/auth/callback`);
    callback.search = new URLSearchParams({
      code,
      state: q.get("state"),
    }).toString();
    res.writeHead(302, {
      location: callback.href,
      "cache-control": "no-store",
    });
    return res.end();
  }
  if (path === "/local-oidc/token" && req.method === "POST") {
    const form = await body(req);
    const code = codes.get(form.get("code"));
    codes.delete(form.get("code"));
    const auth = `Basic ${Buffer.from(`${process.env.AUTH_CLIENT_ID}:${process.env.AUTH_CLIENT_SECRET}`).toString("base64")}`;
    if (
      req.headers.authorization !== auth ||
      !code ||
      code.expires < Date.now() ||
      form.get("grant_type") !== "authorization_code" ||
      form.get("redirect_uri") !== `${origin}/auth/callback` ||
      createHash("sha256")
        .update(form.get("code_verifier") ?? "")
        .digest("base64url") !== code.challenge
    )
      return json(res, 400, { error: "invalid_grant" });
    const now = Math.floor(Date.now() / 1000);
    const payload = `${encode({ alg: "RS256", kid: "local", typ: "JWT" })}.${encode({ iss: issuer, sub: code.subject, aud: process.env.AUTH_CLIENT_ID, nonce: code.nonce, iat: now, exp: now + 300 })}`;
    return json(res, 200, {
      id_token: `${payload}.${sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url")}`,
    });
  }
  return json(res, 404, { error: "Local sign-in route not found." });
}
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname.startsWith("/local-oidc/"))
      return await oidc(req, res, url);
    const headers = { ...req.headers };
    for (const key of Object.keys(headers))
      if (
        key.startsWith("x-forwarded-") ||
        key.startsWith("x-vercel-") ||
        key.startsWith("x-chairly-")
      )
        delete headers[key];
    const address = req.socket.remoteAddress;
    headers.host = "127.0.0.1:3310";
    headers["x-chairly-client-ip"] = address;
    headers["x-chairly-client-ip-signature"] = createHmac(
      "sha256",
      process.env.TRUSTED_PROXY_CLIENT_IP_SECRET,
    )
      .update(`client-ip:v1\0x-chairly-client-ip\0${address}`)
      .digest("hex");
    const upstream = proxyRequest(
      {
        hostname: "127.0.0.1",
        port: 3211,
        path: req.url,
        method: req.method,
        headers,
      },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        json(res, 503, {
          error:
            "Booking app is starting or unavailable. Retry shortly; inspect slice logs if this continues.",
        });
      else res.end();
    });
    req.pipe(upstream);
  } catch {
    if (!res.headersSent)
      json(res, 400, {
        error: "Invalid local request. Return to /sign-in and try again.",
      });
    else res.end();
  }
}).listen(3310, "0.0.0.0", () =>
  console.log(`Booking slice gateway ready at ${origin}`),
);
