import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function canonicalDatabasePath(databasePath) {
  const resolvedPath = path.resolve(databasePath);
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    try {
      return path.join(
        fs.realpathSync.native(path.dirname(resolvedPath)),
        path.basename(resolvedPath),
      );
    } catch {
      return resolvedPath;
    }
  }
}

export function createSmokeDatabaseProof(databasePath, sessionSecret) {
  if (typeof sessionSecret !== "string" || !sessionSecret) return "";
  return createHmac("sha256", sessionSecret)
    .update(canonicalDatabasePath(databasePath), "utf8")
    .digest("hex");
}

export function matchesSmokeDatabaseProof(proof, databasePath, sessionSecret) {
  if (typeof proof !== "string" || !/^[a-f\d]{64}$/i.test(proof)) return false;
  const expected = Buffer.from(createSmokeDatabaseProof(databasePath, sessionSecret), "hex");
  const candidate = Buffer.from(proof, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
