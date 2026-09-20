import { BookingSliceError, requestPublicAppointment } from "@chairly/database";
import {
  bookingRequestSchema,
  buildFieldErrors,
  type AppError,
} from "@chairly/shared";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@/server/database";

export const runtime = "nodejs";

function buildErrorResponse(status: number, error: AppError): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return buildErrorResponse(400, {
      code: "VALIDATION_FAILED",
      message: "Send a valid booking request payload.",
      requestId,
    });
  }

  const requestBody = {
    ...(typeof payload === "object" && payload !== null ? payload : {}),
    idempotencyKey:
      request.headers.get("x-idempotency-key") ??
      (typeof payload === "object" &&
      payload !== null &&
      "idempotencyKey" in payload &&
      typeof payload.idempotencyKey === "string"
        ? payload.idempotencyKey
        : ""),
  };

  const parsedRequest = bookingRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return buildErrorResponse(400, {
      code: "VALIDATION_FAILED",
      message: "Fix the highlighted fields and try again.",
      requestId,
      fieldErrors: buildFieldErrors(parsedRequest.error.issues),
    });
  }

  try {
    const appointment = await requestPublicAppointment(getDatabase().db, {
      ...parsedRequest.data,
      requestId,
    });

    return Response.json({ appointment }, { status: 201 });
  } catch (error) {
    if (error instanceof BookingSliceError) {
      return buildErrorResponse(error.status, {
        code: error.code,
        message: error.message,
        requestId,
      });
    }

    return buildErrorResponse(500, {
      code: "INTERNAL_ERROR",
      message: "Booking could not be completed right now.",
      requestId,
    });
  }
}
