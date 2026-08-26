/** Shallow liveness check; readiness must verify dependencies separately. */
export function GET() {
  return Response.json({ status: "ok" });
}
