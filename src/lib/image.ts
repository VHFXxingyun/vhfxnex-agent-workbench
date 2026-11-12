export const MAX_IMAGE_BYTES = 6_000_000;

export function isSupportedImageDataUrl(value: string): boolean {
  const comma = value.indexOf(",");
  if (comma < 0) return false;
  const header = value.slice(0, comma);
  if (
    header !== "data:image/jpeg;base64" &&
    header !== "data:image/png;base64" &&
    header !== "data:image/gif;base64" &&
    header !== "data:image/webp;base64"
  )
    return false;

  const base64 = value.slice(comma + 1);
  if (!base64 || base64.length % 4 !== 0) return false;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > MAX_IMAGE_BYTES) return false;

  const contentLength = base64.length - padding;
  for (let index = 0; index < contentLength; index += 1) {
    const code = base64.charCodeAt(index);
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit = code >= 48 && code <= 57;
    if (!isLetter && !isDigit && code !== 43 && code !== 47) return false;
  }
  for (let index = contentLength; index < base64.length; index += 1) {
    if (base64.charCodeAt(index) !== 61) return false;
  }

  const signature = atob(base64.slice(0, 24));
  const bytes = Uint8Array.from(signature, (character) => character.charCodeAt(0));
  if (header === "data:image/jpeg;base64")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (header === "data:image/png;base64")
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  if (header === "data:image/gif;base64")
    return signature.startsWith("GIF87a") || signature.startsWith("GIF89a");
  return (
    header === "data:image/webp;base64" &&
    signature.startsWith("RIFF") &&
    signature.slice(8, 12) === "WEBP"
  );
}
