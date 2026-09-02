import "server-only";

import { createHmac } from "node:crypto";
import { consumePublicBookingRateLimit } from "@chairly/database";
import { getDatabase } from "./database";
import { isSyntheticBookingEnvironment } from "./public-booking-catalog";

const maxRequests = 20;
const windowSeconds = 60;
const untrustedClientScope = "untrusted-client";
const syntheticClientHeader = "x-chairly-test-client-id";

const syntheticState = globalThis as typeof globalThis & {
  chairlySyntheticPublicRateLimits?: Map<
    string,
    { count: number; windowStartedAt: number }
  >;
};

export function trustedRateLimitClientAddress(request: Request): string {
  // Vercel overwrites its forwarding header at the edge, but ordinary
  // forwarded-IP headers are attacker-controlled on an unverified runtime.
  // Falling back to one shared scope is deliberately conservative: it may
  // reduce availability on a misconfigured host, but it cannot be bypassed by
  // rotating a browser-supplied header.
  if (process.env.VERCEL === "1") {
    const vercelAddress = request.headers
      .get("x-vercel-forwarded-for")
      ?.split(",")
      .at(-1)
      ?.trim();
    if (vercelAddress) {
      return vercelAddress;
    }
  }

  return untrustedClientScope;
}

function syntheticClientIdentity(request: Request): string {
  return request.headers.get(syntheticClientHeader)?.trim() || "synthetic";
}

function rateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("RATE_LIMIT_SECRET must contain at least 32 characters");
  }
  return secret;
}

function scopeHash(request: Request, tenantSlug: string): string {
  return createHmac("sha256", rateLimitSecret())
    .update(
      `${tenantSlug.trim().toLowerCase()}\0${trustedRateLimitClientAddress(request)}`,
    )
    .digest("hex");
}

function consumeSyntheticRateLimit(request: Request, tenantSlug: string) {
  syntheticState.chairlySyntheticPublicRateLimits ??= new Map();
  const limits = syntheticState.chairlySyntheticPublicRateLimits;
  const key = `${tenantSlug.trim().toLowerCase()}\0${syntheticClientIdentity(request)}`;
  const now = Date.now();
  const current = limits.get(key);
  if (!current || now - current.windowStartedAt >= windowSeconds * 1_000) {
    limits.set(key, { count: 1, windowStartedAt: now });
    return true;
  }
  current.count += 1;
  return current.count <= maxRequests;
}

export async function allowPublicBookingRequest(
  request: Request,
  tenantSlug: string,
): Promise<boolean> {
  if (isSyntheticBookingEnvironment()) {
    return consumeSyntheticRateLimit(request, tenantSlug);
  }

  return consumePublicBookingRateLimit(
    getDatabase().db,
    scopeHash(request, tenantSlug),
    maxRequests,
    windowSeconds,
  );
}

export const publicBookingRetryAfterSeconds = windowSeconds;
