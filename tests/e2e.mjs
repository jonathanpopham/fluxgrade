import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

import { chromium } from "playwright-core";

const BASE_URL = process.env.FLUXGRADE_URL || "http://127.0.0.1:4173";
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const optimalPath = [
  "trace-flow",
  "guarded-patch",
  "state-machine",
  "failure-matrix",
  "canary"
];

let server;
if (!process.env.FLUXGRADE_URL) {
  server = spawn(process.execPath, ["scripts/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer();
}

await mkdir(new URL("../test-results/", import.meta.url), { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true
});

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(BASE_URL, { waitUntil: "networkidle" });
  await desktop.getByRole("heading", { name: /Software fights back/i }).waitFor();
  assert.equal(await desktop.locator("[data-screen='landing']").isVisible(), true);
  assert.equal(await desktop.locator(".leaderboard-row").count(), 5);
  await desktop.screenshot({
    path: new URL("../test-results/desktop-landing.png", import.meta.url).pathname,
    fullPage: true
  });

  await desktop.locator("[data-action='open-briefing']").first().click();
  await desktop.locator("[data-alias-input]").fill("launch_ghost");
  await desktop.locator("[data-action='start-mission']").click();
  await desktop.waitForTimeout(600);
  await desktop.screenshot({
    path: new URL("../test-results/desktop-mission.png", import.meta.url).pathname,
    fullPage: true
  });
  await desktop.locator("[data-choice-id='trace-flow']").click();
  await desktop.locator("[data-choice-id='guarded-patch']").click();
  await desktop.locator("[data-twist-overlay].is-visible").waitFor();
  await desktop.locator("[data-action='acknowledge-twist']").click();

  for (const choice of optimalPath.slice(2)) {
    await desktop.locator(`[data-choice-id='${choice}']`).click();
  }

  await desktop.locator("[data-screen='results'].is-active").waitFor();
  assert.equal(await desktop.locator("[data-final-score]").textContent(), "100");
  assert.equal(
    await desktop.locator("[data-final-division]").textContent(),
    "Diamond I"
  );
  assert.equal(
    await desktop.locator("[data-final-leaderboard] .is-player").count(),
    1
  );
  assert.match(
    await desktop.locator("[data-outcome-latency]").textContent(),
    /p95 restored/
  );
  await desktop.screenshot({
    path: new URL("../test-results/desktop-results.png", import.meta.url).pathname,
    fullPage: true
  });
  await desktop.locator("[data-action='back-home']").last().click();
  await desktop.locator("[data-screen='landing'].is-active").waitFor();
  assert.equal(
    await desktop.locator("[data-leaderboard-preview] .is-player").count(),
    1
  );

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(BASE_URL, { waitUntil: "networkidle" });
  const dimensions = await mobile.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert.ok(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `mobile overflow: ${dimensions.documentWidth}px > ${dimensions.viewportWidth}px`
  );
  await mobile.screenshot({
    path: new URL("../test-results/mobile-landing.png", import.meta.url).pathname,
    fullPage: true
  });

  await mobile.locator("[data-action='open-briefing']").first().click();
  await mobile.locator("[data-action='start-mission']").click();
  assert.equal(await mobile.locator("[data-panel='agent']").isVisible(), true);
  await mobile.locator("[data-mobile-panel='code']").click();
  assert.equal(await mobile.locator("[data-panel='code']").isVisible(), true);
  await mobile.screenshot({
    path: new URL("../test-results/mobile-mission.png", import.meta.url).pathname,
    fullPage: true
  });

  console.log("Fluxgrade E2E passed: optimal mission and mobile layout");
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // Retry while the local server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${BASE_URL}`);
}
