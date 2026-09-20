import { formatMinorCurrency } from "@chairly/shared";
import { notFound } from "next/navigation";
import { BookingForm } from "./booking-form";
import { loadPublicBookingCatalog } from "@/server/public-booking-catalog";

type BookingPageProps = { params: Promise<{ tenantSlug: string }> };

export default async function BookingPage({ params }: BookingPageProps) {
  const { tenantSlug } = await params;
  const catalog = await loadPublicBookingCatalog(tenantSlug);

  if (!catalog) {
    notFound();
  }

  if (catalog.services.length === 0) {
    return (
      <main className="booking-shell">
        <section className="booking-panel booking-empty">
          <p className="eyebrow">{catalog.displayName}</p>
          <h1>This business isn&apos;t taking bookings yet</h1>
          <p>
            The public page is live, but there are no published services ready
            to request right now.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="booking-shell">
      <section className="booking-panel">
        <p className="eyebrow">{catalog.displayName}</p>
        <h1>Request an appointment</h1>
        <p className="booking-intro">
          Pick a service and share the best way to reach you. The business will
          review your preferred time before confirming anything.
        </p>
        <BookingForm
          businessName={catalog.displayName}
          services={catalog.services.map((service) => ({
            id: service.id,
            name: service.name,
            description: service.description,
            duration: `${service.durationMinutes} minutes`,
            price: formatMinorCurrency(service.priceMinor, service.currency),
          }))}
          tenantSlug={tenantSlug}
        />
      </section>
    </main>
  );
}
