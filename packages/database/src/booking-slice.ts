import { createHash, randomUUID } from "node:crypto";
import type { ErrorCode } from "@chairly/shared";
import { publicClockTimePattern } from "@chairly/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "./index";
import {
  appointmentServices,
  appointments,
  customers,
  locations,
  services,
  staffMembers,
  staffServices,
  tenantMembers,
  tenants,
} from "./schema";
import { withTenantTransaction } from "./tenant-transaction";
import { resolvePublishedTenantId } from "./public-booking-catalog";

export class BookingSliceError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type RequestPublicAppointmentInput = {
  tenantSlug: string;
  serviceId: string;
  customerName: string;
  contactDetail: string;
  preferredTime: string;
  idempotencyKey: string;
  requestId: string;
};

export type RequestedAppointmentRecord = {
  appointmentId: string;
  publicReference: string;
  businessName: string;
  serviceName: string;
  customerName: string;
  contactDetail: string;
  preferredTime: string;
  status: "pending";
};

export type DashboardAppointmentRecord = RequestedAppointmentRecord & {
  appointmentId: string;
  createdAt: string;
};

export type DashboardMembership = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  userId: string;
  role: "owner" | "manager" | "staff";
};

const bookingDate = { year: 2030, monthIndex: 0, day: 15 };

function hashRequestPayload(input: RequestPublicAppointmentInput) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        tenantSlug: input.tenantSlug,
        serviceId: input.serviceId,
        customerName: input.customerName,
        contactDetail: input.contactDetail,
        preferredTime: input.preferredTime,
      }),
    )
    .digest("hex");
}

function buildPublicReference() {
  return `REQ-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function normalizeContactDetail(contactDetail: string) {
  return contactDetail.trim();
}

function isEmailContactDetail(contactDetail: string) {
  return contactDetail.includes("@");
}

function buildPlaceholderEmail(contactDetail: string) {
  const hash = createHash("sha256")
    .update(contactDetail.trim().toLowerCase())
    .digest("hex");
  return `phone-${hash.slice(0, 24)}@chairly.invalid`;
}

function parsePreferredTime(preferredTime: string) {
  const normalized = preferredTime.trim().toUpperCase().replace(/\s+/g, " ");
  const match = publicClockTimePattern.exec(normalized);

  if (!match) {
    throw new BookingSliceError(
      "VALIDATION_FAILED",
      "Enter a valid time, like 2:30 PM",
      400,
    );
  }

  const hourToken = Number(match[1]);
  const minuteToken = Number(match[2] ?? normalized.slice(3, 5));
  const meridiem = match[3];

  let hour = hourToken % 12;
  if (meridiem === "PM") {
    hour += 12;
  }

  const startsAt = new Date(
    Date.UTC(
      bookingDate.year,
      bookingDate.monthIndex,
      bookingDate.day,
      hour,
      minuteToken,
      0,
      0,
    ),
  );

  return { normalized, startsAt };
}

export async function requestPublicAppointment(
  database: Database,
  input: RequestPublicAppointmentInput,
): Promise<RequestedAppointmentRecord> {
  const normalizedSlug = input.tenantSlug.trim().toLowerCase();
  const tenantId = await resolvePublishedTenantId(database, normalizedSlug);

  if (!tenantId) {
    throw new BookingSliceError("NOT_FOUND", "Business not found", 404);
  }

  const requestHash = hashRequestPayload(input);

  try {
    return await withTenantTransaction(
      database,
      tenantId,
      async (transaction) => {
        await transaction.execute(sql`
        insert into idempotency_keys (tenant_id, key, request_hash, expires_at)
        values (${tenantId}, ${input.idempotencyKey}, ${requestHash}, now() + interval '1 day')
        on conflict do nothing
      `);

        const keyRows = await transaction.execute<{
          requestHash: string;
          responseStatus: number | null;
          responseBody: RequestedAppointmentRecord | null;
        }>(sql`
        select
          request_hash as "requestHash",
          response_status as "responseStatus",
          response_body as "responseBody"
        from idempotency_keys
        where tenant_id = ${tenantId} and key = ${input.idempotencyKey}
        for update
      `);

        const keyRow = keyRows[0];
        if (!keyRow) {
          throw new BookingSliceError(
            "INTERNAL_ERROR",
            "Booking request tracking could not be established",
            500,
          );
        }

        if (keyRow.requestHash !== requestHash) {
          throw new BookingSliceError(
            "IDEMPOTENCY_CONFLICT",
            "That request key was already used for a different booking.",
            409,
          );
        }

        if (keyRow.responseBody) {
          return keyRow.responseBody;
        }

        const [tenant] = await transaction
          .select({
            id: tenants.id,
            displayName: tenants.displayName,
            policyVersion: tenants.policyVersion,
          })
          .from(tenants)
          .where(
            and(
              eq(tenants.id, tenantId),
              eq(tenants.slug, normalizedSlug),
              eq(tenants.status, "active"),
              eq(tenants.isPublished, true),
              isNull(tenants.archivedAt),
            ),
          )
          .limit(1);

        const [service] = await transaction
          .select({
            id: services.id,
            name: services.name,
            durationMinutes: services.durationMinutes,
            priceMinor: services.priceMinor,
            currency: services.currency,
            sortOrder: services.sortOrder,
          })
          .from(services)
          .where(
            and(
              eq(services.tenantId, tenantId),
              eq(services.id, input.serviceId),
              eq(services.isActive, true),
              isNull(services.archivedAt),
            ),
          )
          .limit(1);

        const [location] = await transaction
          .select({
            id: locations.id,
            timeZone: locations.timeZone,
          })
          .from(locations)
          .where(
            and(
              eq(locations.tenantId, tenantId),
              eq(locations.isPrimary, true),
              eq(locations.isActive, true),
              isNull(locations.archivedAt),
            ),
          )
          .limit(1);

        const [staff] = await transaction
          .select({ id: staffMembers.id })
          .from(staffMembers)
          .innerJoin(
            staffServices,
            and(
              eq(staffServices.tenantId, tenantId),
              eq(staffServices.staffId, staffMembers.id),
              eq(staffServices.serviceId, input.serviceId),
            ),
          )
          .where(
            and(
              eq(staffMembers.tenantId, tenantId),
              eq(staffMembers.isActive, true),
              isNull(staffMembers.archivedAt),
            ),
          )
          .orderBy(asc(staffMembers.displayName), asc(staffMembers.id))
          .limit(1);

        if (!tenant || !service || !location || !staff) {
          throw new BookingSliceError(
            "NOT_FOUND",
            "This business is not taking bookings for that service right now.",
            404,
          );
        }

        const parsedTime = parsePreferredTime(input.preferredTime);
        const endsAt = new Date(
          parsedTime.startsAt.getTime() + service.durationMinutes * 60_000,
        );
        const normalizedContactDetail = normalizeContactDetail(
          input.contactDetail,
        );

        let customerId: string;
        const existingCustomer = await transaction.execute<{ id: string }>(sql`
        select id
        from customers
        where tenant_id = ${tenantId}
          and contact_detail = ${normalizedContactDetail}
        limit 1
      `);

        if (existingCustomer[0]?.id) {
          customerId = existingCustomer[0].id;
          await transaction
            .update(customers)
            .set({
              name: input.customerName.trim(),
              email: isEmailContactDetail(normalizedContactDetail)
                ? normalizedContactDetail.toLowerCase()
                : buildPlaceholderEmail(normalizedContactDetail),
              phone: isEmailContactDetail(normalizedContactDetail)
                ? null
                : normalizedContactDetail,
              contactDetail: normalizedContactDetail,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(customers.tenantId, tenantId),
                eq(customers.id, customerId),
              ),
            );
        } else {
          const insertedCustomers = await transaction
            .insert(customers)
            .values({
              tenantId,
              name: input.customerName.trim(),
              email: isEmailContactDetail(normalizedContactDetail)
                ? normalizedContactDetail.toLowerCase()
                : buildPlaceholderEmail(normalizedContactDetail),
              phone: isEmailContactDetail(normalizedContactDetail)
                ? null
                : normalizedContactDetail,
              contactDetail: normalizedContactDetail,
            })
            .returning({ id: customers.id });
          customerId = insertedCustomers[0]?.id ?? "";
        }

        if (!customerId) {
          throw new BookingSliceError(
            "INTERNAL_ERROR",
            "The customer record could not be prepared",
            500,
          );
        }

        const publicReference = buildPublicReference();
        const insertedAppointments = await transaction
          .insert(appointments)
          .values({
            tenantId,
            publicReference,
            locationId: location.id,
            staffId: staff.id,
            customerId,
            status: "pending",
            source: "public_web",
            startsAt: parsedTime.startsAt,
            endsAt,
            timeZone: location.timeZone,
            totalPriceMinor: service.priceMinor,
            currency: service.currency,
            policyVersion: tenant.policyVersion,
            preferredTimeLabel: parsedTime.normalized,
          })
          .returning({ id: appointments.id });

        const appointmentId = insertedAppointments[0]?.id;
        if (!appointmentId) {
          throw new BookingSliceError(
            "INTERNAL_ERROR",
            "The appointment could not be created",
            500,
          );
        }

        await transaction.insert(appointmentServices).values({
          tenantId,
          appointmentId,
          serviceId: service.id,
          nameSnapshot: service.name,
          durationMinutesSnapshot: service.durationMinutes,
          priceMinorSnapshot: service.priceMinor,
          currencySnapshot: service.currency,
          sortOrder: service.sortOrder,
        });

        await transaction.execute(sql`
        insert into appointment_events
          (tenant_id, appointment_id, actor_type, event_type, to_status, safe_metadata)
        values
          (
            ${tenantId},
            ${appointmentId},
            'customer',
            'appointment_requested',
            'pending',
            jsonb_build_object(
              'publicReference', ${publicReference}::text,
              'serviceId', ${service.id}::uuid
            )
          )
      `);

        await transaction.execute(sql`
        insert into audit_logs
          (tenant_id, actor_type, action, target_type, target_id, request_id, safe_metadata)
        values
          (
            ${tenantId},
            'customer',
            'appointment.requested',
            'appointment',
            ${appointmentId},
            ${input.requestId},
            jsonb_build_object(
              'publicReference', ${publicReference}::text,
              'status', 'pending'
            )
          )
      `);

        await transaction.execute(sql`
        insert into outbox_events
          (tenant_id, aggregate_type, aggregate_id, event_type, payload)
        values
          (
            ${tenantId},
            'appointment',
            ${appointmentId},
            'appointment.requested',
            jsonb_build_object(
              'appointmentId', ${appointmentId}::uuid,
              'publicReference', ${publicReference}::text
            )
          )
      `);

        const responseBody: RequestedAppointmentRecord = {
          appointmentId,
          publicReference,
          businessName: tenant.displayName,
          serviceName: service.name,
          customerName: input.customerName.trim(),
          contactDetail: normalizedContactDetail,
          preferredTime: parsedTime.normalized,
          status: "pending",
        };

        await transaction.execute(sql`
        update idempotency_keys
        set response_status = 201, response_body = ${JSON.stringify(responseBody)}::jsonb
        where tenant_id = ${tenantId} and key = ${input.idempotencyKey}
      `);

        return responseBody;
      },
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23P01"
    ) {
      throw new BookingSliceError(
        "BOOKING_SLOT_UNAVAILABLE",
        "That time was just taken. Choose another available time.",
        409,
      );
    }

    throw error;
  }
}

export async function getDashboardMembership(
  database: Database,
  tenantId: string,
  userId: string,
): Promise<DashboardMembership | null> {
  return withTenantTransaction(database, tenantId, async (transaction) => {
    const [membership] = await transaction
      .select({
        tenantId: tenants.id,
        tenantSlug: tenants.slug,
        tenantName: tenants.displayName,
        userId: tenantMembers.userId,
        role: tenantMembers.role,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .where(
        and(
          eq(tenantMembers.tenantId, tenantId),
          eq(tenantMembers.userId, userId),
          eq(tenantMembers.status, "active"),
          eq(tenants.status, "active"),
        ),
      )
      .limit(1);

    return membership ?? null;
  });
}

export async function listDashboardAppointments(
  database: Database,
  tenantId: string,
): Promise<DashboardAppointmentRecord[]> {
  return withTenantTransaction(database, tenantId, async (transaction) => {
    return transaction.execute<DashboardAppointmentRecord>(sql`
      select
        appointments.id as "appointmentId",
        appointments.public_reference as "publicReference",
        tenants.display_name as "businessName",
        appointment_services.name_snapshot as "serviceName",
        appointments.preferred_time_label as "preferredTime",
        customers.name as "customerName",
        customers.contact_detail as "contactDetail",
        appointments.status as "status",
        appointments.created_at::text as "createdAt"
      from appointments
      inner join tenants
        on tenants.id = appointments.tenant_id
       and tenants.id = ${tenantId}
      inner join customers
        on customers.id = appointments.customer_id
       and customers.tenant_id = appointments.tenant_id
      inner join appointment_services
        on appointment_services.appointment_id = appointments.id
       and appointment_services.tenant_id = appointments.tenant_id
       and appointment_services.sort_order = (
         select min(inner_services.sort_order)
         from appointment_services as inner_services
         where inner_services.tenant_id = appointments.tenant_id
           and inner_services.appointment_id = appointments.id
       )
      where appointments.tenant_id = ${tenantId}
        and appointments.status in ('pending', 'confirmed')
      order by appointments.created_at asc
    `);
  });
}
