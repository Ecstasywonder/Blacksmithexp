import { z } from "zod";

const localDateTimePattern =
  /^(?:\d{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/;

function isCalendarDateTime(value: string): boolean {
  if (!localDateTimePattern.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day &&
    candidate.getUTCHours() === hour &&
    candidate.getUTCMinutes() === minute
  );
}

/** Public booking input. Validation never changes customer-entered display values. */
export const publicAppointmentRequestSchema = z.object({
  serviceId: z.uuid(),
  customerName: z
    .string()
    .min(1)
    .max(120)
    .refine((value) => value.trim().length > 0, "Enter your name"),
  contactDetail: z
    .string()
    .min(1)
    .max(254)
    .refine(
      (value) => value.trim().length > 0,
      "Enter an email or phone number",
    ),
  preferredTime: z
    .string()
    .refine(isCalendarDateTime, "Choose a valid preferred time"),
});

export type PublicAppointmentRequest = z.infer<
  typeof publicAppointmentRequestSchema
>;

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
