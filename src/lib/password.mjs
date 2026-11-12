import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

const versionPrefix = "v3$";
const previousVersionPrefix = "v2$";
const passwordDigest = (password) => createHash("sha256").update(password, "utf8").digest("hex");
const bcryptInput = (password) => `v3:${passwordDigest(password)}`;
const previousBcryptInput = (password) =>
  `nexora-password-v2:${passwordDigest(password)}`;

export function needsPasswordUpgrade(passwordHash) {
  return typeof passwordHash !== "string" || !passwordHash.startsWith(versionPrefix);
}

export async function hashPassword(password) {
  return `${versionPrefix}${await bcrypt.hash(bcryptInput(password), 12)}`;
}

export async function verifyPassword(password, passwordHash) {
  if (typeof passwordHash !== "string") return false;
  if (passwordHash.startsWith(versionPrefix)) {
    return bcrypt.compare(bcryptInput(password), passwordHash.slice(versionPrefix.length));
  }
  if (passwordHash.startsWith(previousVersionPrefix)) {
    return bcrypt.compare(
      previousBcryptInput(password),
      passwordHash.slice(previousVersionPrefix.length),
    );
  }
  return bcrypt.compare(password, passwordHash);
}
