import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { loadMissionYaml } from "@fluxgrade/mission-schema";
import { describe, expect, it } from "vitest";

const missionPath = fileURLToPath(new URL("../mission.yaml", import.meta.url));
const trialRoot = dirname(missionPath);
const candidateRoot = join(trialRoot, "candidate");
const execFileAsync = promisify(execFile);

describe("checkout-latency mission package", () => {
  it("loads the mission and pins the actual candidate archive digest", async () => {
    const mission = loadMissionYaml(await readFile(missionPath, "utf8"));
    const artifact = await readFile(resolve(trialRoot, mission.candidate.artifact));
    const digest = `sha256:${createHash("sha256").update(artifact).digest("hex")}`;

    expect(mission).toMatchObject({
      schemaVersion: "1.0.0",
      id: "checkout-latency",
      version: "1.0.0",
      candidate: { artifact: "candidate/repository.tar.zst" }
    });
    expect(mission.candidate.digest).toBe(digest);
  });

  it("rebuilds the archive byte-for-byte from the candidate seed", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "fluxgrade-archive-test-"));
    const generatedArchive = join(temporaryDirectory, "repository.tar.zst");
    try {
      await execFileAsync(process.execPath, [
        join(trialRoot, "scripts", "package-candidate.mjs"),
        "--output",
        generatedArchive
      ]);
      const [committed, generated] = await Promise.all([
        readFile(join(candidateRoot, "repository.tar.zst")),
        readFile(generatedArchive)
      ]);
      expect(generated).toEqual(committed);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("ships a candidate-visible handoff and a plausible misleading design note", async () => {
    const [readme, agents, design] = await Promise.all([
      readFile(join(candidateRoot, "README.template.md"), "utf8"),
      readFile(join(candidateRoot, "AGENTS.template.md"), "utf8"),
      readFile(join(candidateRoot, "docs", "checkout-path.md"), "utf8")
    ]);

    expect(readme).toMatch(/p95.*250 ms/i);
    expect(readme).toMatch(/npm test/);
    expect(readme).not.toMatch(/synchronous fraud enrichment|hidden evaluator/i);
    expect(agents).toMatch(/fluxgrade (status|events|check)/);
    expect(agents).toMatch(/credentials/i);
    expect(design).toMatch(/fraud enrichment.*asynchronous/i);
    expect(design).toMatch(/retr(y|ies)/i);
  });
});
