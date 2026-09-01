import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  AppointmentRequestRepository,
  RequestAppointmentFailure,
  RequestAppointmentCommand,
  RequestAppointmentResult,
} from "@chairly/domain";
import { appointmentRequestIdentity } from "@chairly/domain";
import type { Database } from "./index";
import {
  withTenantTransaction,
  type TenantTransaction,
} from "./tenant-transaction";

const tenantSlugPattern = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AssignmentRow = {
  policyVersion: string;
  serviceId: string;
  serviceName: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceMinor: number;
  currency: string;
  locationId: string;
  timeZone: string;
  staffId: string;
  slotIntervalMinutes: number;
  minimumLeadMinutes: number;
  bookingHorizonDays: number;
};

type AssignmentSelection =
  | Readonly<{
      ok: true;
      assignment: AssignmentRow;
      startsAt: Date;
      endsAt: Date;
    }>
  | Readonly<{
      ok: false;
      reason: "invalid_preferred_time" | "slot_unavailable";
    }>;

type PendingAppointmentRow = {
  id: string;
  status: "pending";
  serviceName: string;
  preferredTime: string;
  timeZone: string;
  customerName: string;
  customerContact: string;
  createdAt: Date;
};

export type PendingAppointment = Readonly<PendingAppointmentRow>;

export type OwnerPendingAppointments = Readonly<{
  tenantId: string;
  tenantSlug: string;
  businessName: string;
  appointments: readonly PendingAppointment[];
}>;

type IdempotencyRow = {
  requestHash: string;
  responseBody: unknown;
};

const replayableFailureReasons = new Set([
  "service_unavailable",
  "assignment_unavailable",
  "invalid_preferred_time",
  "slot_unavailable",
]);

function requestHash(command: RequestAppointmentCommand): string {
  return createHash("sha256")
    .update(appointmentRequestIdentity(command))
    .digest("hex");
}

function transportIdempotencyKey(key: string): string {
  return `public-request:${key}`;
}

function fingerprintIdempotencyKey(hash: string): string {
  return `public-fingerprint:v1:${hash}`;
}

function replayResult(value: unknown): RequestAppointmentResult | null {
  if (typeof value !== "object" || value === null || !("ok" in value)) {
    return null;
  }

  if (value.ok === true && "appointment" in value) {
    const appointment = value.appointment;
    if (
      typeof appointment === "object" &&
      appointment !== null &&
      "id" in appointment &&
      typeof appointment.id === "string" &&
      "status" in appointment &&
      appointment.status === "pending"
    ) {
      return {
        ok: true,
        appointment: { id: appointment.id, status: "pending" },
        outcome: "duplicate",
      };
    }
  }

  if (
    value.ok === false &&
    "reason" in value &&
    typeof value.reason === "string" &&
    replayableFailureReasons.has(value.reason)
  ) {
    return {
      ok: false,
      reason: value.reason as Exclude<
        RequestAppointmentFailure,
        "tenant_not_found" | "idempotency_conflict"
      >,
    };
  }

  return null;
}

async function storeIdempotentResult(
  transaction: TenantTransaction,
  tenantId: string,
  idempotencyKey: string,
  result: RequestAppointmentResult,
): Promise<RequestAppointmentResult> {
  const responseStatus = result.ok
    ? result.outcome === "created"
      ? 201
      : 200
    : result.reason === "slot_unavailable"
      ? 409
      : 422;
  await transaction.execute(sql`
    update idempotency_keys
    set
      response_status = ${responseStatus},
      response_body = ${JSON.stringify(result)}::jsonb
    where tenant_id = ${tenantId}
      and key = ${idempotencyKey}
  `);
  return result;
}

function hasPostgresCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function resolvePublishedTenant(
  database: Database,
  tenantSlug: string,
): Promise<string | null> {
  const normalizedSlug = tenantSlug.trim().toLowerCase();
  if (!tenantSlugPattern.test(normalizedSlug)) {
    return null;
  }

  const rows = await database.execute<{ tenantId: string | null }>(
    sql`select app.resolve_published_tenant(${normalizedSlug}) as "tenantId"`,
  );
  return rows[0]?.tenantId ?? null;
}

async function selectAvailableAssignment(
  transaction: TenantTransaction,
  tenantId: string,
  command: RequestAppointmentCommand,
  assignments: readonly AssignmentRow[],
): Promise<AssignmentSelection> {
  let hasValidPreferredTime = false;

  for (const assignment of assignments) {
    const preferredTimes = await transaction.execute<{
      startsAt: Date;
      roundTrip: string;
      meetsLeadTime: boolean;
      withinHorizon: boolean;
      alignsToSlot: boolean;
    }>(sql`
      select
        (${command.preferredTime}::timestamp at time zone ${assignment.timeZone}) as "startsAt",
        to_char(
          (${command.preferredTime}::timestamp at time zone ${assignment.timeZone})
            at time zone ${assignment.timeZone},
          'YYYY-MM-DD"T"HH24:MI'
        ) as "roundTrip",
        (${command.preferredTime}::timestamp at time zone ${assignment.timeZone})
          >= statement_timestamp() + make_interval(mins => ${assignment.minimumLeadMinutes})
          as "meetsLeadTime",
        (${command.preferredTime}::timestamp at time zone ${assignment.timeZone})
          <= statement_timestamp() + make_interval(days => ${assignment.bookingHorizonDays})
          as "withinHorizon",
        mod(
          extract(hour from ${command.preferredTime}::timestamp)::integer * 60
            + extract(minute from ${command.preferredTime}::timestamp)::integer,
          ${assignment.slotIntervalMinutes}
        ) = 0 as "alignsToSlot"
    `);
    const preferred = preferredTimes[0];
    if (
      !preferred ||
      preferred.roundTrip !== command.preferredTime ||
      !preferred.meetsLeadTime ||
      !preferred.withinHorizon ||
      !preferred.alignsToSlot
    ) {
      continue;
    }
    hasValidPreferredTime = true;

    const endsAt = new Date(
      preferred.startsAt.getTime() + assignment.durationMinutes * 60_000,
    );
    const bufferedStartsAt = new Date(
      preferred.startsAt.getTime() - assignment.bufferBeforeMinutes * 60_000,
    );
    const bufferedEndsAt = new Date(
      endsAt.getTime() + assignment.bufferAfterMinutes * 60_000,
    );

    const availabilityRows = await transaction.execute<{
      isAvailable: boolean;
    }>(sql`
      select (
        (
          exists (
            select 1
            from weekly_availability
            where tenant_id = ${tenantId}
              and location_id = ${assignment.locationId}
              and (staff_id is null or staff_id = ${assignment.staffId})
              and day_of_week = extract(dow from ${command.preferredTime}::timestamp)::integer
              and ${command.preferredTime}::timestamp
                    - make_interval(mins => ${assignment.bufferBeforeMinutes})
                  >= date_trunc('day', ${command.preferredTime}::timestamp) + starts_local_at
              and ${command.preferredTime}::timestamp
                    + make_interval(
                        mins => ${assignment.durationMinutes + assignment.bufferAfterMinutes}
                      )
                  <= date_trunc('day', ${command.preferredTime}::timestamp) + ends_local_at
          )
          or exists (
            select 1
            from availability_exceptions
            where tenant_id = ${tenantId}
              and location_id = ${assignment.locationId}
              and (staff_id is null or staff_id = ${assignment.staffId})
              and kind = 'available'
              and starts_at <= ${bufferedStartsAt}
              and ends_at >= ${bufferedEndsAt}
          )
        )
        and not exists (
          select 1
          from availability_exceptions
          where tenant_id = ${tenantId}
            and location_id = ${assignment.locationId}
            and (staff_id is null or staff_id = ${assignment.staffId})
            and kind = 'closed'
            and starts_at < ${bufferedEndsAt}
            and ends_at > ${bufferedStartsAt}
        )
      ) as "isAvailable"
    `);
    if (availabilityRows[0]?.isAvailable !== true) {
      continue;
    }

    // Consistent lock ordering serializes claims for this staff member before
    // the transactional recheck. The exclusion constraint remains the final
    // authority if another writer bypasses this repository.
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${assignment.staffId}, 0))`,
    );
    const conflicts = await transaction.execute<{ id: string }>(sql`
      select id
      from appointments
      where tenant_id = ${tenantId}
        and staff_id = ${assignment.staffId}
        and status in ('pending', 'confirmed')
        and starts_at
              - buffer_before_minutes_snapshot * interval '1 minute'
            < ${bufferedEndsAt}
        and ends_at
              + buffer_after_minutes_snapshot * interval '1 minute'
            > ${bufferedStartsAt}
      limit 1
    `);
    if (conflicts.length === 0) {
      return {
        ok: true,
        assignment,
        startsAt: preferred.startsAt,
        endsAt,
      };
    }
  }

  return {
    ok: false,
    reason: hasValidPreferredTime
      ? "slot_unavailable"
      : "invalid_preferred_time",
  };
}

export class PostgresAppointmentRequestRepository implements AppointmentRequestRepository {
  constructor(private readonly database: Database) {}

  async createPendingAppointment(
    command: RequestAppointmentCommand,
  ): Promise<RequestAppointmentResult> {
    const tenantId = await resolvePublishedTenant(
      this.database,
      command.tenantSlug,
    );
    if (!tenantId) {
      return { ok: false, reason: "tenant_not_found" };
    }

    try {
      return await withTenantTransaction(
        this.database,
        tenantId,
        async (transaction) => {
          const commandHash = requestHash(command);
          const requestKey = transportIdempotencyKey(command.idempotencyKey);
          const fingerprintKey = fingerprintIdempotencyKey(commandHash);
          await transaction.execute(sql`
            insert into idempotency_keys (
              tenant_id,
              key,
              request_hash,
              expires_at
            ) values (
              ${tenantId},
              ${requestKey},
              ${commandHash},
              now() + interval '24 hours'
            )
            on conflict (tenant_id, key) do update set
              request_hash = excluded.request_hash,
              response_status = null,
              response_body = null,
              created_at = now(),
              expires_at = excluded.expires_at
            where idempotency_keys.expires_at <= now()
          `);
          const idempotencyRows = await transaction.execute<IdempotencyRow>(sql`
            select
              request_hash as "requestHash",
              response_body as "responseBody"
            from idempotency_keys
            where tenant_id = ${tenantId}
              and key = ${requestKey}
            for update
          `);
          const idempotency = idempotencyRows[0];
          if (!idempotency) {
            throw new Error("Idempotency key insert did not return a row");
          }
          if (idempotency.requestHash !== commandHash) {
            return { ok: false, reason: "idempotency_conflict" };
          }
          const replay = replayResult(idempotency.responseBody);
          if (replay) {
            return replay;
          }

          // Serialize the normalized content identity independently from the
          // browser-generated key. This closes the race between two different
          // requests carrying the same form values without joining tenants.
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${commandHash}`}, 0))`,
          );
          await transaction.execute(sql`
            delete from idempotency_keys
            where tenant_id = ${tenantId}
              and key = ${fingerprintKey}
              and expires_at <= now()
          `);
          const fingerprintRows = await transaction.execute<IdempotencyRow>(sql`
              select
                request_hash as "requestHash",
                response_body as "responseBody"
              from idempotency_keys
              where tenant_id = ${tenantId}
                and key = ${fingerprintKey}
              for update
            `);
          const fingerprint = fingerprintRows[0];
          if (fingerprint) {
            if (fingerprint.requestHash !== commandHash) {
              throw new Error("Booking fingerprint hash mismatch");
            }
            const duplicate = replayResult(fingerprint.responseBody);
            if (!duplicate?.ok) {
              throw new Error("Booking fingerprint result is incomplete");
            }
            return storeIdempotentResult(
              transaction,
              tenantId,
              requestKey,
              duplicate,
            );
          }

          await transaction.execute(sql`
            insert into idempotency_keys (
              tenant_id,
              key,
              request_hash,
              expires_at
            ) values (
              ${tenantId},
              ${fingerprintKey},
              ${commandHash},
              now() + interval '24 hours'
            )
          `);

          const complete = async (result: RequestAppointmentResult) => {
            if (!result.ok) {
              await transaction.execute(sql`
                delete from idempotency_keys
                where tenant_id = ${tenantId}
                  and key = ${fingerprintKey}
              `);
              return storeIdempotentResult(
                transaction,
                tenantId,
                requestKey,
                result,
              );
            }

            await storeIdempotentResult(
              transaction,
              tenantId,
              fingerprintKey,
              result,
            );
            return storeIdempotentResult(
              transaction,
              tenantId,
              requestKey,
              result,
            );
          };

          const assignments = await transaction.execute<AssignmentRow>(sql`
            select
              tenant.policy_version as "policyVersion",
              service.id as "serviceId",
              service.name as "serviceName",
              service.duration_minutes as "durationMinutes",
              service.buffer_before_minutes as "bufferBeforeMinutes",
              service.buffer_after_minutes as "bufferAfterMinutes",
              service.price_minor as "priceMinor",
              service.currency,
              location.id as "locationId",
              location.time_zone as "timeZone",
              staff.id as "staffId",
              coalesce(setting.slot_interval_minutes, 15) as "slotIntervalMinutes",
              coalesce(setting.minimum_lead_minutes, 60) as "minimumLeadMinutes",
              coalesce(setting.booking_horizon_days, 90) as "bookingHorizonDays"
            from tenants as tenant
            left join booking_settings as setting
              on setting.tenant_id = tenant.id
            join services as service
              on service.tenant_id = tenant.id
            join service_locations as service_location
              on service_location.tenant_id = tenant.id
             and service_location.service_id = service.id
            join locations as location
              on location.tenant_id = tenant.id
             and location.id = service_location.location_id
            join staff_services as staff_service
              on staff_service.tenant_id = tenant.id
             and staff_service.service_id = service.id
            join staff_members as staff
              on staff.tenant_id = tenant.id
             and staff.id = staff_service.staff_id
            where tenant.id = ${tenantId}
              and tenant.slug = ${command.tenantSlug.trim().toLowerCase()}
              and tenant.status = 'active'
              and tenant.is_published = true
              and tenant.archived_at is null
              and service.id = ${command.serviceId}
              and service.is_active = true
              and service.archived_at is null
              and location.is_active = true
              and location.archived_at is null
              and staff.is_active = true
              and staff.archived_at is null
            order by location.is_primary desc, location.id, staff.id
          `);

          if (assignments.length === 0) {
            const serviceRows = await transaction.execute<{ exists: boolean }>(
              sql`
                select exists(
                  select 1 from services
                  where tenant_id = ${tenantId}
                    and id = ${command.serviceId}
                    and is_active = true
                    and archived_at is null
                ) as "exists"
              `,
            );
            return complete({
              ok: false,
              reason: serviceRows[0]?.exists
                ? "assignment_unavailable"
                : "service_unavailable",
            });
          }

          const selected = await selectAvailableAssignment(
            transaction,
            tenantId,
            command,
            assignments,
          );
          if (!selected.ok) {
            return complete({ ok: false, reason: selected.reason });
          }
          const { assignment, startsAt, endsAt } = selected;

          const isEmail = emailPattern.test(command.contactDetail);
          const customerRows = isEmail
            ? await transaction.execute<{ id: string }>(sql`
                insert into customers
                  (tenant_id, name, email, phone, contact_detail)
                values
                  (${tenantId}, ${command.customerName}, ${command.contactDetail.toLowerCase()}, null, ${command.contactDetail})
                on conflict (tenant_id, lower(email)) where email is not null
                do update set
                  name = excluded.name,
                  contact_detail = excluded.contact_detail,
                  updated_at = now()
                returning id
              `)
            : await transaction.execute<{ id: string }>(sql`
                insert into customers
                  (tenant_id, name, email, phone, contact_detail)
                values
                  (${tenantId}, ${command.customerName}, null, ${command.contactDetail}, ${command.contactDetail})
                returning id
              `);
          const customerId = customerRows[0]?.id;
          if (!customerId) {
            throw new Error("Customer insert did not return an identifier");
          }

          const appointmentRows = await transaction.execute<{
            id: string;
            status: "pending";
          }>(sql`
            insert into appointments (
              tenant_id,
              public_reference,
              location_id,
              staff_id,
              customer_id,
              customer_name_snapshot,
              customer_contact_snapshot,
              status,
              source,
              starts_at,
              ends_at,
              time_zone,
              preferred_time_local_snapshot,
              buffer_before_minutes_snapshot,
              buffer_after_minutes_snapshot,
              total_price_minor,
              currency,
              policy_version
            ) values (
              ${tenantId},
              ${randomUUID()},
              ${assignment.locationId},
              ${assignment.staffId},
              ${customerId},
              ${command.customerName},
              ${command.contactDetail},
              'pending',
              'public_web',
              ${startsAt},
              ${endsAt},
              ${assignment.timeZone},
              ${command.preferredTime},
              ${assignment.bufferBeforeMinutes},
              ${assignment.bufferAfterMinutes},
              ${assignment.priceMinor},
              ${assignment.currency},
              ${assignment.policyVersion}
            )
            returning id, status
          `);
          const appointment = appointmentRows[0];
          if (!appointment) {
            throw new Error("Appointment insert did not return an identifier");
          }

          await transaction.execute(sql`
            insert into appointment_services (
              tenant_id,
              appointment_id,
              service_id,
              name_snapshot,
              duration_minutes_snapshot,
              price_minor_snapshot,
              currency_snapshot,
              sort_order
            ) values (
              ${tenantId},
              ${appointment.id},
              ${assignment.serviceId},
              ${assignment.serviceName},
              ${assignment.durationMinutes},
              ${assignment.priceMinor},
              ${assignment.currency},
              0
            )
          `);

          await transaction.execute(sql`
            insert into appointment_events (
              tenant_id,
              appointment_id,
              actor_type,
              event_type,
              from_status,
              to_status,
              safe_metadata
            ) values (
              ${tenantId},
              ${appointment.id},
              'customer',
              'appointment.requested',
              null,
              'pending',
              '{}'::jsonb
            )
          `);

          await transaction.execute(sql`
            insert into audit_logs (
              tenant_id,
              actor_type,
              action,
              target_type,
              target_id,
              request_id,
              safe_metadata
            ) values (
              ${tenantId},
              'customer',
              'appointment.requested',
              'appointment',
              ${appointment.id},
              ${command.requestId},
              '{}'::jsonb
            )
          `);

          await transaction.execute(sql`
            insert into outbox_events (
              tenant_id,
              aggregate_type,
              aggregate_id,
              event_type,
              payload
            ) values (
              ${tenantId},
              'appointment',
              ${appointment.id},
              'appointment.requested',
              ${JSON.stringify({ appointmentId: appointment.id })}::jsonb
            )
          `);

          return complete({ ok: true, appointment, outcome: "created" });
        },
      );
    } catch (error) {
      if (hasPostgresCode(error, "23P01")) {
        return { ok: false, reason: "slot_unavailable" };
      }
      throw error;
    }
  }
}

export async function getOwnerPendingAppointments(
  database: Database,
  authenticatedUserId: string,
  tenantId: string,
): Promise<OwnerPendingAppointments | null> {
  return withTenantTransaction(database, tenantId, async (transaction) => {
    const authorizedTenants = await transaction.execute<{
      tenantId: string;
      tenantSlug: string;
      businessName: string;
    }>(sql`
      select
        tenant.id as "tenantId",
        tenant.slug as "tenantSlug",
        tenant.display_name as "businessName"
      from tenant_members as membership
      join tenants as tenant
        on tenant.id = membership.tenant_id
      where membership.tenant_id = ${tenantId}
        and membership.user_id = ${authenticatedUserId}
        and membership.role = 'owner'
        and membership.status = 'active'
        and tenant.status = 'active'
        and tenant.archived_at is null
      limit 1
    `);
    const authorizedTenant = authorizedTenants[0];
    if (!authorizedTenant) {
      return null;
    }

    const pendingAppointments =
      await transaction.execute<PendingAppointmentRow>(
        sql`
        select
          appointment.id,
          appointment.status,
          appointment_service.name_snapshot as "serviceName",
          appointment.preferred_time_local_snapshot as "preferredTime",
          appointment.time_zone as "timeZone",
          appointment.customer_name_snapshot as "customerName",
          appointment.customer_contact_snapshot as "customerContact",
          appointment.created_at as "createdAt"
        from appointments as appointment
        join appointment_services as appointment_service
          on appointment_service.tenant_id = appointment.tenant_id
         and appointment_service.appointment_id = appointment.id
         and appointment_service.sort_order = 0
        where appointment.tenant_id = ${tenantId}
          and appointment.status = 'pending'
        order by appointment.created_at asc, appointment.id asc
      `,
      );

    return {
      ...authorizedTenant,
      appointments: [...pendingAppointments],
    };
  });
}
