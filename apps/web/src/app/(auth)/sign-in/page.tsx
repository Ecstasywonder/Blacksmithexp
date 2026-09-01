import Link from "next/link";

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { error } = await searchParams;
  return (
    <main className="narrow">
      <p className="eyebrow">Business portal</p>
      <h1>Sign in</h1>
      <p>Use your business account to open your appointment inbox.</p>
      {error ? (
        <p className="booking-error" role="alert">
          We couldn&apos;t sign you in. Check your account access and try again.
        </p>
      ) : null}
      <Link className="button" href="/auth/sign-in">
        Continue to sign in
      </Link>
    </main>
  );
}
