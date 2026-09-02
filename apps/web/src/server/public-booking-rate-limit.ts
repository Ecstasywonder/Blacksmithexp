import "server-only";

import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { consumePublicBookingRateLimit } from "@chairly/database";
import { getDatabase } from "./database";
import { isSyntheticBookingEnvironment } from "./public-booking-catalog";

const maxRequests = 20;
const windowSeconds = 60;
const headerNamePattern = /^[a-z0-9][a-z0-9-]{0,127}$/;

const syntheticState = globalThis as typeof globalThis & {
  chairlySyntheticPublicRateLimits?: Map<
    string,
    { count: number; windowStartedAt: number }
  >;
};

function firstForwardedAddress(value: string | null): string | null {
  return value?.split(",", 1)[0]?.trim() || null;
}

function requireClientIp(value: string | null, headerName: string): string {
  const address = firstForwardedAddress(value);
  if (!address || isIP(address) === 0) {
    throw new Error(`${headerName} must contain a valid client IP address`);
  }
  return address;
}

export function resolveDeployedPublicBookingClientAddress(
  request: Request,
): string {
  if (process.env.VERCEL === "1") {
    return requireClientIp(
      request.headers.get("x-vercel-forwarded-for"),
      "x-vercel-forwarded-for",
    );
  }

  const trustedHeaderName =
    process.env.TRUSTED_PROXY_CLIENT_IP_HEADER?.trim().toLowerCase();
  if (!trustedHeaderName) {
    throw new Error(
      "TRUSTED_PROXY_CLIENT_IP_HEADER is required outside Vercel",
    );
  }
  if (!headerNamePattern.test(trustedHeaderName)) {
    throw new Error(
      "TRUSTED_PROXY_CLIENT_IP_HEADER is not a valid header name",
    );
  }

  return requireClientIp(
    request.headers.get(trustedHeaderName),
    trustedHeaderName,
  );
}

function clientAddress(request: Request): string {
  if (isSyntheticBookingEnvironment()) {
    return request.headers.get("x-chairly-test-client-ip")?.trim() || "unknown";
  }
  return resolveDeployedPublicBookingClientAddress(request);
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
    .update(`${tenantSlug.trim().toLowerCase()}\0${clientAddress(request)}`)
    .digest("hex");
}

function consumeSyntheticRateLimit(request: Request, tenantSlug: string) {
  syntheticState.chairlySyntheticPublicRateLimits ??= new Map();
  const limits = syntheticState.chairlySyntheticPublicRateLimits;
  const key = `${tenantSlug.trim().toLowerCase()}\0${clientAddress(request)}`;
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
