export const MIN_SESSION_SECRET_BYTES = 32;

export function isSessionSecretValid(value) {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength >= MIN_SESSION_SECRET_BYTES
  );
}
