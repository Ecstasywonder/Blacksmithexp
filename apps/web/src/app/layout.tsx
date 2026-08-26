import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

// Global metadata is intentionally generic until the product name is finalized.
export const metadata: Metadata = {
  title: {
    default: "Chairly",
    template: "%s | Chairly",
  },
  description: "Simple websites and appointment requests for beauty and grooming businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
