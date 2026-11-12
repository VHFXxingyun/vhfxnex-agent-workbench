import type { ProjectFile } from "@/lib/goal";
import { normalizeProjectPath, projectPathKey } from "@/lib/project-path.mjs";

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

export function createProjectZip(files: ProjectFile[]): Uint8Array {
  if (!files.length || files.length > 20) throw new Error("项目文件数量无效。");
  const paths = new Set<string>();
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;
  let totalBytes = 0;

  for (const file of files) {
    const safePath = normalizeProjectPath(file.path);
    if (!safePath) {
      throw new Error("项目包含不安全的文件路径，已停止打包。");
    }
    const pathKey = projectPathKey(safePath);
    if (paths.has(pathKey)) throw new Error("项目包含重复的文件路径，已停止打包。");
    paths.add(pathKey);

    const filename = encoder.encode(safePath);
    const content = encoder.encode(file.content);
    totalBytes += content.byteLength;
    if (totalBytes > 45_000) throw new Error("项目文件超过安全大小上限。");
    const checksum = crc32(content);
    const local = new Uint8Array(30 + filename.length + content.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0x0021);
    write32(localView, 14, checksum);
    write32(localView, 18, content.length);
    write32(localView, 22, content.length);
    write16(localView, 26, filename.length);
    write16(localView, 28, 0);
    local.set(filename, 30);
    local.set(content, 30 + filename.length);
    localRecords.push(local);

    const central = new Uint8Array(46 + filename.length);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x0021);
    write32(centralView, 16, checksum);
    write32(centralView, 20, content.length);
    write32(centralView, 24, content.length);
    write16(centralView, 28, filename.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, localOffset);
    central.set(filename, 46);
    centralRecords.push(central);
    localOffset += local.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 4, 0);
  write16(endView, 6, 0);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  write16(endView, 20, 0);

  const archive = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const record of localRecords) {
    archive.set(record, offset);
    offset += record.length;
  }
  for (const record of centralRecords) {
    archive.set(record, offset);
    offset += record.length;
  }
  archive.set(end, offset);
  return archive;
}
