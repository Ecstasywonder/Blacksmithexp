import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { isSyntheticBookingEnvironment } from "./public-booking-catalog";

const dashboardSessionSchema = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  expiresAt: z.number().int().positive(),
});

export type DashboardSession = z.infer<typeof dashboardSessionSchema>;

const oidcFlowSchema = z.object({
  state: z.string().min(32).max(200),
  nonce: z.string().min(32).max(200),
  verifier: z.string().min(43).max(128),
  returnTo: z.string().startsWith("/dashboard"),
  expiresAt: z.number().int().positive(),
});

export type OidcFlow = z.infer<typeof oidcFlowSchema>;

export const dashboardSessionCookieName = "chairly_session";
export const oidcFlowCookieName = "chairly_oidc_flow";
const syntheticTenantCookieName = "chairly_e2e_tenant_slug";

function sessionSecret(): string | null {
  const secret = process.env.AUTH_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function createSignedValue<T>(value: T, schema: z.ZodType<T>): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  }

  const parsed = schema.parse(value);
  const payload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

function verifySignedValue<T>(value: string, schema: z.ZodType<T>): T | null {
  const secret = sessionSecret();
  const [payload, signature, extra] = value.split(".");
  if (!secret || !payload || !signature || extra) {
    return null;
  }

  const suppliedSignature = Buffer.from(signature, "base64url");
  const expectedSignature = sign(payload, secret);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Used by the OIDC callback adapter when it establishes a selected tenant. */
export function createDashboardSessionValue(session: DashboardSession): string {
  return createSignedValue(session, dashboardSessionSchema);
}

function verifyDashboardSession(value: string): DashboardSession | null {
  const session = verifySignedValue(value, dashboardSessionSchema);
  return session && session.expiresAt > Date.now() ? session : null;
}

export function createOidcFlowValue(flow: OidcFlow): string {
  return createSignedValue(flow, oidcFlowSchema);
}

export function verifyOidcFlowValue(value: string): OidcFlow | null {
  const flow = verifySignedValue(value, oidcFlowSchema);
  return flow && flow.expiresAt > Date.now() ? flow : null;
}

export type DashboardIdentity =
  | Readonly<{ kind: "authenticated"; userId: string; tenantId: string }>
  | Readonly<{ kind: "synthetic"; tenantSlug: string }>;

export async function getDashboardIdentity(): Promise<DashboardIdentity | null> {
  const cookieStore = await cookies();

  if (isSyntheticBookingEnvironment()) {
    const tenantSlug = cookieStore.get(syntheticTenantCookieName)?.value;
    return tenantSlug ? { kind: "synthetic", tenantSlug } : null;
  }

  const sessionValue = cookieStore.get(dashboardSessionCookieName)?.value;
  if (!sessionValue) {
    return null;
  }

  const session = verifyDashboardSession(sessionValue);
  return session
    ? {
        kind: "authenticated",
        userId: session.userId,
        tenantId: session.tenantId,
      }
    : null;
}
