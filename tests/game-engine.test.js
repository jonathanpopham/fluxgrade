import test from "node:test";
import assert from "node:assert/strict";

import {
  ROUNDS,
  applyChoice,
  createGame,
  expireGame,
  finalResult,
  formatClock,
  leaderboardWith,
  sanitizeAlias
} from "../src/game-engine.js";

test("the optimal path produces a perfect mission score", () => {
  const choices = [
    "trace-flow",
    "guarded-patch",
    "state-machine",
    "failure-matrix",
    "canary"
  ];

  const game = choices.reduce(
    (state, choice) => applyChoice(state, choice),
    createGame("test_player")
  );
  const result = finalResult(game);

  assert.equal(game.completed, true);
  assert.equal(result.score, 100);
  assert.equal(result.division, "Diamond I");
  assert.equal(game.events.filter((event) => event.type === "twist").length, 1);
  assert.equal(game.metrics.duplicates, 0);
});

test("every configured decision produces a valid next state", () => {
  for (let roundIndex = 0; roundIndex < ROUNDS.length; roundIndex += 1) {
    for (const choice of ROUNDS[roundIndex].choices) {
      let game = createGame("matrix");
      for (let prior = 0; prior < roundIndex; prior += 1) {
        game = applyChoice(game, ROUNDS[prior].choices[0].id);
      }

      const next = applyChoice(game, choice.id);
      assert.equal(next.roundIndex, roundIndex + 1);
      assert.ok(next.total >= 0 && next.total <= 100);
      assert.ok(next.remaining >= 0);
      assert.ok(next.budget >= 0);
    }
  }
});

test("leaderboard inserts the player using score and time as tie breakers", () => {
  const rows = leaderboardWith({
    alias: "me",
    score: 95,
    remaining: 250,
    division: "Diamond I"
  });
  const player = rows.find((row) => row.isPlayer);

  assert.equal(player.rank, 2);
  assert.equal(player.alias, "me");
});

test("aliases and clocks are safe for rendering", () => {
  assert.equal(sanitizeAlias("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(sanitizeAlias(""), "guest");
  assert.equal(formatClock(480), "08:00");
  assert.equal(formatClock(7), "00:07");
  assert.equal(formatClock(-2), "00:00");
});

test("an expired mission closes safely and can still be scored", () => {
  const game = expireGame(createGame("late_player"));
  const result = finalResult(game);

  assert.equal(game.completed, true);
  assert.equal(game.remaining, 0);
  assert.equal(result.score, 0);
  assert.equal(game.events.at(-1).title, "Decision window closed");
});
