import Link from "next/link";

/** Static placeholder proving the marketing route and shared styling boundary. */
export default function MarketingPage() {
  return (
    <main className="shell">
      <nav className="nav" aria-label="Primary navigation">
        <span className="brand">Chairly</span>
        <Link href="/sign-in">Business sign in</Link>
      </nav>
      <section className="hero">
        <p className="eyebrow">Your business, bookable online</p>
        <h1>A polished booking page without building a website.</h1>
        <p>
          Give customers one place to discover your services and request a time.
          Review and confirm every appointment from a simple dashboard.
        </p>
        <Link className="button" href="/sign-in">
          Create your business page
        </Link>
      </section>
    </main>
  );
}
