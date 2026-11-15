export type ImportedXlsxSheet = {
  name: string;
  formulaCount: number;
  columns: string[];
  rows: string[][];
};

export type ImportedXlsxWorkbook = {
  sheets: ImportedXlsxSheet[];
  sheetCount: number;
  formulaCount: number;
};

export function readXlsxWorkbook(buffer: ArrayBuffer): Promise<ImportedXlsxWorkbook>;
