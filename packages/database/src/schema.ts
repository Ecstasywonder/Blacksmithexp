import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Typed relational schema for application queries. Database-specific safety
 * rules that Drizzle cannot fully express (RLS and the GiST overlap exclusion)
 * are maintained in the reviewed SQL migration beside this file.
 */
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const tenantStatus = pgEnum("tenant_status", [
  "active",
  "suspended",
  "deleted",
]);
export const memberRole = pgEnum("member_role", ["owner", "manager", "staff"]);
export const memberStatus = pgEnum("member_status", [
  "invited",
  "active",
  "disabled",
]);
export const appointmentStatus = pgEnum("appointment_status", [
  "pending",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
  "no_show",
]);
export const appointmentSource = pgEnum("appointment_source", [
  "public_web",
  "dashboard",
  "import",
]);
export const actorType = pgEnum("actor_type", [
  "customer",
  "member",
  "system",
  "platform_admin",
]);
export const exceptionKind = pgEnum("exception_kind", ["closed", "available"]);
export const outboxStatus = pgEnum("outbox_status", [
  "pending",
  "processing",
  "delivered",
  "dead",
]);

// Global identities are intentionally separate from tenant memberships.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    oidcIssuer: text("oidc_issuer").notNull(),
    oidcSubject: text("oidc_subject").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    lastSignedInAt: timestamp("last_signed_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_oidc_identity_uq").on(
      table.oidcIssuer,
      table.oidcSubject,
    ),
    index("users_email_idx").on(table.email),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    description: text("description"),
    status: tenantStatus("status").notNull().default("active"),
    isPublished: boolean("is_published").notNull().default(false),
    defaultCurrency: text("default_currency").notNull().default("NGN"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    logoUrl: text("logo_url"),
    coverImageUrl: text("cover_image_url"),
    brandColor: text("brand_color"),
    socialLinks: jsonb("social_links")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    cancellationPolicy: text("cancellation_policy"),
    policyVersion: text("policy_version").notNull().default("initial"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tenants_slug_uq").on(table.slug),
    check(
      "tenants_slug_format_ck",
      sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$'`,
    ),
    check("tenants_currency_ck", sql`${table.defaultCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: memberRole("role").notNull(),
    status: memberStatus("status").notNull().default("invited"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("tenant_members_tenant_user_uq").on(
      table.tenantId,
      table.userId,
    ),
    index("tenant_members_user_idx").on(table.userId, table.status),
  ],
);

export const bookingSettings = pgTable(
  "booking_settings",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(15),
    minimumLeadMinutes: integer("minimum_lead_minutes").notNull().default(60),
    bookingHorizonDays: integer("booking_horizon_days").notNull().default(90),
    pendingExpiryMinutes: integer("pending_expiry_minutes"),
    ...timestamps,
  },
  (table) => [
    check(
      "booking_settings_interval_ck",
      sql`${table.slotIntervalMinutes} between 5 and 240`,
    ),
    check(
      "booking_settings_lead_ck",
      sql`${table.minimumLeadMinutes} between 0 and 525600`,
    ),
    check(
      "booking_settings_horizon_ck",
      sql`${table.bookingHorizonDays} between 1 and 730`,
    ),
  ],
);

// Public catalog and staffing records remain tenant-owned and archiveable.
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    addressLine1: text("address_line_1").notNull(),
    addressLine2: text("address_line_2"),
    city: text("city").notNull(),
    region: text("region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").notNull(),
    timeZone: text("time_zone").notNull(),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("locations_tenant_active_idx").on(table.tenantId, table.isActive),
  ],
);

export const staffMembers = pgTable(
  "staff_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: uuid("user_id").references(() => users.id),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    photoUrl: text("photo_url"),
    isActive: boolean("is_active").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("staff_members_tenant_active_idx").on(table.tenantId, table.isActive),
    uniqueIndex("staff_members_tenant_user_uq").on(
      table.tenantId,
      table.userId,
    ),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("services_tenant_active_sort_idx").on(
      table.tenantId,
      table.isActive,
      table.sortOrder,
    ),
    check(
      "services_duration_ck",
      sql`${table.durationMinutes} between 5 and 1440`,
    ),
    check(
      "services_buffers_ck",
      sql`${table.bufferBeforeMinutes} >= 0 and ${table.bufferAfterMinutes} >= 0`,
    ),
    check("services_price_ck", sql`${table.priceMinor} >= 0`),
    check("services_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const serviceLocations = pgTable(
  "service_locations",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceId, table.locationId] }),
    index("service_locations_tenant_idx").on(table.tenantId),
  ],
);

export const staffServices = pgTable(
  "staff_services",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.staffId, table.serviceId] }),
    index("staff_services_tenant_idx").on(table.tenantId),
  ],
);

// Local recurring hours are combined with UTC date-specific exceptions.
export const weeklyAvailability = pgTable(
  "weekly_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    staffId: uuid("staff_id").references(() => staffMembers.id),
    dayOfWeek: integer("day_of_week").notNull(),
    startsLocalAt: time("starts_local_at").notNull(),
    endsLocalAt: time("ends_local_at").notNull(),
    ...timestamps,
  },
  (table) => [
    index("weekly_availability_lookup_idx").on(
      table.tenantId,
      table.locationId,
      table.staffId,
      table.dayOfWeek,
    ),
    check(
      "weekly_availability_day_ck",
      sql`${table.dayOfWeek} between 0 and 6`,
    ),
    check(
      "weekly_availability_time_ck",
      sql`${table.startsLocalAt} < ${table.endsLocalAt}`,
    ),
  ],
);

export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    staffId: uuid("staff_id").references(() => staffMembers.id),
    kind: exceptionKind("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (table) => [
    index("availability_exceptions_lookup_idx").on(
      table.tenantId,
      table.locationId,
      table.staffId,
      table.startsAt,
    ),
    check(
      "availability_exceptions_range_ck",
      sql`${table.startsAt} < ${table.endsAt}`,
    ),
  ],
);

// Customer PII and appointment history are always protected by tenant RLS.
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    contactDetail: text("contact_detail").notNull(),
    marketingConsentAt: timestamp("marketing_consent_at", {
      withTimezone: true,
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("customers_tenant_email_uq")
      .on(table.tenantId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null`),
    index("customers_tenant_name_idx").on(table.tenantId, table.name),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    publicReference: text("public_reference").notNull(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffMembers.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    customerNameSnapshot: text("customer_name_snapshot").notNull(),
    customerContactSnapshot: text("customer_contact_snapshot").notNull(),
    status: appointmentStatus("status").notNull().default("pending"),
    source: appointmentSource("source").notNull().default("public_web"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timeZone: text("time_zone").notNull(),
    preferredTimeLocalSnapshot: text("preferred_time_local_snapshot").notNull(),
    bufferBeforeMinutesSnapshot: integer("buffer_before_minutes_snapshot")
      .notNull()
      .default(0),
    bufferAfterMinutesSnapshot: integer("buffer_after_minutes_snapshot")
      .notNull()
      .default(0),
    totalPriceMinor: bigint("total_price_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    customerNotes: text("customer_notes"),
    policyVersion: text("policy_version").notNull(),
    manageTokenHash: text("manage_token_hash"),
    manageTokenExpiresAt: timestamp("manage_token_expires_at", {
      withTimezone: true,
    }),
    cancellationReason: text("cancellation_reason"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("appointments_public_reference_uq").on(table.publicReference),
    index("appointments_tenant_status_start_idx").on(
      table.tenantId,
      table.status,
      table.startsAt,
    ),
    index("appointments_tenant_staff_start_idx").on(
      table.tenantId,
      table.staffId,
      table.startsAt,
    ),
    index("appointments_tenant_location_start_idx").on(
      table.tenantId,
      table.locationId,
      table.startsAt,
    ),
    check("appointments_range_ck", sql`${table.startsAt} < ${table.endsAt}`),
    check(
      "appointments_buffer_before_ck",
      sql`${table.bufferBeforeMinutesSnapshot} >= 0`,
    ),
    check(
      "appointments_buffer_after_ck",
      sql`${table.bufferAfterMinutesSnapshot} >= 0`,
    ),
    check("appointments_total_price_ck", sql`${table.totalPriceMinor} >= 0`),
  ],
);

/** Global security counters contain only keyed hashes, never tenant or customer data. */
export const publicEndpointRateLimits = pgTable(
  "public_endpoint_rate_limits",
  {
    scopeHash: text("scope_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeHash, table.windowStartedAt] }),
    check(
      "public_endpoint_rate_limits_scope_ck",
      sql`${table.scopeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "public_endpoint_rate_limits_count_ck",
      sql`${table.requestCount} > 0`,
    ),
  ],
);

// Snapshots and events preserve what was booked even when catalog data changes.
export const appointmentServices = pgTable(
  "appointment_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    serviceId: uuid("service_id").references(() => services.id),
    nameSnapshot: text("name_snapshot").notNull(),
    durationMinutesSnapshot: integer("duration_minutes_snapshot").notNull(),
    priceMinorSnapshot: bigint("price_minor_snapshot", {
      mode: "number",
    }).notNull(),
    currencySnapshot: text("currency_snapshot").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("appointment_services_appointment_idx").on(
      table.tenantId,
      table.appointmentId,
    ),
  ],
);

export const appointmentEvents = pgTable(
  "appointment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    fromStatus: appointmentStatus("from_status"),
    toStatus: appointmentStatus("to_status"),
    reason: text("reason"),
    safeMetadata: jsonb("safe_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("appointment_events_history_idx").on(
      table.tenantId,
      table.appointmentId,
      table.occurredAt,
    ),
  ],
);

// Reliability records make writes retry-safe and side effects asynchronous.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.key] }),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
  ],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    providerMessageId: text("provider_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("outbox_events_claim_idx").on(
      table.status,
      table.availableAt,
      table.createdAt,
    ),
  ],
);

// Audit metadata is deliberately constrained to non-sensitive operational data.
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    requestId: text("request_id").notNull(),
    safeMetadata: jsonb("safe_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_logs_tenant_time_idx").on(table.tenantId, table.occurredAt),
  ],
);
