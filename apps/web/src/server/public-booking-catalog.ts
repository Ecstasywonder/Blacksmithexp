import {
  getPublishedBookingCatalog,
  type PublicBookingCatalog,
} from "@chairly/database";
import { getDatabase } from "./database";

export async function loadPublicBookingCatalog(
  tenantSlug: string,
): Promise<PublicBookingCatalog | null> {
  return getPublishedBookingCatalog(getDatabase().db, tenantSlug);
}
