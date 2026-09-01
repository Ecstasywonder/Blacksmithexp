import { sql } from "drizzle-orm";
import type { Database } from "./index";

type RateLimitRow = { allowed: boolean };

/** Atomically consumes one request from a hashed public endpoint scope. */
export async function consumePublicBookingRateLimit(
  database: Database,
  scopeHash: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<boolean> {
  const rows = await database.execute<RateLimitRow>(sql`
    select app.consume_public_booking_rate_limit(
      ${scopeHash},
      ${maxRequests},
      ${windowSeconds}
    ) as allowed
  `);
  return rows[0]?.allowed === true;
}
