import assert from "node:assert/strict";
import test from "node:test";
import {
  signChairlySession,
  verifyChairlySession,
  type ChairlySessionPayload,
} from "./chairly-session";

const secret = "test-session-secret-at-least-32-characters";
const payload: ChairlySessionPayload = {
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  tenantSlug: "test-tenant",
  role: "owner",
  displayName: "Test Owner",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

test("sessions reject tampering and expiry", () => {
  const session = signChairlySession(payload, secret);
  assert.deepEqual(verifyChairlySession(session, secret), payload);
  assert.equal(verifyChairlySession(session + "x", secret), null);
  assert.equal(verifyChairlySession(session, secret + "other"), null);
  assert.equal(
    verifyChairlySession(
      signChairlySession(
        { ...payload, expiresAt: "2000-01-01T00:00:00Z" },
        secret,
      ),
      secret,
    ),
    null,
  );
});

test("missing or weak configuration never falls back to a shared signing secret", () => {
  const original = process.env.AUTH_SESSION_SECRET;
  const legacy = process.env.CHAIRLY_SESSION_SECRET;
  try {
    delete process.env.AUTH_SESSION_SECRET;
    delete process.env.CHAIRLY_SESSION_SECRET;
    assert.throws(() => signChairlySession(payload), /AUTH_SESSION_SECRET/);
    process.env.AUTH_SESSION_SECRET = "short";
    assert.throws(() => signChairlySession(payload), /AUTH_SESSION_SECRET/);
    process.env.AUTH_SESSION_SECRET = secret;
    assert.deepEqual(
      verifyChairlySession(signChairlySession(payload)),
      payload,
    );
  } finally {
    if (original === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = original;
    if (legacy === undefined) delete process.env.CHAIRLY_SESSION_SECRET;
    else process.env.CHAIRLY_SESSION_SECRET = legacy;
  }
});
