export type CsvTable = { columns: string[]; rows: string[][] };

export declare function parseCsvTable(input: string): CsvTable;
export declare function serializeCsvTable(columns: string[], rows: string[][]): string;
