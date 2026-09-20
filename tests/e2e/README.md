# End-to-end tests

Critical browser journeys live here. The booking-slice runner seeds deterministic
synthetic tenants in PostgreSQL and uses the real repository-backed booking flow
plus a signed `chairly_session` for private dashboard coverage.
