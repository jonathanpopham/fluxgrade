export const STORAGE_KEY = "fluxgrade:results:v1";

export const DIMENSIONS = [
  { id: "engineering", label: "Engineering", max: 25 },
  { id: "adaptation", label: "Adaptation", max: 25 },
  { id: "verification", label: "Verification", max: 25 },
  { id: "judgment", label: "Agent judgment", max: 25 }
];

export const BASE_LEADERBOARD = [
  { alias: "nullroute", score: 98, remaining: 211, badge: "D1" },
  { alias: "bitwitch", score: 95, remaining: 236, badge: "D1" },
  { alias: "sev_zero", score: 92, remaining: 188, badge: "D2" },
  { alias: "packetghost", score: 89, remaining: 219, badge: "D2" },
  { alias: "heapfriend", score: 86, remaining: 173, badge: "G1" },
  { alias: "safetynet", score: 82, remaining: 204, badge: "G1" },
  { alias: "latency_lass", score: 78, remaining: 164, badge: "G2" },
  { alias: "driftwood", score: 74, remaining: 227, badge: "G2" },
  { alias: "retryafter", score: 69, remaining: 152, badge: "S1" },
  { alias: "shipshape", score: 64, remaining: 181, badge: "S1" }
];

export const FILES = [
  { id: "payments", label: "payments.ts" },
  { id: "worker", label: "worker.ts" },
  { id: "tests", label: "concurrency.test.ts" }
];

export const CODE_SNAPSHOTS = {
  payments: [
    [
      "export async function charge(order: Order) {",
      "  const result = await provider.charge(order.total);",
      "  await db.orders.update(order.id, {",
      "    status: \"paid\",",
      "    providerId: result.id",
      "  });",
      "  return result;",
      "}"
    ],
    [
      "export async function charge(order: Order) {",
      "  return paymentLock.run(order.id, async () => {",
      "    const prior = await ledger.find(order.id);",
      "    if (prior) return prior;",
      "",
      "    return provider.charge(order.total, {",
      "      idempotencyKey: order.id",
      "    });",
      "  });",
      "}"
    ],
    [
      "export async function charge(order: Order) {",
      "  return paymentState.transition(order.id, \"charging\", {",
      "    effect: () => provider.charge(order.total, {",
      "      idempotencyKey: order.id",
      "    }),",
      "    cancel: () => provider.cancel(order.id)",
      "  });",
      "}"
    ]
  ],
  worker: [
    [
      "queue.consume(async (job) => {",
      "  try {",
      "    await charge(job.order);",
      "    job.ack();",
      "  } catch (error) {",
      "    job.retry();",
      "  }",
      "});"
    ],
    [
      "queue.consume(async (job) => {",
      "  try {",
      "    await charge(job.order);",
      "    job.ack();",
      "  } catch (error) {",
      "    const delay = retryAfter(error) ?? jitter(job.attempt);",
      "    job.retry({ delay, maxAttempts: 5 });",
      "  }",
      "});"
    ],
    [
      "queue.consume(async (job) => {",
      "  const state = await paymentState.read(job.order.id);",
      "  if (state.terminal) return job.ack();",
      "",
      "  await processWithBackpressure(job, {",
      "    retryAfter: true,",
      "    maxAttempts: 5",
      "  });",
      "});"
    ]
  ],
  tests: [
    [
      "it(\"charges an order\", async () => {",
      "  const result = await charge(order);",
      "  expect(result.status).toBe(\"paid\");",
      "});",
      "",
      "// concurrency and provider failure cases missing"
    ],
    [
      "it.concurrent(\"deduplicates retries\", async () => {",
      "  const attempts = range(20).map(() => charge(order));",
      "  await Promise.all(attempts);",
      "  expect(provider.chargesFor(order.id)).toHaveLength(1);",
      "});"
    ],
    [
      "test.each(failureMatrix)(",
      "  \"$name preserves exactly-once effects\",",
      "  async ({ inject, expected }) => {",
      "    await inject();",
      "    expect(await ledger.read(order.id)).toEqual(expected);",
      "  }",
      ");"
    ]
  ]
};

export const ROUNDS = [
  {
    id: "triage",
    step: "01 / Triage",
    title: "Start with signal",
    brief:
      "Checkout is duplicating charges under load. Your agent is ready. What do you ask it to do first?",
    choices: [
      {
        id: "trace-flow",
        title: "Trace the payment path",
        description:
          "Map queue delivery, charge creation, persistence, and acknowledgement before changing code.",
        prompt: "Trace one payment from queue receipt to acknowledgement. Find every non-idempotent boundary.",
        cost: "42 sec · 9 budget",
        timeCost: 42,
        budgetCost: 9,
        points: 20,
        dims: { judgment: 15, engineering: 5 },
        metrics: { p95: -70, errors: -0.8, duplicates: -1, throughput: 500 },
        response:
          "The queue is at-least-once. A provider charge can succeed before the order update times out, then the retry charges again. The missing boundary is an idempotency record keyed by order ID.",
        eventTitle: "Found the non-idempotent boundary",
        eventDetail:
          "Traced the failure across the provider call, database write, and queue acknowledgement.",
        log: "trace: 2 charge attempts share order_81K but not an idempotency key",
        codeStage: 0
      },
      {
        id: "patch-retry",
        title: "Increase retries",
        description:
          "Ask the agent to make failures less visible by retrying faster and more often.",
        prompt: "Increase retries to ten and reduce the retry delay.",
        cost: "24 sec · 7 budget",
        timeCost: 24,
        budgetCost: 7,
        points: 5,
        dims: { judgment: 2, engineering: 3 },
        metrics: { p95: 180, errors: 2.4, duplicates: 3, throughput: -300 },
        response:
          "Retries increased. Throughput briefly rises, but duplicate provider calls now amplify during database timeouts.",
        eventTitle: "Amplified the retry storm",
        eventDetail:
          "Changed retry policy before locating the transactional boundary.",
        log: "warning: duplicate-charge rate increased 3.1×",
        codeStage: 0
      },
      {
        id: "broad-review",
        title: "Request a broad review",
        description:
          "Ask for likely causes and a ranked list of fixes without supplying a concrete trace target.",
        prompt: "Review the payment service and suggest the most likely fixes.",
        cost: "35 sec · 12 budget",
        timeCost: 35,
        budgetCost: 12,
        points: 12,
        dims: { judgment: 8, engineering: 4 },
        metrics: { p95: -20, errors: -0.2, duplicates: 0, throughput: 100 },
        response:
          "Likely causes include missing idempotency, queue redelivery, database contention, or provider instability. I recommend adding retries and a distributed lock.",
        eventTitle: "Generated hypotheses",
        eventDetail:
          "Found the right neighborhood, but spent budget on an unfocused review.",
        log: "agent: 4 hypotheses returned; no execution trace captured",
        codeStage: 0
      }
    ]
  },
  {
    id: "patch",
    step: "02 / Review",
    title: "The agent proposes a patch",
    brief:
      "The first patch adds retry backoff, but it still allows the provider call and database write to diverge. Choose your response.",
    choices: [
      {
        id: "guarded-patch",
        title: "Demand an idempotent boundary",
        description:
          "Keep bounded backoff, but require a ledger guard and provider idempotency key.",
        prompt: "Revise this around an order-scoped idempotency record. Bound retries and honor Retry-After.",
        cost: "58 sec · 14 budget",
        timeCost: 58,
        budgetCost: 14,
        points: 22,
        dims: { engineering: 12, judgment: 10 },
        metrics: { p95: -210, errors: -3.1, duplicates: -4, throughput: 2300 },
        response:
          "Revised. The charge is now guarded by an order-scoped ledger record, the provider receives the same idempotency key, and retries are bounded with jitter.",
        eventTitle: "Rejected the plausible wrong answer",
        eventDetail:
          "Converted a retry patch into an exactly-once payment boundary.",
        log: "tests: 20 concurrent retries → 1 provider charge",
        codeStage: 1
      },
      {
        id: "accept-naive",
        title: "Accept the retry patch",
        description:
          "The diff is small, readable, and all existing unit tests pass.",
        prompt: "Apply the patch as written and run the current test suite.",
        cost: "31 sec · 8 budget",
        timeCost: 31,
        budgetCost: 8,
        points: 7,
        dims: { engineering: 4, judgment: 3 },
        metrics: { p95: -90, errors: -1.4, duplicates: 1, throughput: 900 },
        response:
          "Applied. The existing 14 tests pass. No concurrency test currently exercises duplicate delivery after a successful provider call.",
        eventTitle: "Accepted an incomplete fix",
        eventDetail:
          "Improved latency but left the money-moving side effect unguarded.",
        log: "14 passed · concurrency coverage: none",
        codeStage: 0
      },
      {
        id: "replace-queue",
        title: "Replace the queue",
        description:
          "Move delivery to a new exactly-once queue implementation.",
        prompt: "Replace the current queue with an exactly-once delivery system.",
        cost: "96 sec · 22 budget",
        timeCost: 96,
        budgetCost: 22,
        points: 10,
        dims: { engineering: 7, judgment: 3 },
        metrics: { p95: 90, errors: 0.6, duplicates: -1, throughput: -700 },
        response:
          "A queue migration touches deployment, observability, and replay semantics. The provider/database split remains non-atomic even with stronger delivery guarantees.",
        eventTitle: "Expanded the blast radius",
        eventDetail:
          "Chose an infrastructure migration that did not eliminate the core inconsistency.",
        log: "agent: estimated migration scope 23 files / 4 services",
        codeStage: 0
      }
    ]
  },
  {
    id: "adapt",
    step: "03 / Adapt",
    title: "The requirement just changed",
    brief:
      "The provider is returning 429s. Product now requires cancellations to take effect within 30 seconds—even while a charge is retrying.",
    isTwist: true,
    choices: [
      {
        id: "state-machine",
        title: "Model explicit payment states",
        description:
          "Make charge and cancellation competing transitions, with backpressure driven by Retry-After.",
        prompt: "Introduce explicit states with atomic transitions. Cancellation must preempt a queued retry safely.",
        cost: "74 sec · 18 budget",
        timeCost: 74,
        budgetCost: 18,
        points: 25,
        dims: { adaptation: 20, engineering: 5 },
        metrics: { p95: -150, errors: -2.3, duplicates: -1, throughput: 1100 },
        response:
          "Implemented a small payment state machine. Cancellation becomes a terminal transition, queued retries check state before execution, and provider backpressure is honored.",
        eventTitle: "Absorbed the requirement change",
        eventDetail:
          "Extended the same invariant instead of adding a second path around it.",
        log: "cancel SLA: p95 11.8s · queued retry after cancel: blocked",
        codeStage: 2
      },
      {
        id: "cancel-special-case",
        title: "Add a cancellation endpoint",
        description:
          "Write a direct provider cancellation path and leave the retry worker unchanged.",
        prompt: "Add POST /cancel that calls the provider immediately.",
        cost: "46 sec · 11 budget",
        timeCost: 46,
        budgetCost: 11,
        points: 12,
        dims: { adaptation: 9, engineering: 3 },
        metrics: { p95: -20, errors: -0.8, duplicates: 1, throughput: 300 },
        response:
          "The endpoint meets the happy-path SLA, but a queued charge retry can run after cancellation and reopen the payment.",
        eventTitle: "Created a competing write path",
        eventDetail:
          "Met the surface requirement without preserving the underlying state invariant.",
        log: "race found: cancel → retry → charged",
        codeStage: 1
      },
      {
        id: "rewrite-service",
        title: "Ask for a full rewrite",
        description:
          "Have the agent replace the service with a generated event-sourced implementation.",
        prompt: "Rewrite the payment service using event sourcing so cancellations are easy.",
        cost: "131 sec · 31 budget",
        timeCost: 131,
        budgetCost: 31,
        points: 6,
        dims: { adaptation: 4, engineering: 2 },
        metrics: { p95: 140, errors: 1.5, duplicates: 0, throughput: -1400 },
        response:
          "Generated a broad event-sourced design, but migration, replay compatibility, and operational behavior are unverified inside the launch window.",
        eventTitle: "Rewrote past the deadline",
        eventDetail:
          "Used agent throughput to create more unverified surface area.",
        log: "build: 3 type errors · 2 migration TODOs · 1 schema mismatch",
        codeStage: 1
      }
    ]
  },
  {
    id: "verify",
    step: "04 / Verify",
    title: "Prove it under failure",
    brief:
      "The happy path is green. You have time for one verification pass before the traffic ramp.",
    choices: [
      {
        id: "failure-matrix",
        title: "Run the failure matrix",
        description:
          "Exercise concurrency, timeouts after side effects, 429s, cancellation races, and worker restarts.",
        prompt: "Generate and run a failure matrix around every side-effect boundary. Include cancellation races.",
        cost: "69 sec · 15 budget",
        timeCost: 69,
        budgetCost: 15,
        points: 23,
        dims: { verification: 15, engineering: 8 },
        metrics: { p95: -80, errors: -1.1, duplicates: -1, throughput: 700 },
        response:
          "All 36 failure cases pass. One generated case exposed stale state after worker restart; the recovery read was moved ahead of retry scheduling.",
        eventTitle: "Made the fix survive reality",
        eventDetail:
          "Found and corrected a restart edge case before production traffic arrived.",
        log: "36 passed · 0 duplicate effects · mutation score 91%",
        codeStage: 2
      },
      {
        id: "unit-only",
        title: "Run the unit suite",
        description:
          "Verify the changed functions quickly and preserve deployment time.",
        prompt: "Run the unit tests for the changed payment modules.",
        cost: "28 sec · 5 budget",
        timeCost: 28,
        budgetCost: 5,
        points: 12,
        dims: { verification: 8, engineering: 4 },
        metrics: { p95: -20, errors: -0.4, duplicates: 0, throughput: 100 },
        response:
          "Twenty-two unit tests pass. No test currently forces a restart between provider success and ledger persistence.",
        eventTitle: "Verified functions, not the system",
        eventDetail:
          "Preserved time but missed the distributed failure boundary.",
        log: "22 passed · integration scenarios skipped",
        codeStage: 2
      },
      {
        id: "trust-agent",
        title: "Trust the implementation",
        description:
          "The agent reports high confidence and the patch is internally consistent.",
        prompt: "Summarize why this is safe to deploy.",
        cost: "18 sec · 7 budget",
        timeCost: 18,
        budgetCost: 7,
        points: 3,
        dims: { verification: 1, judgment: 2 },
        metrics: { p95: 0, errors: 0.2, duplicates: 1, throughput: 0 },
        response:
          "The design centralizes state transitions and should prevent duplicate effects. Confidence: high. Runtime failure injection was not performed.",
        eventTitle: "Substituted confidence for evidence",
        eventDetail:
          "Asked the system under test to argue for its own correctness.",
        log: "evidence: design summary only",
        codeStage: 2
      }
    ]
  },
  {
    id: "ship",
    step: "05 / Ship",
    title: "Make the launch call",
    brief:
      "Traffic is arriving. Choose the release strategy that closes the mission.",
    choices: [
      {
        id: "canary",
        title: "Deploy a measured canary",
        description:
          "Send 10% of traffic, watch invariants, then ramp automatically if the error budget holds.",
        prompt: "Deploy a 10% canary with rollback on duplicate charge, cancellation SLA, or p95 regression.",
        cost: "37 sec · 6 budget",
        timeCost: 37,
        budgetCost: 6,
        points: 10,
        dims: { verification: 5, adaptation: 5 },
        metrics: { p95: -70, errors: -0.7, duplicates: -1, throughput: 1200 },
        response:
          "Canary healthy. Traffic ramped to 100% with zero duplicate charges and cancellation p95 at 12.1 seconds.",
        eventTitle: "Shipped with a reversible decision",
        eventDetail:
          "Used production evidence to complete the rollout safely.",
        log: "launch: 12,400 orders/min · error budget 99.4% remaining",
        codeStage: 2
      },
      {
        id: "full-deploy",
        title: "Deploy to all traffic",
        description:
          "The failure matrix is green. Complete the rollout immediately.",
        prompt: "Deploy the current revision to 100% of workers.",
        cost: "21 sec · 3 budget",
        timeCost: 21,
        budgetCost: 3,
        points: 6,
        dims: { verification: 2, adaptation: 4 },
        metrics: { p95: -40, errors: -0.4, duplicates: -1, throughput: 900 },
        response:
          "Full deployment completed. Metrics are healthy, though no automatic rollback guard was attached to the release.",
        eventTitle: "Shipped without a safety rail",
        eventDetail:
          "Reached the outcome quickly but made the production decision harder to reverse.",
        log: "launch: 11,900 orders/min · rollback: manual",
        codeStage: 2
      },
      {
        id: "keep-polishing",
        title: "Optimize before deploying",
        description:
          "Ask the agent to reduce allocations and clean up the state-machine API first.",
        prompt: "Optimize allocations and refactor the transition API before release.",
        cost: "88 sec · 16 budget",
        timeCost: 88,
        budgetCost: 16,
        points: 4,
        dims: { engineering: 3, adaptation: 1 },
        metrics: { p95: -15, errors: 0.1, duplicates: 0, throughput: -200 },
        response:
          "Allocation rate improved by 8%, but the traffic ramp began before deployment completed.",
        eventTitle: "Optimized beyond the decision window",
        eventDetail:
          "Improved local code quality while the operational risk remained unresolved.",
        log: "traffic ramp active · deployment pending",
        codeStage: 2
      }
    ]
  }
];

export function createGame(alias = "guest") {
  return {
    alias: sanitizeAlias(alias),
    startedAt: Date.now(),
    remaining: 480,
    budget: 100,
    roundIndex: 0,
    total: 0,
    dimensions: {
      engineering: 0,
      adaptation: 0,
      verification: 0,
      judgment: 0
    },
    metrics: {
      p95: 640,
      errors: 8.2,
      duplicates: 4,
      throughput: 3100
    },
    codeStage: 0,
    events: [
      {
        type: "start",
        title: "Incident opened",
        detail: "Duplicate charges detected as launch traffic begins.",
        time: 480
      }
    ],
    chat: [
      {
        role: "agent",
        text:
          "Workspace indexed. I can inspect, patch, and test. What should I do first?"
      }
    ],
    completed: false
  };
}

export function currentRound(game) {
  return ROUNDS[game.roundIndex] ?? null;
}

export function applyChoice(game, choiceId) {
  if (game.completed) throw new Error("Mission is already complete.");

  const round = currentRound(game);
  const choice = round?.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error(`Unknown choice: ${choiceId}`);

  const next = structuredClone(game);
  next.remaining = Math.max(0, next.remaining - choice.timeCost);
  next.budget = Math.max(0, next.budget - choice.budgetCost);
  next.total += choice.points;
  next.codeStage = Math.max(next.codeStage, choice.codeStage);

  for (const [dimension, points] of Object.entries(choice.dims)) {
    next.dimensions[dimension] += points;
  }

  next.metrics = applyMetricDelta(next.metrics, choice.metrics);
  next.chat.push({ role: "player", text: choice.prompt });
  next.chat.push({ role: "agent", text: choice.response });
  next.events.push({
    type: choice.points >= 18 ? "success" : choice.points >= 10 ? "neutral" : "risk",
    title: choice.eventTitle,
    detail: choice.eventDetail,
    log: choice.log,
    time: next.remaining,
    points: choice.points
  });

  next.roundIndex += 1;

  if (next.roundIndex === 2) {
    next.metrics = applyMetricDelta(next.metrics, {
      p95: 170,
      errors: 2.1,
      duplicates: 1,
      throughput: -600
    });
    next.events.push({
      type: "twist",
      title: "Live requirement injected",
      detail:
        "Provider throttling begins. Product adds a 30-second cancellation SLA.",
      log: "incident: HTTP 429 burst · cancellation SLA now active",
      time: next.remaining
    });
    next.chat.push({
      role: "system",
      text:
        "LIVE CHANGE — Provider throttling detected. Cancellations must now complete within 30 seconds."
    });
  }

  if (next.roundIndex >= ROUNDS.length) {
    next.completed = true;
    next.finishedAt = Date.now();
  }

  return next;
}

export function applyElapsedSecond(game) {
  if (game.completed || game.remaining <= 0) return game;
  return { ...game, remaining: game.remaining - 1 };
}

export function expireGame(game) {
  if (game.completed) return game;

  const next = structuredClone(game);
  next.remaining = 0;
  next.completed = true;
  next.finishedAt = Date.now();
  next.events.push({
    type: "risk",
    title: "Decision window closed",
    detail: "The traffic ramp completed before the incident was fully contained.",
    log: "mission: timebox exhausted",
    time: 0,
    points: 0
  });
  return next;
}

export function getCode(fileId, stage) {
  const versions = CODE_SNAPSHOTS[fileId] ?? CODE_SNAPSHOTS.payments;
  return versions[Math.min(stage, versions.length - 1)];
}

export function finalResult(game) {
  const score = Math.max(0, Math.min(100, game.total));
  const percentile = Math.max(4, Math.min(99, Math.round(22 + score * 0.79)));
  const division =
    score >= 94
      ? "Diamond I"
      : score >= 88
        ? "Diamond II"
        : score >= 80
          ? "Gold I"
          : score >= 70
            ? "Gold II"
            : score >= 58
              ? "Silver I"
              : "Silver II";

  return {
    alias: game.alias,
    score,
    percentile,
    division,
    remaining: game.remaining,
    dimensions: normalizeDimensions(game.dimensions),
    events: game.events,
    completedAt: game.finishedAt ?? Date.now()
  };
}

export function normalizeDimensions(values) {
  const maxima = {
    engineering: 30,
    adaptation: 25,
    verification: 20,
    judgment: 25
  };

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      Math.min(100, Math.round((value / maxima[key]) * 100))
    ])
  );
}

export function leaderboardWith(result = null) {
  const rows = [...BASE_LEADERBOARD];
  if (result) {
    rows.push({
      alias: sanitizeAlias(result.alias),
      score: result.score,
      remaining: result.remaining,
      badge: badgeFor(result.division),
      isPlayer: true
    });
  }

  return rows
    .sort((a, b) => b.score - a.score || b.remaining - a.remaining)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function sanitizeAlias(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 18);
  return normalized || "guest";
}

export function badgeFor(division) {
  return division
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function normalizeMetric(metric, value) {
  if (metric === "errors") return Math.max(0, Math.min(99, Number(value.toFixed(1))));
  if (metric === "duplicates") return Math.max(0, Math.round(value));
  if (metric === "p95") return Math.max(70, Math.round(value));
  if (metric === "throughput") return Math.max(0, Math.round(value));
  return value;
}

function applyMetricDelta(metrics, delta) {
  return Object.fromEntries(
    Object.entries(metrics).map(([metric, value]) => [
      metric,
      normalizeMetric(metric, value + (delta[metric] ?? 0))
    ])
  );
}
