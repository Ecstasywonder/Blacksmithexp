import { getDashboardMembership } from "@chairly/database";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "./database";
import {
  type ChairlySessionPayload,
  verifyChairlySession,
} from "./chairly-session";

export type DashboardSession = ChairlySessionPayload & {
  tenantName: string;
};

export async function readDashboardSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies();
  const serializedSession = cookieStore.get("chairly_session")?.value;

  if (!serializedSession) {
    return null;
  }

  const payload = verifyChairlySession(serializedSession);
  if (!payload) {
    return null;
  }

  let membership = null;

  try {
    membership = await getDashboardMembership(
      getDatabase().db,
      payload.tenantId,
      payload.userId,
    );
  } catch {
    return null;
  }

  if (
    !membership ||
    membership.role !== payload.role ||
    membership.tenantSlug !== payload.tenantSlug
  ) {
    return null;
  }

  return {
    ...payload,
    tenantName: membership.tenantName,
  };
}

export async function requireDashboardSession(): Promise<DashboardSession> {
  const session = await readDashboardSession();
  if (!session) {
    redirect("/sign-in");
  }

  return session;
}
