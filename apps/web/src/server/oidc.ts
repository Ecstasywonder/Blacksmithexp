import "server-only";

import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type JsonWebKey as CryptoJsonWebKey,
} from "node:crypto";
import { z } from "zod";
import type { OidcFlow } from "./dashboard-session";

const oidcEnvironmentSchema = z.object({
  AUTH_ISSUER_URL: z.url(),
  AUTH_CLIENT_ID: z.string().min(1),
  AUTH_CLIENT_SECRET: z.string().min(1),
  APP_ORIGIN: z.url(),
});

const discoverySchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  token_endpoint_auth_methods_supported: z
    .array(z.string())
    .optional()
    .default(["client_secret_basic"]),
});

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

const jwtHeaderSchema = z.object({
  alg: z.literal("RS256"),
  kid: z.string().min(1),
  typ: z.string().optional(),
});

const jwtClaimsSchema = z.object({
  iss: z.string().min(1),
  sub: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  azp: z.string().optional(),
  exp: z.number().int(),
  iat: z.number().int().optional(),
  nonce: z.string().min(1),
});

const jwksSchema = z.object({
  keys: z.array(
    z
      .object({
        kty: z.literal("RSA"),
        kid: z.string().min(1),
        use: z.string().optional(),
        alg: z.string().optional(),
        n: z.string().min(1),
        e: z.string().min(1),
      })
      .passthrough(),
  ),
});

type OidcEnvironment = z.infer<typeof oidcEnvironmentSchema>;
type OidcDiscovery = z.infer<typeof discoverySchema>;
export type VerifiedOidcIdentity = Readonly<{
  issuer: string;
  subject: string;
}>;

const globalOidc = globalThis as typeof globalThis & {
  chairlyOidcDiscovery?: Promise<OidcDiscovery>;
};

function environment(): OidcEnvironment {
  return oidcEnvironmentSchema.parse(process.env);
}

function callbackUrl(configuration: OidcEnvironment): string {
  return new URL("/auth/callback", configuration.APP_ORIGIN).toString();
}

export function oidcApplicationUrl(path: string): URL {
  return new URL(path, environment().APP_ORIGIN);
}

export function oidcUsesSecureCookies(): boolean {
  return oidcApplicationUrl("/").protocol === "https:";
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error("OIDC provider request failed");
  }
  return response.json() as Promise<unknown>;
}

async function discover(): Promise<OidcDiscovery> {
  globalOidc.chairlyOidcDiscovery ??= (async () => {
    const configuration = environment();
    const issuer = configuration.AUTH_ISSUER_URL.replace(/\/$/, "");
    const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const discovered = discoverySchema.parse(await readJson(response));
    if (discovered.issuer.replace(/\/$/, "") !== issuer) {
      throw new Error("OIDC issuer mismatch");
    }
    return discovered;
  })();
  return globalOidc.chairlyOidcDiscovery;
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

export async function createOidcAuthorization(): Promise<{
  authorizationUrl: string;
  flow: OidcFlow;
}> {
  const configuration = environment();
  const discovered = await discover();
  const verifier = randomBase64Url(48);
  const flow: OidcFlow = {
    state: randomBase64Url(32),
    nonce: randomBase64Url(32),
    verifier,
    returnTo: "/dashboard/appointments",
    expiresAt: Date.now() + 10 * 60_000,
  };
  const authorizationUrl = new URL(discovered.authorization_endpoint);
  authorizationUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: configuration.AUTH_CLIENT_ID,
    redirect_uri: callbackUrl(configuration),
    scope: "openid",
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { authorizationUrl: authorizationUrl.toString(), flow };
}

function decodeSegment(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

async function verifyIdToken(
  idToken: string,
  expectedNonce: string,
  discovered: OidcDiscovery,
  configuration: OidcEnvironment,
): Promise<VerifiedOidcIdentity> {
  const [encodedHeader, encodedClaims, encodedSignature, extra] =
    idToken.split(".");
  if (!encodedHeader || !encodedClaims || !encodedSignature || extra) {
    throw new Error("Invalid OIDC ID token");
  }

  const header = jwtHeaderSchema.parse(decodeSegment(encodedHeader));
  const claims = jwtClaimsSchema.parse(decodeSegment(encodedClaims));
  const jwksResponse = await fetch(discovered.jwks_uri, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const jwks = jwksSchema.parse(await readJson(jwksResponse));
  const jwk = jwks.keys.find(
    (candidate) =>
      candidate.kid === header.kid &&
      (!candidate.use || candidate.use === "sig") &&
      (!candidate.alg || candidate.alg === "RS256"),
  );
  if (!jwk) {
    throw new Error("OIDC signing key was not found");
  }

  const verified = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`),
    createPublicKey({ key: jwk as CryptoJsonWebKey, format: "jwk" }),
    Buffer.from(encodedSignature, "base64url"),
  );
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const now = Math.floor(Date.now() / 1_000);
  if (
    !verified ||
    claims.iss !== discovered.issuer ||
    !audiences.includes(configuration.AUTH_CLIENT_ID) ||
    (audiences.length > 1 && claims.azp !== configuration.AUTH_CLIENT_ID) ||
    claims.exp <= now - 30 ||
    (claims.iat !== undefined && claims.iat > now + 30) ||
    claims.nonce !== expectedNonce
  ) {
    throw new Error("OIDC ID token claims are invalid");
  }

  return { issuer: claims.iss, subject: claims.sub };
}

export async function exchangeOidcCode(
  code: string,
  flow: OidcFlow,
): Promise<VerifiedOidcIdentity> {
  const configuration = environment();
  const discovered = await discover();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(configuration),
    client_id: configuration.AUTH_CLIENT_ID,
    code_verifier: flow.verifier,
  });
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (
    discovered.token_endpoint_auth_methods_supported.includes(
      "client_secret_basic",
    )
  ) {
    headers.set(
      "authorization",
      `Basic ${Buffer.from(
        `${configuration.AUTH_CLIENT_ID}:${configuration.AUTH_CLIENT_SECRET}`,
      ).toString("base64")}`,
    );
  } else if (
    discovered.token_endpoint_auth_methods_supported.includes(
      "client_secret_post",
    )
  ) {
    body.set("client_secret", configuration.AUTH_CLIENT_SECRET);
  } else {
    throw new Error("OIDC token endpoint has no supported auth method");
  }

  const tokenResponse = await fetch(discovered.token_endpoint, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const token = tokenResponseSchema.parse(await readJson(tokenResponse));
  return verifyIdToken(token.id_token, flow.nonce, discovered, configuration);
}
