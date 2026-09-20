import { createHmac, timingSafeEqual } from "node:crypto";

type ChairlySessionRole = "owner" | "manager" | "staff";

export type ChairlySessionPayload = {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  role: ChairlySessionRole;
  displayName: string;
  expiresAt: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getChairlySessionSecret() {
  const secret =
    process.env.AUTH_SESSION_SECRET ?? process.env.CHAIRLY_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters");
  }
  return secret;
}

function signEncodedPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

function isChairlySessionPayload(
  value: unknown,
): value is ChairlySessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.userId === "string" &&
    uuidPattern.test(payload.userId) &&
    typeof payload.tenantId === "string" &&
    uuidPattern.test(payload.tenantId) &&
    typeof payload.tenantSlug === "string" &&
    typeof payload.displayName === "string" &&
    typeof payload.expiresAt === "string" &&
    (payload.role === "owner" ||
      payload.role === "manager" ||
      payload.role === "staff")
  );
}

export function signChairlySession(
  payload: ChairlySessionPayload,
  secret = getChairlySessionSecret(),
) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = signEncodedPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifyChairlySession(
  serializedSession: string,
  secret = getChairlySessionSecret(),
): ChairlySessionPayload | null {
  const [encodedPayload, providedSignature, ...extraParts] =
    serializedSession.split(".");

  if (!encodedPayload || !providedSignature || extraParts.length > 0) {
    return null;
  }

  const expectedSignature = signEncodedPayload(encodedPayload, secret);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const parsedPayload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;

    if (!isChairlySessionPayload(parsedPayload)) {
      return null;
    }

    if (Number.isNaN(Date.parse(parsedPayload.expiresAt))) {
      return null;
    }

    if (Date.parse(parsedPayload.expiresAt) <= Date.now()) {
      return null;
    }

    return parsedPayload;
  } catch {
    return null;
  }
}
