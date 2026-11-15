export type DocumentDraft = { title: string; content: string };
export type CodeDraft = {
  title: string;
  files: { path: string; content: string }[];
  activePath: string;
};
export type SpreadsheetSheetDraft = { name: string; columns: string[]; rows: string[][] };
export type SpreadsheetDraft = SpreadsheetSheetDraft & {
  sheets?: SpreadsheetSheetDraft[];
  activeSheetIndex?: number;
};
export type JsonDraft = { content: string };
export type PresentationDraft = {
  title: string;
  description: string;
  slides: { title: string; bulletsText: string; speakerNotes: string }[];
  activeSlideIndex: number;
};

export function readDocumentDraft(value: unknown): DocumentDraft | null;
export function readCodeDraft(value: unknown): CodeDraft | null;
export function readSpreadsheetDraft(value: unknown): SpreadsheetDraft | null;
export function readJsonDraft(value: unknown): JsonDraft | null;
export function readPresentationDraft(value: unknown): PresentationDraft | null;
