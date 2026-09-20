import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadPublicBookingCatalog } from "@/server/public-booking-catalog";

type TenantPageProps = { params: Promise<{ tenantSlug: string }> };

/**
 * Placeholder metadata only. The implemented route must resolve a published
 * tenant on the server and must never trust the slug as authorization context.
 */
export async function generateMetadata({
  params,
}: TenantPageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  const catalog = await loadPublicBookingCatalog(tenantSlug);

  if (!catalog) {
    return {
      title: "Not found",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: catalog.displayName,
    description: `Services and appointment requests for ${catalog.displayName}.`,
    robots: { index: true, follow: true },
  };
}

export default async function TenantPage({ params }: TenantPageProps) {
  const { tenantSlug } = await params;
  const catalog = await loadPublicBookingCatalog(tenantSlug);

  if (!catalog) {
    notFound();
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Published profile</p>
        <h1>{catalog.displayName}</h1>
        <p>
          Review the published services and send a booking request without
          creating an account.
        </p>
        <p>{catalog.services.length} services are currently published.</p>
        <Link className="button" href={`/${tenantSlug}/book`}>
          Book an appointment
        </Link>
      </section>
    </main>
  );
}
