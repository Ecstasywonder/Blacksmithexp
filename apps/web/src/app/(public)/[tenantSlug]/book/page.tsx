import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicBookingCatalog } from "@/server/public-booking-catalog";
import { BookingForm, type BookingFormService } from "./booking-form";

type BookingPageProps = { params: Promise<{ tenantSlug: string }> };

function formatDuration(durationMinutes: number) {
  if (durationMinutes < 60) {
    return `${durationMinutes} min`;
  }

  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

function formatPrice(priceMinor: number, currency: string) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(priceMinor / 100);
}

function toBookingFormService(service: {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
}): BookingFormService {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    duration: formatDuration(service.durationMinutes),
    price: formatPrice(service.priceMinor, service.currency),
  };
}

export async function generateMetadata({
  params,
}: BookingPageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  return {
    title: `Book with ${tenantSlug}`,
    description: `Request an appointment with ${tenantSlug}.`,
    robots: { index: false, follow: false },
  };
}

export default async function BookingPage({ params }: BookingPageProps) {
  const { tenantSlug } = await params;
  const catalog = await loadPublicBookingCatalog(tenantSlug);

  if (!catalog) {
    notFound();
  }

  return (
    <main className="booking-page">
      <header className="booking-header">
        <p className="eyebrow">{catalog.displayName}</p>
        <h1>Request an appointment</h1>
        <p>Choose a service and tell us when you would like to visit.</p>
      </header>

      {catalog.services.length === 0 ? (
        <section
          className="booking-empty"
          aria-labelledby="booking-empty-title"
        >
          <p className="booking-empty-mark" aria-hidden="true">
            ✦
          </p>
          <h2 id="booking-empty-title">
            This business isn&apos;t taking bookings yet
          </h2>
          <p>Check back soon for available services.</p>
        </section>
      ) : (
        <BookingForm
          businessName={catalog.displayName}
          services={catalog.services.map(toBookingFormService)}
        />
      )}
    </main>
  );
}
