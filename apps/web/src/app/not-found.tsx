import Link from "next/link";

/** Generic response avoids revealing whether an unpublished tenant exists. */
export default function NotFound() {
  return (
    <main className="narrow">
      <h1>Page not found</h1>
      <p>This business page may be unpublished or unavailable.</p>
      <Link href="/">Return home</Link>
    </main>
  );
}
