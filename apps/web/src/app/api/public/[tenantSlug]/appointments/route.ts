import { randomUUID } from "node:crypto";
import {
  publicAppointmentRequestSchema,
  type ErrorCode,
} from "@chairly/shared";
import { submitPublicAppointmentRequest } from "@/server/request-public-appointment";
import {
  allowPublicBookingRequest,
  publicBookingRetryAfterSeconds,
} from "@/server/public-booking-rate-limit";

const failureMessage = "We couldn't send your request. Please try again.";
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,200}$/;
const maximumRequestBodyBytes = 8_192;

type RequestBodyResult =
  | Readonly<{ ok: true; body: string }>
  | Readonly<{ ok: false; reason: "invalid" | "too_large" }>;

type PublicAppointmentRouteContext = {
  params: Promise<{ tenantSlug: string }>;
};

function errorResponse(
  status: number,
  code: ErrorCode,
  requestId: string,
  headers?: HeadersInit,
) {
  return Response.json(
    { error: { code, message: failureMessage, requestId } },
    headers ? { status, headers } : { status },
  );
}

async function readRequestBody(request: Request): Promise<RequestBodyResult> {
  if (!request.body) {
    return { ok: true, body: "" };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytesRead = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        body += decoder.decode();
        return { ok: true, body };
      }

      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumRequestBodyBytes) {
        try {
          await reader.cancel();
        } catch {
          // The 413 response remains authoritative if cancellation races with
          // a client disconnect.
        }
        return { ok: false, reason: "too_large" };
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

export async function POST(
  request: Request,
  { params }: PublicAppointmentRouteContext,
) {
  const requestId = randomUUID();
  const { tenantSlug } = await params;
  try {
    if (!(await allowPublicBookingRequest(request, tenantSlug))) {
      return errorResponse(429, "RATE_LIMITED", requestId, {
        "retry-after": String(publicBookingRetryAfterSeconds),
      });
    }
  } catch {
    console.error("Public appointment rate limit failed", { requestId });
    return errorResponse(500, "INTERNAL_ERROR", requestId);
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (!idempotencyKeyPattern.test(idempotencyKey)) {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return errorResponse(415, "VALIDATION_FAILED", requestId);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumRequestBodyBytes) {
    return errorResponse(413, "VALIDATION_FAILED", requestId);
  }

  const requestBody = await readRequestBody(request);
  if (!requestBody.ok) {
    return errorResponse(
      requestBody.reason === "too_large" ? 413 : 400,
      "VALIDATION_FAILED",
      requestId,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(requestBody.body);
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }

  const parsed = publicAppointmentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }

  try {
    const result = await submitPublicAppointmentRequest(
      tenantSlug,
      parsed.data,
      idempotencyKey,
      requestId,
    );

    if (!result.ok) {
      const status =
        result.reason === "tenant_not_found"
          ? 404
          : result.reason === "slot_unavailable" ||
              result.reason === "idempotency_conflict"
            ? 409
            : 422;
      const code =
        result.reason === "slot_unavailable"
          ? "BOOKING_SLOT_UNAVAILABLE"
          : result.reason === "idempotency_conflict"
            ? "IDEMPOTENCY_CONFLICT"
            : result.reason === "tenant_not_found"
              ? "NOT_FOUND"
              : "VALIDATION_FAILED";
      return errorResponse(status, code, requestId);
    }

    return Response.json({ appointment: result.appointment }, { status: 201 });
  } catch {
    console.error("Public appointment request failed", { requestId });
    return errorResponse(500, "INTERNAL_ERROR", requestId);
  }
}
