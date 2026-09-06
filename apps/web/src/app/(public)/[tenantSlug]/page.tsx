import type { Metadata } from "next";
import Link from "next/link";

type TenantPageProps = { params: Promise<{ tenantSlug: string }> };

/**
 * Placeholder metadata only. The implemented route must resolve a published
 * tenant on the server and must never trust the slug as authorization context.
 */
export async function generateMetadata({
  params,
}: TenantPageProps): Promise<Metadata> {
  const { tenantSlug } = await params;
  return {
    title: tenantSlug,
    description: `Services and appointment requests for ${tenantSlug}.`,
    robots: { index: false, follow: false },
  };
}

export default async function TenantPage({ params }: TenantPageProps) {
  const { tenantSlug } = await params;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Tenant page scaffold</p>
        <h1>{tenantSlug}</h1>
        <p>
          Published profile, locations, staff, services, hours, and policy
          content will be loaded on the server.
        </p>
        <Link className="button" href={`/${tenantSlug}/book`}>
          Book an appointment
        </Link>
      </section>
    </main>
  );
}
