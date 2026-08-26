/** Stable machine-readable errors shared across transport boundaries. */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BOOKING_SLOT_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";

export type AppError = Readonly<{
  code: ErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;
