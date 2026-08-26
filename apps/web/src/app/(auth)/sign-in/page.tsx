/**
 * Authentication route placeholder.
 * Real provider UI must be introduced through the identity adapter described
 * in Architecture.md; this page deliberately performs no authentication.
 */
export default function SignInPage() {
  return (
    <main className="narrow">
      <p className="eyebrow">Business portal</p>
      <h1>Sign in</h1>
      <p>Authentication provider integration belongs behind the server-side identity adapter.</p>
    </main>
  );
}
