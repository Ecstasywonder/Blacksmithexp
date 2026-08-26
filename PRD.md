# Product Requirements Document: Chairly

**Status:** Draft for implementation  
**Version:** 0.1  
**Last updated:** 2026-08-26  
**Working name:** Chairly (replace before public launch)

## 1. Product summary

Chairly is a multi-tenant booking and web-presence platform for independent hair salons, barbers, makeup artists, nail technicians, beauty professionals, and similar appointment-based small businesses that do not have a website or online booking page.

Each business receives:

- a mobile-first public landing page with its own slug, branding, contact details, locations, services, staff, business hours, and policies;
- an appointment flow customers can complete without creating an account;
- a private dashboard where authorized business users review, confirm, decline, reschedule, cancel, and complete appointments; and
- notifications and a reliable audit trail for booking changes.

The first release is a booking-request product: a customer requests a valid available slot, and the business explicitly confirms or declines it. The platform must prevent overlapping active appointments for the same staff member.

## 2. Problem statement

Many small beauty and grooming businesses rely on social media profiles, phone calls, and direct messages. Customers cannot reliably discover current services, prices, hours, or available times, while owners spend significant time coordinating schedules manually. Information is fragmented, booking requests are easy to miss, and double-bookings are common.

## 3. Goals and success measures

### Goals

1. Let a business publish a useful booking page in under 15 minutes.
2. Let a customer submit an appointment request in under 3 minutes on a mobile device.
3. Give a business a single queue for responding to booking requests.
4. Enforce strict tenant data isolation and staff schedule integrity.
5. Provide a foundation for payments, custom domains, and automated reminders without requiring those features in the MVP.

### MVP success measures

| Measure | Target after first 90 days |
| --- | --- |
| Onboarding completion | At least 60% of businesses that start onboarding publish a page |
| Time to publish | Median below 15 minutes |
| Booking completion | At least 50% of customers who select a service submit a request |
| Business response | Median time from request to decision below 4 business hours |
| Booking conflicts | Zero confirmed overlapping appointments for one staff member |
| Reliability | 99.9% monthly availability, excluding planned maintenance |
| Tenant isolation | Zero cross-tenant data exposure incidents |

## 4. Personas and permissions

### Customer

An unauthenticated visitor who discovers a business page, reviews services and staff, and requests an appointment. Customers may manage an appointment through a time-limited, signed link sent to their email or phone.

### Business owner

Creates and owns a tenant, manages business details, branding, locations, services, staff, hours, policies, members, and all appointments. Only an owner may transfer ownership or delete the tenant.

### Manager

Manages the public page, services, staff schedules, customers, and appointments. Cannot transfer ownership or delete the tenant.

### Staff member

Views their schedule and assigned appointments and may update permitted appointment statuses. A staff profile need not have a login account.

### Platform administrator

Supports tenants and investigates operational issues through separately authorized, audited tooling. Platform administrators do not silently impersonate tenant users.

## 5. Scope

### MVP (P0)

- Business sign-up, sign-in, password recovery, and tenant creation.
- One user may belong to multiple tenants and switch between them.
- Tenant roles: owner, manager, and staff.
- Business profile: display name, slug, description, logo, cover image, brand color, phone, email, social links, cancellation policy, and publication state.
- One or more business locations, each with address, contact details, timezone, and business hours.
- Services with name, description, duration, price, category, active state, and staff eligibility.
- Staff profiles, service eligibility, weekly availability, breaks, and date-specific exceptions.
- Public landing page at `/{tenantSlug}`.
- Public booking flow: service, optional preferred staff, date/time, customer details, policy consent, review, and submission.
- Availability calculated from location hours, staff hours, exceptions, service duration, lead time, booking horizon, and existing active appointments.
- Booking request states and business actions.
- Customer and business email notifications for booking lifecycle events.
- Dashboard with upcoming, pending, and historical appointments.
- Search/filter by date, status, staff, service, and customer.
- Calendar/list views suitable for desktop and mobile.
- Tenant-scoped audit log for sensitive changes.
- Accessibility, security, observability, backup, and privacy baselines.

### Near-term (P1)

- Rescheduling proposed by either party.
- Customer self-service cancellation through a signed link.
- SMS/WhatsApp notifications through a provider adapter.
- Calendar export and Google/Microsoft calendar synchronization.
- Deposits and full payments.
- Coupons, packages, add-ons, and configurable taxes.
- Custom domains and deeper theme customization.
- Waitlists, recurring appointments, and automated reminders.
- Basic utilization, bookings, cancellations, and revenue reports.

### Out of scope for MVP

- Marketplace discovery across all businesses.
- Payroll, inventory, accounting, point-of-sale, and employee commissions.
- Native mobile applications.
- Customer social accounts or public reviews.
- Platform-mediated dispute resolution.
- Multi-currency within a single tenant.
- Automated acceptance of requests; a business must confirm each request in MVP.

## 6. Core journeys

### 6.1 Business onboarding and publishing

1. User creates an account and verifies their email.
2. User creates a business with a unique slug and default timezone/currency.
3. User enters business contact and location information.
4. User creates at least one active service and one staff member.
5. User configures weekly availability and booking rules.
6. System validates publishing prerequisites.
7. User previews and publishes the landing page.

**Publish prerequisites:** active tenant; unique valid slug; display name; contact method; active location with timezone; at least one active service; eligible active staff; and at least one future bookable interval.

### 6.2 Customer requests an appointment

1. Customer visits `/{tenantSlug}` and selects “Book an appointment.”
2. Customer selects a location, service, and optionally a staff member.
3. System shows only slots that can accommodate the complete service duration.
4. Customer selects a slot and enters name, email, optional phone, and notes.
5. Customer accepts the tenant's booking/cancellation policy and submits.
6. Server revalidates availability in a transaction and creates a `pending` appointment.
7. Customer receives an acknowledgement and the business receives a new-request notification.

### 6.3 Business responds to a request

1. Authorized user opens the pending appointment queue.
2. User reviews customer, service, staff, schedule, and notes.
3. User confirms or declines the request; a decline may include a customer-facing reason.
4. System writes an appointment event and notification to the same transaction.
5. Customer receives the result. Confirmed appointments remain protected from overlap.

### 6.4 Cancellation and completion

- An authorized business user may cancel a pending or confirmed appointment with a reason.
- A customer cancellation link is signed, single-purpose, rate-limited, and subject to policy.
- Staff or managers may mark a confirmed appointment completed after its start time.
- No status record is deleted; all transitions are appended to the event history.

## 7. Functional requirements

### FR-1 Tenant and membership management

- Every tenant-owned record carries a non-null `tenant_id`.
- A user may have memberships in multiple tenants.
- Every private request derives tenant context from the authenticated membership, never from an untrusted body field alone.
- Tenant role checks are enforced on the server for every mutation.
- Ownership transfer requires explicit confirmation and leaves at least one owner.
- Tenant deletion is soft deletion followed by a documented retention workflow.

### FR-2 Public page and branding

- Slugs are lowercase, 3-50 characters, use letters/numbers/hyphens, cannot start/end with a hyphen, and cannot match reserved platform routes.
- A tenant can save a draft independently of publication.
- Unpublished, suspended, or deleted tenants return a generic not-found response publicly.
- Public pages include structured metadata, share metadata, accessible semantic content, and indexability controls.
- Uploaded assets must be type/size validated and served through managed object storage/CDN.

### FR-3 Services, staff, locations, and schedules

- Prices are stored as integer minor units with an ISO 4217 currency code.
- Durations and buffer times are stored in minutes.
- Inactive/archived services and staff are hidden from new bookings but retained on historical appointments.
- Weekly schedules may be overridden by date-specific closures or added availability.
- A staff member is bookable only for services to which they are assigned at the selected location.

### FR-4 Availability

- The business configures slot interval, minimum lead time, maximum booking horizon, and default buffers.
- Availability is computed in the location timezone and returned as UTC instants plus timezone display information.
- A slot is valid only when the service plus buffers fits wholly within location and staff availability and does not overlap a pending or confirmed appointment.
- “Any professional” selects an eligible available staff member deterministically inside the booking transaction.
- Displayed availability is advisory; submission always revalidates because another customer may claim a slot first.

### FR-5 Appointment lifecycle

Allowed states:

- `pending`: customer submitted; awaiting business response.
- `confirmed`: business accepted.
- `declined`: business rejected.
- `cancelled`: customer or business cancelled.
- `completed`: service delivered.
- `no_show`: customer did not attend.

Allowed transitions:

| From | To | Actor |
| --- | --- | --- |
| pending | confirmed, declined, cancelled | owner/manager; customer may cancel |
| confirmed | cancelled, completed, no_show | owner/manager/staff as permitted; customer may cancel |
| declined | none | terminal |
| cancelled | none | terminal; rescheduling creates a linked appointment |
| completed | none | terminal |
| no_show | none | terminal |

- Appointment writes require an idempotency key.
- Appointment services snapshot the name, duration, and price at booking time.
- Every transition records actor, timestamp, prior/new state, source, and optional reason.
- Customer notes are treated as sensitive free text and never included in analytics events.

### FR-6 Notifications

- Email events: request received, request confirmed, declined, cancelled, rescheduled (P1), and reminder (P1).
- Notification delivery uses a transactional outbox; appointment success does not depend on provider availability.
- Retries are bounded with exponential backoff and dead-letter visibility.
- Messages use the tenant name, timezone-aware appointment time, location, services, and manage link.
- Delivery attempts and provider message IDs are recorded without storing unnecessary message content.

### FR-7 Dashboard

- Default view shows today's appointments and pending action count.
- Pending requests are visibly distinct and sorted oldest first.
- Users can filter by date range, location, staff, service, status, and customer query.
- Every destructive or customer-visible action requires a clear confirmation step.
- Empty, loading, validation, permission, conflict, and provider-failure states have actionable messages.

### FR-8 Audit and administration

- Audit events cover member/role changes, publication changes, schedule changes, appointment status changes, exports, and platform-admin access.
- Audit records are append-only to normal application roles.
- Support access is time-bound, least-privileged, reason-coded, and audited.
- Platform suspension disables public booking while preserving tenant data.

## 8. Business rules

- `pending` and `confirmed` appointments block staff availability.
- Declined, cancelled, completed, and no-show appointments do not block future availability after their end time; historical times remain unchanged.
- Stored timestamps are UTC. A location has an IANA timezone, and the timezone used at booking is snapshotted.
- Daylight-saving gaps are not offered; ambiguous local times are represented by their UTC offset.
- Changing a service or schedule never silently modifies an existing appointment.
- A booking reference is unique, human-readable, and safe to share; database IDs are not used as public secrets.
- Customer email comparison is case-insensitive. Duplicate customer profiles within a tenant may be merged later but never across tenants.
- Rate limits apply per IP, tenant, customer identifier, and endpoint risk.

## 9. Non-functional requirements

### Security and privacy

- OWASP ASVS Level 2 is the target baseline.
- Authentication cookies are secure, HTTP-only, same-site, and rotated appropriately.
- CSRF protection is required for cookie-authenticated mutations.
- PostgreSQL row-level security or an equivalent tested database boundary enforces tenant isolation in addition to application checks.
- Secrets never enter source control or client bundles.
- Sensitive data is encrypted in transit and at rest.
- Logs redact tokens, customer contact details, notes, and signed management links.
- Data export and deletion workflows support applicable privacy obligations; exact legal requirements are confirmed for launch regions.

### Reliability and performance

- Public landing page p75 LCP below 2.5 seconds on a representative 4G mobile connection.
- Availability query p95 below 500 ms; booking submission p95 below 1.5 seconds excluding notification delivery.
- API errors use stable machine-readable codes and a correlation ID.
- Automated backups, point-in-time recovery, and quarterly restore tests are required in production.
- Target RPO: 15 minutes. Target RTO: 4 hours for MVP.

### Accessibility and localization

- WCAG 2.2 AA for customer and dashboard flows.
- Full keyboard operation, visible focus, appropriate labels, error summaries, and at least 44x44 CSS-pixel touch targets.
- Locale-aware date, time, number, and currency formatting.
- English is the MVP interface language; copy must be externalized for later localization.

## 10. Analytics

Track privacy-safe events with tenant and anonymous session identifiers:

- `tenant_onboarding_started`, `tenant_published`
- `public_page_viewed`, `service_selected`, `slot_selected`
- `booking_started`, `booking_submitted`, `booking_conflict`
- `appointment_confirmed`, `appointment_declined`, `appointment_cancelled`
- `notification_delivery_succeeded`, `notification_delivery_failed`

Do not send names, emails, phone numbers, free-text notes, or full addresses to analytics.

## 11. MVP acceptance criteria

The MVP is releasable when:

1. A new owner can configure and publish a tenant meeting all prerequisites.
2. Two published tenants show distinct content and cannot access one another's private records.
3. A customer can discover valid slots and create a pending booking without an account.
4. Concurrent attempts for the same staff/time produce at most one active appointment; the loser receives a conflict response and refreshed alternatives.
5. An owner or manager can confirm, decline, and cancel with a complete event history.
6. Unauthorized users receive no record existence information beyond a generic forbidden/not-found response.
7. Notification provider downtime does not roll back a valid booking and queued messages retry.
8. Timezone and daylight-saving test cases render and persist correct instants.
9. Critical flows pass unit, integration, end-to-end, accessibility, and tenant-isolation tests.
10. Backup restore, operational alerts, rate limits, privacy policy, terms, and support process are verified before production traffic.

## 12. Delivery phases

### Phase 0: Foundation

Repository, environments, authentication boundary, tenant context, database migration, CI, observability, design tokens, and test harness.

### Phase 1: Publishable tenant

Onboarding, profile, locations, services, staff, schedules, media, public page, and publishing validation.

### Phase 2: Booking loop

Availability engine, booking transaction, appointment inbox, status workflow, outbox, email, and customer manage link.

### Phase 3: Hardening and pilot

Accessibility, security review, load/concurrency tests, admin/support operations, backups, analytics, documentation, and a limited tenant pilot.

## 13. Risks and decisions to validate

| Risk/decision | Mitigation or owner |
| --- | --- |
| Businesses may expect instant confirmation | Explain request status throughout MVP; evaluate configurable auto-confirm in P1 |
| Local privacy, tax, and messaging laws vary | Legal review before selecting launch regions |
| SMS/WhatsApp costs and deliverability | Email in MVP; provider interface and explicit opt-in for P1 |
| Businesses may use irregular schedules | Weekly rules plus exceptions in MVP; evaluate richer recurrence after pilot |
| No-shows may drive demand for payments | Data model supports payment/deposit extension; implement only after booking loop is stable |
| Tenant slug/name conflicts | Reserved-slug list, uniqueness, rename redirects in P1 |
| Calendar races | Transactional recheck plus PostgreSQL exclusion constraint |

## 14. Open product questions

These do not block scaffolding but must be resolved before the named feature ships:

- Initial launch countries, currencies, privacy terms, and preferred notification channels.
- Whether staff can independently confirm bookings or only owners/managers can.
- Customer cancellation cutoff and whether each tenant can override it.
- Whether a pending request should hold a slot indefinitely or expire after a configurable period.
- Pricing and subscription model for tenant businesses.
- Brand name, domain, and default visual identity.
