"use client";

import { useRef, useState, type FormEvent } from "react";

export type BookingFormService = {
  id: string;
  name: string;
  description: string | null;
  duration: string;
  price: string;
};

type BookingFormProps = {
  businessName: string;
  services: BookingFormService[];
  tenantSlug: string;
};

type BookingField =
  "serviceId" | "customerName" | "contactDetail" | "preferredTime";

type BookingFieldErrors = Partial<Record<BookingField, string>>;
type SubmissionState =
  "idle" | "submitting" | "success" | "duplicate" | "error";

const bookingFieldOrder: readonly BookingField[] = [
  "serviceId",
  "customerName",
  "contactDetail",
  "preferredTime",
];

const localDateTimePattern =
  /^(?:\d{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/;
const failureMessage = "We couldn't send your request. Please try again.";
const duplicateMessage =
  "We already received this booking request — no need to send it again.";
const appointmentRequestsChannel = "chairly-appointment-requests";
const appointmentRequestSignalKey = "chairly:appointment-requested";

function readTextField(formData: FormData, field: BookingField) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

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

function validateBookingRequest(
  formData: FormData,
  serviceIds: ReadonlySet<string>,
): BookingFieldErrors {
  const errors: BookingFieldErrors = {};
  const serviceId = readTextField(formData, "serviceId");
  const customerName = readTextField(formData, "customerName");
  const contactDetail = readTextField(formData, "contactDetail");
  const preferredTime = readTextField(formData, "preferredTime");

  if (!serviceId || !serviceIds.has(serviceId)) {
    errors.serviceId = "Choose a service to continue.";
  }

  if (!customerName) {
    errors.customerName = "Enter your name";
  }

  if (!contactDetail) {
    errors.contactDetail = "Enter your contact detail";
  }

  if (!preferredTime) {
    errors.preferredTime = "Enter your preferred time";
  } else if (!isCalendarDateTime(preferredTime)) {
    errors.preferredTime = "Choose a valid preferred date and time";
  }

  return errors;
}

export function BookingForm({
  businessName,
  services,
  tenantSlug,
}: BookingFormProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [submissionState, setSubmissionState] =
    useState<SubmissionState>("idle");
  const submissionIdentity = useRef<{ body: string; key: string } | null>(null);
  const isSubmitting = submissionState === "submitting";
  const selectedService = services.find(
    (service) => service.id === selectedServiceId,
  );

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const nextErrors = validateBookingRequest(
      formData,
      new Set(services.map((service) => service.id)),
    );
    const firstInvalidField = bookingFieldOrder.find(
      (field) => nextErrors[field],
    );

    if (firstInvalidField) {
      setErrors(nextErrors);
      setSubmissionState("idle");
      form.querySelector<HTMLElement>(`[name="${firstInvalidField}"]`)?.focus();
      return;
    }

    setErrors({});
    setSubmissionState("submitting");

    try {
      const body = JSON.stringify({
        serviceId: formData.get("serviceId"),
        customerName: formData.get("customerName"),
        contactDetail: formData.get("contactDetail"),
        preferredTime: formData.get("preferredTime"),
      });
      if (submissionIdentity.current?.body !== body) {
        submissionIdentity.current = {
          body,
          key: crypto.randomUUID(),
        };
      }

      const response = await fetch(
        `/api/public/${encodeURIComponent(tenantSlug)}/appointments`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": submissionIdentity.current.key,
          },
          body,
        },
      );

      const payload: unknown = response.ok ? await response.json() : null;
      const outcome =
        typeof payload === "object" &&
        payload !== null &&
        "outcome" in payload &&
        payload.outcome === "duplicate"
          ? "duplicate"
          : "created";

      if (
        response.ok &&
        outcome === "created" &&
        typeof BroadcastChannel !== "undefined"
      ) {
        const channel = new BroadcastChannel(appointmentRequestsChannel);
        channel.postMessage({ tenantSlug });
        channel.close();
      }
      if (response.ok && outcome === "created") {
        try {
          window.localStorage.setItem(
            appointmentRequestSignalKey,
            JSON.stringify({ tenantSlug, nonce: crypto.randomUUID() }),
          );
        } catch {
          // The dashboard also continues polling when storage is unavailable.
        }
      }
      setSubmissionState(
        response.ok
          ? outcome === "duplicate"
            ? "duplicate"
            : "success"
          : "error",
      );
    } catch {
      setSubmissionState("error");
    }
  }

  function clearError(field: BookingField) {
    setErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[field];
      return nextErrors;
    });
  }

  return (
    <form
      aria-label="Book an appointment"
      className="booking-form"
      noValidate
      onSubmit={submitRequest}
    >
      <fieldset
        aria-describedby={errors.serviceId ? "serviceId-error" : undefined}
        className="booking-fieldset"
      >
        <legend>Choose a service</legend>
        <p className="booking-help">
          Select the service you would like to book.
        </p>
        <div className="service-list" data-invalid={Boolean(errors.serviceId)}>
          {services.map((service) => (
            <label className="service-option" key={service.id}>
              <input
                checked={selectedServiceId === service.id}
                name="serviceId"
                onChange={() => {
                  setSelectedServiceId(service.id);
                  clearError("serviceId");
                }}
                required
                type="radio"
                value={service.id}
              />
              <span className="service-option-copy">
                <span className="service-option-heading">
                  <strong>{service.name}</strong>
                  <span className="service-option-price">{service.price}</span>
                </span>
                {service.description ? (
                  <span className="service-option-description">
                    {service.description}
                  </span>
                ) : null}
                <span className="service-option-duration">
                  {service.duration}
                </span>
              </span>
              <span aria-hidden="true" className="service-option-mark">
                ✓
              </span>
            </label>
          ))}
        </div>
        {errors.serviceId ? (
          <p className="booking-error" id="serviceId-error" role="alert">
            {errors.serviceId}
          </p>
        ) : null}
      </fieldset>

      <div
        aria-label="Your service"
        aria-live="polite"
        className="booking-selection"
        role="status"
      >
        <span className="booking-selection-label">Your service</span>
        <strong>{selectedService?.name ?? "Choose a service above"}</strong>
      </div>

      <fieldset className="booking-fieldset booking-details">
        <legend>Your details</legend>
        <p className="booking-help">
          Tell {businessName} how to reach you about this request.
        </p>
        <div className="booking-input-group">
          <label htmlFor="customerName">Your name</label>
          <input
            aria-describedby={
              errors.customerName ? "customerName-error" : undefined
            }
            aria-invalid={Boolean(errors.customerName)}
            autoComplete="name"
            id="customerName"
            name="customerName"
            onChange={() => clearError("customerName")}
            placeholder="Ada Okafor"
            required
            type="text"
          />
          {errors.customerName ? (
            <span
              className="booking-error"
              id="customerName-error"
              role="alert"
            >
              {errors.customerName}
            </span>
          ) : null}
        </div>
        <div className="booking-input-group">
          <label htmlFor="contactDetail">Email or phone number</label>
          <input
            aria-describedby={
              errors.contactDetail ? "contactDetail-error" : undefined
            }
            aria-invalid={Boolean(errors.contactDetail)}
            autoComplete="email"
            id="contactDetail"
            name="contactDetail"
            onChange={() => clearError("contactDetail")}
            placeholder="ada@example.com or +234 800 000 0000"
            required
            type="text"
          />
          {errors.contactDetail ? (
            <span
              className="booking-error"
              id="contactDetail-error"
              role="alert"
            >
              {errors.contactDetail}
            </span>
          ) : null}
        </div>
        <div className="booking-input-group">
          <label htmlFor="preferredTime">Preferred time</label>
          <input
            aria-describedby={
              errors.preferredTime
                ? "preferredTime-error preferredTime-note"
                : "preferredTime-note"
            }
            aria-invalid={Boolean(errors.preferredTime)}
            autoComplete="off"
            id="preferredTime"
            name="preferredTime"
            onChange={() => clearError("preferredTime")}
            required
            type="datetime-local"
          />
          {errors.preferredTime ? (
            <span
              className="booking-error"
              id="preferredTime-error"
              role="alert"
            >
              {errors.preferredTime}
            </span>
          ) : null}
        </div>
        <p className="booking-time-note" id="preferredTime-note">
          Your preferred time is a request. {businessName} will confirm it with
          you.
        </p>
      </fieldset>

      <div className="booking-submit-area">
        <button
          className="booking-submit"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? (
            <>
              <span aria-hidden="true" className="booking-spinner" />
              Submitting request…
            </>
          ) : (
            "Request appointment"
          )}
        </button>
        <p
          aria-label="Submission status"
          aria-live="polite"
          className="booking-submit-status"
          role="status"
        >
          {submissionState === "submitting"
            ? "Your appointment request is being submitted."
            : submissionState === "success"
              ? "Your appointment request was sent."
              : submissionState === "duplicate"
                ? duplicateMessage
                : submissionState === "error"
                  ? failureMessage
                  : "No payment is taken now."}
        </p>
      </div>
    </form>
  );
}
