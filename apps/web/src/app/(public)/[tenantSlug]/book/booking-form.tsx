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

type SubmissionState = "idle" | "submitting" | "success" | "error";

const failureMessage = "We couldn't send your request. Please try again.";
const appointmentRequestsChannel = "chairly-appointment-requests";
const appointmentRequestSignalKey = "chairly:appointment-requested";

export function BookingForm({
  businessName,
  services,
  tenantSlug,
}: BookingFormProps) {
  const [selectedServiceId, setSelectedServiceId] = useState("");
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

      if (response.ok && typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(appointmentRequestsChannel);
        channel.postMessage({ tenantSlug });
        channel.close();
      }
      if (response.ok) {
        try {
          window.localStorage.setItem(
            appointmentRequestSignalKey,
            JSON.stringify({ tenantSlug, nonce: crypto.randomUUID() }),
          );
        } catch {
          // The dashboard also continues polling when storage is unavailable.
        }
      }
      setSubmissionState(response.ok ? "success" : "error");
    } catch {
      setSubmissionState("error");
    }
  }

  return (
    <form
      aria-label="Book an appointment"
      className="booking-form"
      onSubmit={submitRequest}
    >
      <fieldset className="booking-fieldset">
        <legend>Choose a service</legend>
        <p className="booking-help">
          Select the service you would like to book.
        </p>
        <div className="service-list">
          {services.map((service) => (
            <label className="service-option" key={service.id}>
              <input
                checked={selectedServiceId === service.id}
                name="serviceId"
                onChange={() => setSelectedServiceId(service.id)}
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
        <label className="booking-input-group">
          <span>Your name</span>
          <input
            autoComplete="name"
            name="customerName"
            placeholder="Ada Okafor"
            required
            type="text"
          />
        </label>
        <label className="booking-input-group">
          <span>Email or phone number</span>
          <input
            autoComplete="email"
            name="contactDetail"
            placeholder="ada@example.com or +234 800 000 0000"
            required
            type="text"
          />
        </label>
        <label className="booking-input-group">
          <span>Preferred time</span>
          <input name="preferredTime" required type="datetime-local" />
        </label>
        <p className="booking-time-note">
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
              : submissionState === "error"
                ? failureMessage
                : "No payment is taken now."}
        </p>
      </div>
    </form>
  );
}
