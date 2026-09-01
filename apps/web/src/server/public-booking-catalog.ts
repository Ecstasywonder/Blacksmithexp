import "server-only";

import {
  getPublishedBookingCatalog,
  type PublicBookingCatalog,
} from "@chairly/database";
import { getDatabase } from "./database";

const syntheticCatalogs: Readonly<Record<string, PublicBookingCatalog>> = {
  "luma-studio": {
    tenantId: "10000000-0000-4000-8000-000000000001",
    displayName: "Luma Studio",
    services: [
      {
        id: "20000000-0000-4000-8000-000000000001",
        name: "Signature silk press",
        description: "A smooth finish with a cleanse, treatment, and trim.",
        durationMinutes: 90,
        priceMinor: 3500000,
        currency: "NGN",
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        name: "Knotless braids",
        description:
          "Lightweight, mid-back knotless braids with hair included.",
        durationMinutes: 240,
        priceMinor: 5500000,
        currency: "NGN",
      },
      {
        id: "20000000-0000-4000-8000-000000000003",
        name: "Wash and treatment",
        description: null,
        durationMinutes: 45,
        priceMinor: 1500000,
        currency: "NGN",
      },
    ],
  },
  "quiet-studio": {
    tenantId: "10000000-0000-4000-8000-000000000002",
    displayName: "Quiet Studio",
    services: [],
  },
  "ember-studio": {
    tenantId: "10000000-0000-4000-8000-000000000003",
    displayName: "Ember Studio",
    services: [
      {
        id: "20000000-0000-4000-8000-000000000004",
        name: "Signature silk press",
        description: "A smooth finish with a cleanse, treatment, and trim.",
        durationMinutes: 90,
        priceMinor: 3500000,
        currency: "NGN",
      },
    ],
  },
};

export function isSyntheticBookingEnvironment(): boolean {
  return (
    process.env.CHAIRLY_E2E_CATALOG === "synthetic" &&
    (process.env.NODE_ENV !== "production" ||
      process.env.CHAIRLY_E2E_PRODUCTION_BUILD === "true")
  );
}

export function getSyntheticBookingCatalog(tenantSlug: string) {
  if (!isSyntheticBookingEnvironment()) {
    return null;
  }

  return syntheticCatalogs[tenantSlug.toLowerCase()] ?? null;
}

export async function loadPublicBookingCatalog(tenantSlug: string) {
  if (isSyntheticBookingEnvironment()) {
    return getSyntheticBookingCatalog(tenantSlug);
  }

  return getPublishedBookingCatalog(getDatabase().db, tenantSlug);
}
