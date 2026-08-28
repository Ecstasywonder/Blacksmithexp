import { randomUUID } from "node:crypto";
import {
  publicAppointmentRequestSchema,
  type ErrorCode,
} from "@chairly/shared";
import { submitPublicAppointmentRequest } from "@/server/request-public-appointment";

const failureMessage = "We couldn't send your request. Please try again.";
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,200}$/;

type PublicAppointmentRouteContext = {
  params: Promise<{ tenantSlug: string }>;
};

function errorResponse(status: number, code: ErrorCode, requestId: string) {
  return Response.json(
    { error: { code, message: failureMessage, requestId } },
    { status },
  );
}

export async function POST(
  request: Request,
  { params }: PublicAppointmentRouteContext,
) {
  const requestId = randomUUID();
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
  if (contentLength > 8_192) {
    return errorResponse(413, "VALIDATION_FAILED", requestId);
  }

  let requestBody: string;
  try {
    requestBody = await request.text();
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }
  if (new TextEncoder().encode(requestBody).byteLength > 8_192) {
    return errorResponse(413, "VALIDATION_FAILED", requestId);
  }

  let input: unknown;
  try {
    input = JSON.parse(requestBody);
  } catch {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }

  const parsed = publicAppointmentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_FAILED", requestId);
  }

  try {
    const { tenantSlug } = await params;
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
