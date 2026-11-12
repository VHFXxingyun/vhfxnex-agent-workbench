const MAX_PROJECT_PATH_LENGTH = 120;
const WINDOWS_RESERVED_NAME =
  /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;
const FORBIDDEN_PATH_CHARACTERS = /[\u0000-\u001f\u007f<>:"|?*]/;

export function normalizeProjectPath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC");
  if (
    !normalized ||
    normalized.length > MAX_PROJECT_PATH_LENGTH ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    FORBIDDEN_PATH_CHARACTERS.test(normalized)
  )
    return null;

  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[. ]$/.test(segment) ||
        WINDOWS_RESERVED_NAME.test(segment),
    )
  )
    return null;

  return normalized;
}

export function projectPathKey(value) {
  return value.normalize("NFC").toLowerCase();
}

/**
 * Merge a partial code-project update while preserving every untouched file.
 * Paths are keyed case-insensitively after Unicode normalization.
 * @param {{ path: string; content: string }[]} existingFiles
 * @param {{ path: string; content: string }[]} updatedFiles
 * @param {string[]} removedPaths
 */
export function mergeProjectFilePatch(existingFiles, updatedFiles, removedPaths = []) {
  const merged = new Map();
  for (const file of existingFiles) {
    const path = normalizeProjectPath(file.path);
    if (path) merged.set(projectPathKey(path), { ...file, path });
  }
  for (const rawPath of removedPaths) {
    const path = normalizeProjectPath(rawPath);
    if (path) merged.delete(projectPathKey(path));
  }
  for (const file of updatedFiles) {
    const path = normalizeProjectPath(file.path);
    if (path) merged.set(projectPathKey(path), { ...file, path });
  }
  return Array.from(merged.values());
}
