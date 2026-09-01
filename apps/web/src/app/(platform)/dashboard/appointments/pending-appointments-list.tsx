"use client";

import { useEffect, useState } from "react";

type PendingAppointment = Readonly<{
  id: string;
  status: "pending";
  serviceName: string;
  preferredTime: string;
  timeZone: string;
  customerName: string;
  customerContact: string;
}>;

type PendingAppointmentsListProps = {
  appointments: readonly PendingAppointment[];
  tenantSlug: string;
};

const appointmentRequestsChannel = "chairly-appointment-requests";
const appointmentRequestSignalKey = "chairly:appointment-requested";

function signalMatchesTenant(
  value: string | null,
  tenantSlug: string,
): boolean {
  if (!value) {
    return false;
  }

  try {
    const signal: unknown = JSON.parse(value);
    return (
      typeof signal === "object" &&
      signal !== null &&
      "tenantSlug" in signal &&
      signal.tenantSlug === tenantSlug
    );
  } catch {
    return false;
  }
}

function isPendingAppointment(value: unknown): value is PendingAppointment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "status" in value &&
    value.status === "pending" &&
    "serviceName" in value &&
    typeof value.serviceName === "string" &&
    "preferredTime" in value &&
    typeof value.preferredTime === "string" &&
    "timeZone" in value &&
    typeof value.timeZone === "string" &&
    "customerName" in value &&
    typeof value.customerName === "string" &&
    "customerContact" in value &&
    typeof value.customerContact === "string"
  );
}

export function PendingAppointmentsList({
  appointments: initialAppointments,
  tenantSlug,
}: PendingAppointmentsListProps) {
  const [appointments, setAppointments] = useState(initialAppointments);

  useEffect(() => {
    let stopped = false;
    let refreshInFlight: Promise<void> | null = null;
    let refreshQueued = false;

    async function performRefresh() {
      try {
        const response = await fetch("/api/dashboard/pending-appointments", {
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (
          response.ok &&
          typeof payload === "object" &&
          payload !== null &&
          "appointments" in payload &&
          Array.isArray(payload.appointments) &&
          payload.appointments.every(isPendingAppointment) &&
          !stopped
        ) {
          setAppointments(payload.appointments);
        }
      } catch {
        // A later poll recovers from transient network failures.
      }
    }

    function refresh() {
      if (refreshInFlight) {
        refreshQueued = true;
        return refreshInFlight;
      }

      refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = null;
        if (refreshQueued && !stopped) {
          refreshQueued = false;
          void refresh();
        }
      });
      return refreshInFlight;
    }

    const channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(appointmentRequestsChannel);
    channel?.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (
        typeof event.data === "object" &&
        event.data !== null &&
        "tenantSlug" in event.data &&
        event.data.tenantSlug === tenantSlug
      ) {
        void refresh();
      }
    });
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === appointmentRequestSignalKey &&
        signalMatchesTenant(event.newValue, tenantSlug)
      ) {
        void refresh();
      }
    };
    window.addEventListener("storage", handleStorage);
    try {
      if (
        signalMatchesTenant(
          window.localStorage.getItem(appointmentRequestSignalKey),
          tenantSlug,
        )
      ) {
        void refresh();
      }
    } catch {
      // Polling still works when browser storage is unavailable.
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 250);

    return () => {
      stopped = true;
      channel?.close();
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(interval);
    };
  }, [tenantSlug]);

  if (appointments.length === 0) {
    return (
      <p className="appointments-empty" role="status">
        No pending appointment requests yet.
      </p>
    );
  }

  return (
    <ul aria-label="Pending appointments" className="appointment-list">
      {appointments.map((appointment) => (
        <li className="appointment-card" key={appointment.id}>
          <div className="appointment-card-heading">
            <h2>{appointment.serviceName}</h2>
            <span className="appointment-status">Pending</span>
          </div>
          <dl>
            <div>
              <dt>Preferred time</dt>
              <dd>
                <time dateTime={appointment.preferredTime}>
                  {appointment.preferredTime}
                </time>{" "}
                <span className="appointment-time-zone">
                  ({appointment.timeZone})
                </span>
              </dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{appointment.customerName}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>{appointment.customerContact}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
