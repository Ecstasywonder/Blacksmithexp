import { redirect } from "next/navigation";
import { loadOwnerPendingAppointments } from "@/server/pending-appointments";
import { PendingAppointmentsList } from "./pending-appointments-list";

export default async function AppointmentsPage() {
  const pendingAppointments = await loadOwnerPendingAppointments();
  if (!pendingAppointments) {
    redirect("/sign-in");
  }

  return (
    <section aria-labelledby="appointments-title">
      <p className="eyebrow">Appointment inbox</p>
      <h1 id="appointments-title">Pending appointments</h1>
      <p>
        New requests for {pendingAppointments.businessName} appear here
        automatically.
      </p>
      <PendingAppointmentsList
        appointments={pendingAppointments.appointments.map((appointment) => ({
          id: appointment.id,
          status: appointment.status,
          serviceName: appointment.serviceName,
          preferredTime: appointment.preferredTime,
          timeZone: appointment.timeZone,
          customerName: appointment.customerName,
          customerContact: appointment.customerContact,
        }))}
        tenantSlug={pendingAppointments.tenantSlug}
      />
    </section>
  );
}
