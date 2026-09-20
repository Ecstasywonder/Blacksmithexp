import { listDashboardAppointments } from "@chairly/database";
import { requireDashboardSession } from "@/server/dashboard-session";
import { getDatabase } from "@/server/database";

export default async function AppointmentsPage() {
  const session = await requireDashboardSession();
  const appointments = await listDashboardAppointments(
    getDatabase().db,
    session.tenantId,
  );

  return (
    <section>
      <p className="eyebrow">{session.tenantName}</p>
      <h1>Appointments</h1>
      <p>
        Pending and confirmed requests appear here oldest first for the signed
        tenant membership.
      </p>
      {appointments.length === 0 ? (
        <p>No pending appointments yet.</p>
      ) : (
        <div className="appointment-table-wrap">
          <table className="appointment-table">
            <thead>
              <tr>
                <th scope="col">Customer</th>
                <th scope="col">Contact</th>
                <th scope="col">Service</th>
                <th scope="col">Preferred time</th>
                <th scope="col">Status</th>
                <th scope="col">Reference</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appointment) => (
                <tr key={appointment.appointmentId}>
                  <td>{appointment.customerName}</td>
                  <td>{appointment.contactDetail}</td>
                  <td>{appointment.serviceName}</td>
                  <td>{appointment.preferredTime}</td>
                  <td>
                    <span className="status-pill">{appointment.status}</span>
                  </td>
                  <td>{appointment.publicReference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
