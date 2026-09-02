import { loadOwnerPendingAppointments } from "@/server/pending-appointments";

export async function GET() {
  const pendingAppointments = await loadOwnerPendingAppointments();
  if (!pendingAppointments) {
    return Response.json(
      { error: { message: "Unauthorized" } },
      { status: 401 },
    );
  }

  return Response.json(
    {
      appointments: pendingAppointments.appointments.map((appointment) => ({
        id: appointment.id,
        status: appointment.status,
        serviceName: appointment.serviceName,
        preferredTime: appointment.preferredTime,
        timeZone: appointment.timeZone,
        customerName: appointment.customerName,
        customerContact: appointment.customerContact,
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
