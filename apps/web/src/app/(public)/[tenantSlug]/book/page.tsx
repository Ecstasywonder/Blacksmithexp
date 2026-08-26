type BookingPageProps = { params: Promise<{ tenantSlug: string }> };

/** Booking-flow route placeholder; it intentionally submits no data. */
export default async function BookingPage({ params }: BookingPageProps) {
  const { tenantSlug } = await params;
  return (
    <main className="narrow">
      <p className="eyebrow">{tenantSlug}</p>
      <h1>Request an appointment</h1>
      <p>The implemented flow will collect service, staff preference, time, customer details, and policy consent.</p>
    </main>
  );
}
