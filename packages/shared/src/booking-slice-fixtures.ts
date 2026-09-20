export const bookingSliceFixtures = {
  owners: {
    luma: {
      userId: "00000000-0000-4000-8000-000000000101",
      email: "owner@luma.example.test",
      displayName: "Luma Owner",
    },
    nova: {
      userId: "00000000-0000-4000-8000-000000000102",
      email: "owner@nova.example.test",
      displayName: "Nova Owner",
    },
    quiet: {
      userId: "00000000-0000-4000-8000-000000000103",
      email: "owner@quiet.example.test",
      displayName: "Quiet Owner",
    },
  },
  tenants: {
    luma: {
      id: "10000000-0000-4000-8000-000000000001",
      slug: "luma-studio",
      displayName: "Luma Studio",
    },
    nova: {
      id: "10000000-0000-4000-8000-000000000002",
      slug: "nova-studio",
      displayName: "Nova Studio",
    },
    quiet: {
      id: "10000000-0000-4000-8000-000000000003",
      slug: "quiet-studio",
      displayName: "Quiet Studio",
    },
  },
  locations: {
    luma: {
      id: "30000000-0000-4000-8000-000000000001",
      timeZone: "UTC",
    },
    nova: {
      id: "30000000-0000-4000-8000-000000000002",
      timeZone: "UTC",
    },
    quiet: {
      id: "30000000-0000-4000-8000-000000000003",
      timeZone: "UTC",
    },
  },
  staff: {
    luma: {
      id: "40000000-0000-4000-8000-000000000001",
      displayName: "Maya Cole",
    },
    nova: {
      id: "40000000-0000-4000-8000-000000000002",
      displayName: "Jordan Reed",
    },
  },
  services: {
    lumaSilkPress: {
      id: "20000000-0000-4000-8000-000000000001",
      tenantId: "10000000-0000-4000-8000-000000000001",
      name: "Signature silk press",
      durationMinutes: 90,
      priceMinor: 3500000,
      currency: "NGN",
    },
    lumaBraids: {
      id: "20000000-0000-4000-8000-000000000002",
      tenantId: "10000000-0000-4000-8000-000000000001",
      name: "Knotless braids",
      durationMinutes: 240,
      priceMinor: 5500000,
      currency: "NGN",
    },
    lumaWash: {
      id: "20000000-0000-4000-8000-000000000003",
      tenantId: "10000000-0000-4000-8000-000000000001",
      name: "Wash and treatment",
      durationMinutes: 45,
      priceMinor: 1500000,
      currency: "NGN",
    },
    novaCut: {
      id: "20000000-0000-4000-8000-000000000004",
      tenantId: "10000000-0000-4000-8000-000000000002",
      name: "Precision fade",
      durationMinutes: 60,
      priceMinor: 2200000,
      currency: "NGN",
    },
  },
} as const;

export type BookingSliceFixtures = typeof bookingSliceFixtures;
