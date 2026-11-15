import { normalizeProjectPath, projectPathKey } from "./project-path.mjs";

const MAX_DOCUMENT_CHARS = 120_000;
const MAX_PROJECT_FILES = 40;
const MAX_PROJECT_CHARS = 120_000;
const MAX_SPREADSHEET_ROWS = 500;
const MAX_SPREADSHEET_COLUMNS = 20;
const MAX_CELL_CHARS = 2_000;
const MAX_SPREADSHEET_BYTES = 1_000_000;
const MAX_JSON_CHARS = 300_000;
const MAX_PRESENTATION_CHARS = 18_000;

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}

/** @param {unknown} value */
export function readDocumentDraft(value) {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.content !== "string")
    return null;
  if (value.title.length > 80 || value.content.length > MAX_DOCUMENT_CHARS) return null;
  if (utf8Bytes(value.content) > 300_000) return null;
  return { title: value.title, content: value.content };
}

/** @param {unknown} value */
export function readCodeDraft(value) {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > MAX_PROJECT_FILES
  )
    return null;
  if (value.title.length > 60) return null;

  const files = [];
  const paths = new Set();
  let totalCharacters = 0;
  for (const raw of value.files) {
    if (!isRecord(raw) || typeof raw.path !== "string" || typeof raw.content !== "string")
      return null;
    const normalizedPath = normalizeProjectPath(raw.path);
    if (!normalizedPath || raw.path.length > 180 || raw.content.length > 80_000) return null;
    const key = projectPathKey(normalizedPath);
    if (paths.has(key)) return null;
    paths.add(key);
    totalCharacters += normalizedPath.length + raw.content.length;
    if (totalCharacters > MAX_PROJECT_CHARS) return null;
    files.push({ path: normalizedPath, content: raw.content });
  }

  const activePath =
    typeof value.activePath === "string" && files.some((file) => file.path === value.activePath)
      ? value.activePath
      : files[0].path;
  return { title: value.title, files, activePath };
}

/** @param {unknown} value */
export function readSpreadsheetDraft(value) {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !Array.isArray(value.columns) ||
    value.columns.length < 1 ||
    value.columns.length > MAX_SPREADSHEET_COLUMNS ||
    !Array.isArray(value.rows) ||
    value.rows.length > MAX_SPREADSHEET_ROWS
  )
    return null;
  const normalizeTable = (name, rawColumns, rawRows) => {
    if (
      typeof name !== "string" ||
      name.length > 80 ||
      !Array.isArray(rawColumns) ||
      rawColumns.length < 1 ||
      rawColumns.length > MAX_SPREADSHEET_COLUMNS ||
      !Array.isArray(rawRows) ||
      rawRows.length > MAX_SPREADSHEET_ROWS ||
      rawColumns.some((column) => typeof column !== "string" || column.length > 120)
    )
      return null;
    const columns = [...rawColumns];
    const rows = [];
    for (const rawRow of rawRows) {
      if (
        !Array.isArray(rawRow) ||
        rawRow.length !== columns.length ||
        rawRow.some((cell) => typeof cell !== "string" || cell.length > MAX_CELL_CHARS)
      )
        return null;
      rows.push([...rawRow]);
    }
    return { name, columns, rows };
  };

  const activeTable = normalizeTable(value.name, value.columns, value.rows);
  if (!activeTable) return null;
  const normalized = { ...activeTable };
  if (value.sheets !== undefined) {
    if (!Array.isArray(value.sheets) || value.sheets.length < 1 || value.sheets.length > 8)
      return null;
    const sheets = [];
    for (const rawSheet of value.sheets) {
      if (!isRecord(rawSheet)) return null;
      const sheet = normalizeTable(rawSheet.name, rawSheet.columns, rawSheet.rows);
      if (!sheet) return null;
      sheets.push(sheet);
    }
    const activeSheetIndex =
      Number.isInteger(value.activeSheetIndex) &&
      value.activeSheetIndex >= 0 &&
      value.activeSheetIndex < sheets.length
        ? value.activeSheetIndex
        : 0;
    normalized.sheets = sheets;
    normalized.activeSheetIndex = activeSheetIndex;
  }
  if (utf8Bytes(JSON.stringify(normalized)) > MAX_SPREADSHEET_BYTES) return null;
  return normalized;
}

/** @param {unknown} value */
export function readJsonDraft(value) {
  if (!isRecord(value) || typeof value.content !== "string") return null;
  if (value.content.length > MAX_JSON_CHARS || utf8Bytes(value.content) > 700_000) return null;
  return { content: value.content };
}

/** @param {unknown} value */
export function readPresentationDraft(value) {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    value.title.length > 100 ||
    typeof value.description !== "string" ||
    value.description.length > 300 ||
    !Array.isArray(value.slides) ||
    value.slides.length < 1 ||
    value.slides.length > 20 ||
    !Number.isInteger(value.activeSlideIndex) ||
    value.activeSlideIndex < 0 ||
    value.activeSlideIndex >= value.slides.length
  )
    return null;
  let totalCharacters = value.title.length + value.description.length;
  const slides = [];
  for (const slide of value.slides) {
    if (
      !isRecord(slide) ||
      typeof slide.title !== "string" ||
      slide.title.length > 100 ||
      typeof slide.bulletsText !== "string" ||
      slide.bulletsText.length > 1_400 ||
      typeof slide.speakerNotes !== "string" ||
      slide.speakerNotes.length > 400
    )
      return null;
    const bullets = slide.bulletsText
      .split(/\r?\n/u)
      .map((bullet) => bullet.trim())
      .filter(Boolean);
    if (bullets.length > 6 || bullets.some((bullet) => bullet.length > 220)) return null;
    totalCharacters += slide.title.length + slide.bulletsText.length + slide.speakerNotes.length;
    if (totalCharacters > MAX_PRESENTATION_CHARS) return null;
    slides.push({
      title: slide.title,
      bulletsText: slide.bulletsText,
      speakerNotes: slide.speakerNotes,
    });
  }
  if (utf8Bytes(JSON.stringify(value)) > 40_000) return null;
  return {
    title: value.title,
    description: value.description,
    slides,
    activeSlideIndex: value.activeSlideIndex,
  };
}
