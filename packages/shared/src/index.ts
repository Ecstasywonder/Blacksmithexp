import { z } from "zod";
import { bookingSliceFixtures } from "./booking-slice-fixtures";

export { bookingSliceFixtures };

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

export const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
export const publicClockTimePattern = /^(0?[1-9]|1[0-2]):([0-5]\d)\s?(AM|PM)$/i;

export const bookingRequestSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(tenantSlugPattern, "Invalid tenant slug"),
  serviceId: z.uuid("Choose a service to continue."),
  customerName: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(120, "Name must be 120 characters or fewer"),
  contactDetail: z
    .string()
    .trim()
    .min(1, "Enter your contact detail")
    .max(160, "Contact detail must be 160 characters or fewer"),
  preferredTime: z
    .string()
    .trim()
    .min(1, "Enter your preferred time")
    .regex(publicClockTimePattern, "Enter a valid time, like 2:30 PM"),
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "A booking idempotency key is required")
    .max(200, "Idempotency key is too long"),
});

export type BookingRequestInput = z.infer<typeof bookingRequestSchema>;

export function buildFieldErrors(
  issues: z.ZodIssue[],
): Readonly<Record<string, readonly string[]>> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string") {
      continue;
    }

    const existing = fieldErrors[field] ?? [];
    existing.push(issue.message);
    fieldErrors[field] = existing;
  }

  return fieldErrors;
}

export function formatMinorCurrency(
  amountMinor: number,
  currency: string,
  locale = "en-NG",
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}
