import { normalizeProjectPath, projectPathKey } from "./project-path.mjs";

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none'";

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function localAssetPath(value) {
  const source = value.trim();
  if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)) return null;
  const path = source.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => !segment || segment === "." || segment === "..")
  )
    return null;
  return path;
}

function escapeClosingTag(value, tagName) {
  return value.replace(new RegExp(`<\\/${tagName}`, "gi"), (match) => `<\\${match.slice(1)}`);
}

/**
 * Creates a static, network-isolated preview from an HTML entry point and local CSS files.
 * Project JavaScript and navigation links are intentionally removed from the preview.
 * @param {{ path: string; content: string }[]} files
 */
export function buildStaticPreviewDocument(files) {
  const projectFiles = new Map(
    files.flatMap((file) => {
      const path = normalizeProjectPath(file.path);
      return path ? [[projectPathKey(path), file.content]] : [];
    }),
  );
  const entry = projectFiles.get(projectPathKey("index.html"));
  if (typeof entry !== "string" || !entry.trim()) return null;

  let html = entry.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["'][^"']*stylesheet[^"']*["']/i.test(tag)) return tag;
    const path = localAssetPath(attribute(tag, "href"));
    const stylesheet = path ? projectFiles.get(projectPathKey(path)) : undefined;
    return path?.toLowerCase().endsWith(".css") && typeof stylesheet === "string"
      ? `<style>${escapeClosingTag(stylesheet, "style")}</style>`
      : "";
  });
  html = html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(/\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (hrefAttribute) => {
      const value = attribute(`<a${hrefAttribute}>`, "href");
      return value.startsWith("#") ? hrefAttribute : "";
    }),
  );
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh\b[^>]*>/gi, "");

  const policy = `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`;
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (openingTag) => `${openingTag}${policy}`);
  } else if (/<html\b[^>]*>/i.test(html)) {
    html = html.replace(/<html\b[^>]*>/i, (openingTag) => `${openingTag}<head>${policy}</head>`);
  } else {
    html = `<!doctype html><html><head>${policy}</head><body>${html}</body></html>`;
  }
  return html;
}
