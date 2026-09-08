import { createHmac } from "node:crypto";

// Disposable verification gateway credentials, never used by a deployment.
export const proxyEnvironment = {
  TRUSTED_PROXY_CLIENT_IP_HEADER: "x-verification-client-ip",
  TRUSTED_PROXY_CLIENT_IP_SECRET: "local-verification-proxy-secret-only-005",
};
const address = "127.0.0.1";
export const proxyHeaders = {
  [proxyEnvironment.TRUSTED_PROXY_CLIENT_IP_HEADER]: address,
  "x-chairly-client-ip-signature": createHmac(
    "sha256",
    proxyEnvironment.TRUSTED_PROXY_CLIENT_IP_SECRET,
  )
    .update(
      `client-ip:v1\0${proxyEnvironment.TRUSTED_PROXY_CLIENT_IP_HEADER}\0${address}`,
    )
    .digest("hex"),
};
