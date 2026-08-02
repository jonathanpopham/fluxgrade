import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { createServer } from "node:net";

import { chromium } from "playwright-core";

let baseUrl = process.env.FLUXGRADE_URL;
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
let browser;

try {
  if (!baseUrl) {
    const port = await availablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, ["scripts/server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForServer(baseUrl, server);
  }

  browser = await chromium.launch({
    executablePath: CHROME,
    headless: true
  });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await desktop.goto(baseUrl, { waitUntil: "networkidle" });

  await desktop.getByRole("heading", { name: /Software fights back/i }).waitFor();
  assert.equal(await desktop.locator("[data-screen='landing'].is-active").isVisible(), true);

  await desktop.locator("[data-action='open-briefing']").first().click();
  await desktop.locator("[data-alias-input]").fill("regression_ghost");
  await desktop.locator("[data-action='start-mission']").click();
  assert.equal(await desktop.locator("[data-screen='mission'].is-active").isVisible(), true);
  assert.equal(await desktop.locator("[data-round-count]").textContent(), "1 of 5 decisions");
  assert.equal(await desktop.locator("[data-choice-id='trace-flow']").isVisible(), true);

  for (const choice of optimalPath.slice(0, 2)) {
    await desktop.locator(`[data-choice-id='${choice}']`).click();
  }
  await desktop.locator("[data-twist-overlay].is-visible").waitFor();
  await desktop.locator("[data-action='acknowledge-twist']").click();
  for (const choice of optimalPath.slice(2)) {
    await desktop.locator(`[data-choice-id='${choice}']`).click();
  }

  await desktop.locator("[data-screen='results'].is-active").waitFor();
  assert.equal(await desktop.locator("[data-final-score]").textContent(), "100");
  assert.equal(await desktop.locator("[data-final-division]").textContent(), "Diamond I");
  assert.match(await desktop.locator("[data-outcome-latency]").textContent(), /p95 restored/);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(baseUrl, { waitUntil: "networkidle" });
  const dimensions = await mobile.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  assert.ok(
    dimensions.documentWidth <= dimensions.viewportWidth + 1,
    `mobile overflow: ${dimensions.documentWidth}px > ${dimensions.viewportWidth}px`
  );
  await mobile.locator("[data-action='open-briefing']").first().click();
  await mobile.locator("[data-action='start-mission']").click();
  assert.equal(await mobile.locator("[data-panel='agent']").isVisible(), true);
  await mobile.locator("[data-mobile-panel='code']").click();
  assert.equal(await mobile.locator("[data-panel='code']").isVisible(), true);

  console.log("Fluxgrade trailer regression passed: landing, mission, result, and mobile paths");
} finally {
  try {
    await browser?.close();
  } finally {
    await stopServer(server);
  }
}

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.equal(typeof address, "object");
  await new Promise((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForServer(url, child) {
  let childFailure;
  child.once("error", (error) => {
    childFailure = error;
  });
  child.once("exit", (code, signal) => {
    childFailure = new Error(`Server exited before readiness (${signal ?? code})`);
  });

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (childFailure) throw childFailure;
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while the local server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  let timeout;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), 2_000);
    })
  ]);
  clearTimeout(timeout);

  if (!stopped) {
    child.kill("SIGKILL");
    await exited;
  }
}
