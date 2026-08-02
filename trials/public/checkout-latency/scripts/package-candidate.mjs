import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const trialRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = join(trialRoot, "candidate");
const argumentsList = process.argv.slice(2);
if (
  argumentsList.length !== 0 &&
  (argumentsList.length !== 2 || argumentsList[0] !== "--output" || argumentsList[1] === undefined)
) {
  throw new Error("Usage: node scripts/package-candidate.mjs [--output <archive-path>]");
}
const outputPath =
  argumentsList.length === 0
    ? join(candidateRoot, "repository.tar.zst")
    : resolve(argumentsList[1]);
const candidateFiles = [
  "AGENTS.template.md",
  "README.template.md",
  "docs/checkout-path.md",
  "package-lock.json",
  "package.json",
  "src/checkout.ts",
  "src/fraud.ts",
  "src/load.ts",
  "src/payments.ts",
  "src/server.ts",
  "test/public.test.ts",
  "tsconfig.json",
  "vitest.config.ts"
];

const blocks = [];
for (const path of candidateFiles) {
  const content = await readFile(join(candidateRoot, path));
  blocks.push(tarHeader(path, content.byteLength), content, padding(content.byteLength));
}
blocks.push(Buffer.alloc(1024));

const temporaryDirectory = await mkdtemp(join(tmpdir(), "fluxgrade-candidate-"));
const tarPath = join(temporaryDirectory, "repository.tar");
try {
  await writeFile(tarPath, Buffer.concat(blocks));
  const compressed = spawnSync("zstd", ["-q", "-19", "-f", tarPath, "-o", outputPath], {
    encoding: "utf8"
  });
  if (compressed.error !== undefined) {
    throw compressed.error;
  }
  if (compressed.status !== 0) {
    throw new Error(compressed.stderr.trim() || `zstd exited with ${compressed.status}`);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  writeString(header, 0, 100, path);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, 257, 6, "ustar");
  writeString(header, 263, 2, "00");
  writeString(header, 265, 32, "root");
  writeString(header, 297, 32, "root");
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const encodedChecksum = checksum.toString(8).padStart(6, "0");
  writeString(header, 148, 6, encodedChecksum);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function writeString(buffer, offset, length, value) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength > length) {
    throw new Error(`Tar field is too long: ${value}`);
  }
  encoded.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  writeString(buffer, offset, length, value.toString(8).padStart(length - 1, "0"));
}

function padding(size) {
  const remainder = size % 512;
  return Buffer.alloc(remainder === 0 ? 0 : 512 - remainder);
}
