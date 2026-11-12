import { isIP } from "node:net";

const fallbackAddress = "unattributed-client";
const maximumTrustedProxyHops = 32;

export function resolveClientAddress(headers, trustedProxyHops) {
  if (
    !Number.isSafeInteger(trustedProxyHops) ||
    trustedProxyHops < 1 ||
    trustedProxyHops > maximumTrustedProxyHops
  ) {
    return fallbackAddress;
  }

  const forwarded = (headers.get("x-forwarded-for") || "").split(",").map((value) => value.trim());
  const address = forwarded[forwarded.length - trustedProxyHops];
  if (address && isIP(address)) return address.toLowerCase();

  const realIp = headers.get("x-real-ip")?.trim();
  return realIp && isIP(realIp) ? realIp.toLowerCase() : fallbackAddress;
}

export function configuredTrustedProxyHops(environment) {
  const configured = environment.NEXORA_TRUSTED_PROXY_HOPS;
  if (configured === undefined) return environment.NODE_ENV === "development" ? 1 : 0;
  if (!/^\d{1,2}$/.test(configured)) return 0;
  const hops = Number(configured);
  return hops <= maximumTrustedProxyHops ? hops : 0;
}
