import { randomUUID, timingSafeEqual } from "node:crypto";
import { resolveOwnerIdentity } from "@chairly/database";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createDashboardSessionValue,
  dashboardSessionCookieName,
  oidcFlowCookieName,
  verifyOidcFlowValue,
} from "@/server/dashboard-session";
import { getDatabase } from "@/server/database";
import {
  exchangeOidcCode,
  oidcApplicationUrl,
  oidcUsesSecureCookies,
} from "@/server/oidc";

function equalState(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function clearFlowCookie(response: NextResponse) {
  response.cookies.set(oidcFlowCookieName, "", {
    httpOnly: true,
    secure: oidcUsesSecureCookies(),
    sameSite: "lax",
    path: "/auth/callback",
    maxAge: 0,
  });
}

function failure() {
  const response = NextResponse.redirect(
    oidcApplicationUrl("/sign-in?error=not-authorized"),
  );
  clearFlowCookie(response);
  return response;
}

export async function GET(request: Request) {
  const requestId = randomUUID();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const flowValue = (await cookies()).get(oidcFlowCookieName)?.value;
  const flow = flowValue
    ? verifyOidcFlowValue(decodeURIComponent(flowValue))
    : null;
  if (!code || !state || !flow || !equalState(state, flow.state)) {
    return failure();
  }

  try {
    const verified = await exchangeOidcCode(code, flow);
    const owner = await resolveOwnerIdentity(
      getDatabase().db,
      verified.issuer,
      verified.subject,
    );
    if (!owner) {
      return failure();
    }

    const response = NextResponse.redirect(oidcApplicationUrl(flow.returnTo));
    clearFlowCookie(response);
    response.cookies.set(
      dashboardSessionCookieName,
      createDashboardSessionValue({
        ...owner,
        expiresAt: Date.now() + 8 * 60 * 60_000,
      }),
      {
        httpOnly: true,
        secure: oidcUsesSecureCookies(),
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60,
      },
    );
    return response;
  } catch {
    console.error("OIDC callback failed", { requestId });
    return failure();
  }
}
