import { NextResponse } from "next/server";
import {
  createOidcFlowValue,
  oidcFlowCookieName,
} from "@/server/dashboard-session";
import {
  createOidcAuthorization,
  oidcApplicationUrl,
  oidcUsesSecureCookies,
} from "@/server/oidc";

export async function GET() {
  try {
    const { authorizationUrl, flow } = await createOidcAuthorization();
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(oidcFlowCookieName, createOidcFlowValue(flow), {
      httpOnly: true,
      secure: oidcUsesSecureCookies(),
      sameSite: "lax",
      path: "/auth/callback",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(
      oidcApplicationUrl("/sign-in?error=unavailable"),
    );
  }
}
