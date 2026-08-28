"use client";

import { useState, type FormEvent } from "react";

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
};

type BookingField =
  "serviceId" | "customerName" | "contactDetail" | "preferredTime";

type BookingFieldErrors = Partial<Record<BookingField, string>>;

const bookingFieldOrder: readonly BookingField[] = [
  "serviceId",
  "customerName",
  "contactDetail",
  "preferredTime",
];

const simpleClockTimePattern = /^(0?[1-9]|1[0-2]):[0-5]\d\s?(AM|PM)$/i;

function readTextField(formData: FormData, field: BookingField) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
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
  } else if (!simpleClockTimePattern.test(preferredTime)) {
    errors.preferredTime = "Enter a valid time, like 2:30 PM";
  }

  return errors;
}

export function BookingForm({ businessName, services }: BookingFormProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [errors, setErrors] = useState<BookingFieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedService = services.find(
    (service) => service.id === selectedServiceId,
  );

  function beginSubmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const nextErrors = validateBookingRequest(
      new FormData(form),
      new Set(services.map((service) => service.id)),
    );
    const firstInvalidField = bookingFieldOrder.find(
      (field) => nextErrors[field],
    );

    if (firstInvalidField) {
      setErrors(nextErrors);
      setIsSubmitting(false);
      form.querySelector<HTMLElement>(`[name="${firstInvalidField}"]`)?.focus();
      return;
    }

    setErrors({});
    setIsSubmitting(true);
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
      onSubmit={beginSubmission}
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
            inputMode="text"
            name="preferredTime"
            onChange={() => clearError("preferredTime")}
            placeholder="2:30 PM"
            required
            type="text"
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
          {isSubmitting
            ? "Your appointment request is being submitted."
            : "No payment is taken now."}
        </p>
      </div>
    </form>
  );
}
