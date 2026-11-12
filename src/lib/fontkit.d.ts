declare module "fontkit" {
  export type Font = { hasGlyphForCodePoint(codePoint: number): boolean };
  export function openSync(path: string): Font;
}
