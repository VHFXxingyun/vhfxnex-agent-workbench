import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";

const repositoryRoot = process.cwd();
const projectRoot = path.join(repositoryRoot, "deliverables", "desktop-timer");
const archivePath = path.join(repositoryRoot, "deliverables", "VHFXNEX-Desktop-Timer-v1.0.zip");

async function listProjectFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "__pycache__" || entry.name === ".pytest_cache") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listProjectFiles(absolutePath, relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function verifyArchiveMatchesSource() {
  const [archiveBytes, sourceFiles] = await Promise.all([
    readFile(archivePath),
    listProjectFiles(projectRoot),
  ]);
  const archive = await JSZip.loadAsync(archiveBytes);
  const archiveFiles = Object.keys(archive.files)
    .filter((filePath) => !archive.files[filePath].dir)
    .sort();
  const expectedFiles = [...sourceFiles].sort();
  assert.deepEqual(archiveFiles, expectedFiles, "桌面计时器 ZIP 的文件清单必须与源码目录完全一致");

  for (const filePath of expectedFiles) {
    const [archived, source] = await Promise.all([
      archive.file(filePath).async("nodebuffer"),
      readFile(path.join(projectRoot, ...filePath.split("/"))),
    ]);
    assert.deepEqual(archived, source, `桌面计时器 ZIP 中的 ${filePath} 与源码不一致`);
  }
  console.log(`✓ Desktop timer ZIP matches all ${expectedFiles.length} source files.`);
}

function runPythonUnitTests() {
  const args = ["-m", "unittest", "discover", "-s", "tests", "-v"];
  const candidates = process.env.PYTHON?.trim()
    ? [[process.env.PYTHON.trim(), args]]
    : process.platform === "win32"
      ? [
          ["py", ["-3", ...args]],
          ["python", args],
        ]
      : [
          ["python3", args],
          ["python", args],
        ];
  let lastError;
  for (const [command, commandArgs] of candidates) {
    const result = spawnSync(command, commandArgs, {
      cwd: projectRoot,
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error?.code === "ENOENT") {
      lastError = result.error;
      continue;
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      return;
    }
    return;
  }
  throw new Error(`找不到 Python 3。请安装 Python 3.10+；${lastError?.message || ""}`);
}

await verifyArchiveMatchesSource();
runPythonUnitTests();
