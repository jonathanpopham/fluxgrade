import {
  BASE_LEADERBOARD,
  DIMENSIONS,
  FILES,
  STORAGE_KEY,
  applyChoice,
  applyElapsedSecond,
  badgeFor,
  createGame,
  currentRound,
  expireGame,
  finalResult,
  formatClock,
  getCode,
  leaderboardWith,
  sanitizeAlias
} from "./game-engine.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const screens = $$(".screen");
const twistOverlay = $("[data-twist-overlay]");
const aliasInput = $("[data-alias-input]");
const toast = $("[data-toast]");

let game = null;
let lastResult = loadLatestResult();
let activeFile = "payments";
let timer = null;
let soundsEnabled = false;
let pendingTwist = false;
let toastTimer = null;

renderLeaderboard(
  $("[data-leaderboard-preview]"),
  lastResult ? leaderboardWith(lastResult).slice(0, 5) : BASE_LEADERBOARD.slice(0, 5)
);
renderFileTabs();

document.addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton.dataset.action);

  const choice = event.target.closest("[data-choice-id]");
  if (choice) makeChoice(choice.dataset.choiceId);

  const fileTab = event.target.closest("[data-file-id]");
  if (fileTab) {
    activeFile = fileTab.dataset.fileId;
    renderFileTabs();
    renderCode();
  }

  const mobileTab = event.target.closest("[data-mobile-panel]");
  if (mobileTab) activateMobilePanel(mobileTab.dataset.mobilePanel);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pendingTwist) {
    handleAction("acknowledge-twist");
    return;
  }
  if (event.key !== "Enter") return;
  const current = $(".screen.is-active")?.dataset.screen;
  if (current === "landing") handleAction("open-briefing");
  if (current === "briefing" && document.activeElement !== aliasInput) {
    handleAction("start-mission");
  }
});

$(".sound-toggle").addEventListener("click", (event) => {
  soundsEnabled = !soundsEnabled;
  event.currentTarget.setAttribute("aria-pressed", String(soundsEnabled));
  if (soundsEnabled) playTone(560, 0.07);
  showToast(soundsEnabled ? "Interface sound on" : "Interface sound off");
});

window.addEventListener("pagehide", stopTimer);

function handleAction(action) {
  if (action === "open-briefing") {
    showScreen("briefing");
    requestAnimationFrame(() => aliasInput.focus());
    playTone(420, 0.06);
  }

  if (action === "scroll-how") {
    $("#how-it-plays").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (action === "back-home") {
    stopTimer();
    hideTwist();
    showScreen("landing");
  }

  if (action === "start-mission") {
    startMission(sanitizeAlias(aliasInput.value));
  }

  if (action === "acknowledge-twist") {
    pendingTwist = false;
    hideTwist();
    renderMission();
    startTimer();
    playTone(690, 0.09);
  }

  if (action === "rematch") {
    startMission(game?.alias ?? aliasInput.value);
  }

  if (action === "share-result") {
    shareResult();
  }
}

function showScreen(name) {
  screens.forEach((screen) => {
    const active = screen.dataset.screen === name;
    screen.classList.toggle("is-active", active);
    screen.setAttribute("aria-hidden", String(!active));
  });
  window.scrollTo({ top: 0, behavior: "instant" });
}

function startMission(alias) {
  stopTimer();
  aliasInput.value = alias;
  activeFile = "payments";
  pendingTwist = false;
  game = createGame(alias);
  showScreen("mission");
  activateMobilePanel("agent");
  renderMission();
  startTimer();
  playTone(520, 0.08);
}

function makeChoice(choiceId) {
  if (!game || game.completed || pendingTwist) return;

  const round = currentRound(game);
  const choice = round?.choices.find((candidate) => candidate.id === choiceId);
  if (!choice) return;

  $$(".choice-card").forEach((card) => {
    card.disabled = true;
    card.classList.toggle("is-selected", card.dataset.choiceId === choiceId);
  });

  game = applyChoice(game, choiceId);
  playTone(choice.points >= 18 ? 640 : 330, 0.08);
  renderMission();

  if (game.completed) {
    stopTimer();
    window.setTimeout(showResults, 450);
    return;
  }

  if (game.roundIndex === 2) {
    pendingTwist = true;
    stopTimer();
    window.setTimeout(showTwist, 420);
  }
}

function startTimer() {
  stopTimer();
  timer = window.setInterval(() => {
    game = applyElapsedSecond(game);
    renderCounters();
    if (game.remaining <= 0) {
      game = expireGame(game);
      stopTimer();
      showResults();
    }
  }, 1000);
}

function stopTimer() {
  if (timer) window.clearInterval(timer);
  timer = null;
}

function showTwist() {
  twistOverlay.classList.add("is-visible");
  twistOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-overlay");
  $("[data-action='acknowledge-twist']").focus();
  playTone(210, 0.14);
}

function hideTwist() {
  twistOverlay.classList.remove("is-visible");
  twistOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("has-overlay");
}

function renderMission() {
  if (!game) return;
  renderCounters();
  renderCode();
  renderChat();
  renderMetrics();
  renderOps();

  const round = currentRound(game);
  if (!round) return;

  $("[data-step-label]").textContent = round.step;
  $("[data-round-step]").textContent = round.step;
  $("[data-round-title]").textContent = round.title;
  $("[data-round-brief]").textContent = round.brief;
  $("[data-round-count]").textContent = `${game.roundIndex + 1} of 5 decisions`;

  const choiceGrid = $("[data-choice-grid]");
  choiceGrid.replaceChildren(
    ...round.choices.map((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "choice-card";
      button.dataset.choiceId = choice.id;

      const choiceIndex = document.createElement("span");
      choiceIndex.className = "choice-index";
      choiceIndex.textContent = `0${index + 1}`;

      const title = document.createElement("strong");
      title.textContent = choice.title;

      const description = document.createElement("p");
      description.textContent = choice.description;

      const cost = document.createElement("span");
      cost.className = "choice-cost";
      cost.textContent = choice.cost;

      button.append(choiceIndex, title, description, cost);
      return button;
    })
  );
}

function renderCounters() {
  if (!game) return;
  $("[data-live-score]").textContent = game.total;
  $("[data-budget]").textContent = game.budget;
  $("[data-clock]").textContent = formatClock(game.remaining);
  $("[data-clock]").closest(".counter").classList.toggle("is-low", game.remaining < 90);

  const progress = Math.min(5, game.roundIndex);
  const progressElement = $(".mission-progress");
  progressElement.setAttribute("aria-valuenow", String(progress));
  $("[data-progress-bar]").style.width = `${(progress / 5) * 100}%`;
}

function renderFileTabs() {
  const container = $("[data-file-tabs]");
  if (!container) return;
  container.replaceChildren(
    ...FILES.map((file) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "file-tab";
      button.role = "tab";
      button.dataset.fileId = file.id;
      button.setAttribute("aria-selected", String(activeFile === file.id));
      button.textContent = file.label;
      return button;
    })
  );
}

function renderCode() {
  if (!game) return;
  renderFileTabs();
  const code = $("[data-code-view]");
  const lines = getCode(activeFile, game.codeStage);
  code.replaceChildren(
    ...lines.map((line, index) => {
      const row = document.createElement("span");
      row.className = "code-line";

      const lineNumber = document.createElement("span");
      lineNumber.className = "line-number";
      lineNumber.textContent = String(index + 1);

      const source = document.createElement("span");
      source.innerHTML = highlightCode(line) || " ";
      row.append(lineNumber, source);
      return row;
    })
  );

  const statuses = [
    "14 passing · coverage gap",
    "20 passing · concurrency green",
    "36 passing · failure matrix green"
  ];
  $("[data-test-status]").textContent = statuses[game.codeStage];
  $(".status-dot").classList.toggle("is-good", game.codeStage > 0);
}

function renderChat() {
  const stream = $("[data-chat-stream]");
  stream.replaceChildren(
    ...game.chat.map((message, index) => {
      const article = document.createElement("article");
      article.className = `chat-message ${message.role}`;

      const avatar = document.createElement("span");
      avatar.className = "chat-avatar";
      avatar.textContent = message.role === "agent" ? "AI" : message.role === "player" ? "YOU" : "!";

      const content = document.createElement("div");
      content.className = "chat-content";
      const meta = document.createElement("div");
      meta.className = "chat-meta";
      const author = document.createElement("span");
      author.textContent =
        message.role === "agent" ? "Flux Agent" : message.role === "player" ? game.alias : "Live system";
      const marker = document.createElement("span");
      marker.textContent = `0${index + 1}`;
      meta.append(author, marker);

      const text = document.createElement("p");
      text.textContent = message.text;
      content.append(meta, text);
      article.append(avatar, content);
      return article;
    })
  );
  stream.scrollTop = stream.scrollHeight;

  const latestPlayer = [...game.chat].reverse().find((message) => message.role === "player");
  $("[data-prompt-preview]").textContent =
    latestPlayer?.text ?? "Choose an action above to direct the agent.";
}

function renderMetrics() {
  const formatters = {
    throughput: (value) => value.toLocaleString("en-US"),
    p95: (value) => String(value),
    errors: (value) => value.toFixed(1),
    duplicates: (value) => String(value)
  };

  $$("[data-metric]").forEach((card) => {
    const metric = card.dataset.metric;
    const value = game.metrics[metric];
    $("[data-metric-value]", card).textContent = formatters[metric](value);
    card.classList.remove("is-good", "is-bad", "is-critical");

    const isGood =
      (metric === "p95" && value < 250) ||
      (metric === "errors" && value < 1) ||
      (metric === "duplicates" && value === 0) ||
      metric === "throughput";
    if (isGood) card.classList.add("is-good");
    else if (metric === "duplicates" && value > 0) card.classList.add("is-critical");
    else card.classList.add("is-bad");
  });
}

function renderOps() {
  const events = [...game.events].reverse();
  $("[data-ops-events]").replaceChildren(
    ...events.map((event) => {
      const row = document.createElement("article");
      row.className = `ops-event ${event.type}`;
      const time = document.createElement("time");
      time.textContent = formatClock(event.time);
      const log = document.createElement("p");
      log.textContent = event.log ?? event.title;
      row.append(time, log);
      return row;
    })
  );
}

function activateMobilePanel(panelName) {
  $$("[data-mobile-panel]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.mobilePanel === panelName));
  });
  $$("[data-panel]").forEach((panel) => {
    panel.classList.toggle("is-mobile-active", panel.dataset.panel === panelName);
  });
}

function showResults() {
  if (!game) return;
  stopTimer();
  lastResult = finalResult(game);
  saveResult(lastResult);
  renderLeaderboard(
    $("[data-leaderboard-preview]"),
    leaderboardWith(lastResult).slice(0, 5)
  );
  showScreen("results");

  const leaderboard = leaderboardWith(lastResult);
  const player = leaderboard.find((row) => row.isPlayer);
  $("[data-final-score]").textContent = lastResult.score;
  $("[data-final-rank]").textContent = player.rank;
  $("[data-final-division]").textContent = lastResult.division;
  $("[data-division-badge]").textContent = badgeFor(lastResult.division);
  $("[data-top-percent]").textContent = Math.max(1, 100 - lastResult.percentile);
  $("[data-replay-duration]").textContent =
    `${formatClock(480 - lastResult.remaining)} elapsed`;

  const strong = lastResult.score >= 80;
  $("#results-title").textContent =
    game.metrics.duplicates === 0 && game.metrics.p95 < 250
      ? "Incident contained."
      : lastResult.score >= 58
        ? "Incident stabilized."
        : "Incident unresolved.";
  $("[data-results-summary]").textContent = strong
    ? "Your decisions kept the payment system moving through a live requirement change."
    : "The service survived, but your replay shows where speed outran evidence.";
  $("[data-outcome-duplicate]").textContent =
    game.metrics.duplicates === 0 ? "Duplicate charges stopped" : `${game.metrics.duplicates} duplicates remain`;
  $("[data-outcome-latency]").textContent =
    game.metrics.p95 < 250 ? `p95 restored to ${game.metrics.p95} ms` : `p95 remains ${game.metrics.p95} ms`;
  $("[data-outcome-adaptation]").textContent = game.events.some(
    (event) => event.title === "Absorbed the requirement change"
  )
    ? "Requirement absorbed"
    : "Requirement partially handled";

  renderDimensions();
  renderReplay();
  renderLeaderboard($("[data-final-leaderboard]"), leaderboard.slice(0, 8));

  const ring = $("[data-score-ring]");
  const circumference = 2 * Math.PI * 73;
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference);
  requestAnimationFrame(() => {
    ring.style.strokeDashoffset = String(circumference * (1 - lastResult.score / 100));
    $$(".dimension-track i").forEach((bar) => {
      bar.style.width = `${bar.dataset.value}%`;
    });
  });
  playTone(lastResult.score >= 80 ? 720 : 360, 0.12);
}

function renderDimensions() {
  $("[data-dimension-bars]").replaceChildren(
    ...DIMENSIONS.map((dimension) => {
      const row = document.createElement("div");
      row.className = "dimension-row";
      const label = document.createElement("span");
      label.textContent = dimension.label;
      const track = document.createElement("div");
      track.className = "dimension-track";
      const fill = document.createElement("i");
      fill.dataset.value = lastResult.dimensions[dimension.id];
      track.append(fill);
      const value = document.createElement("strong");
      value.textContent = `${lastResult.dimensions[dimension.id]}%`;
      row.append(label, track, value);
      return row;
    })
  );
}

function renderReplay() {
  const decisions = lastResult.events.filter((event) => event.type !== "start");
  $("[data-replay-timeline]").replaceChildren(
    ...decisions.map((event) => {
      const row = document.createElement("article");
      row.className = `replay-event ${event.type}`;
      const time = document.createElement("time");
      time.textContent = `T–${formatClock(event.time)}`;
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = event.title;
      const detail = document.createElement("p");
      detail.textContent = event.detail;
      copy.append(title, detail);
      const points = document.createElement("span");
      points.className = "replay-points";
      points.textContent = event.points ? `+${event.points}` : "LIVE";
      row.append(time, copy, points);
      return row;
    })
  );
}

function renderLeaderboard(container, rows) {
  container.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement("div");
      item.className = `leaderboard-row${row.isPlayer ? " is-player" : ""}`;

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(row.rank ?? BASE_LEADERBOARD.indexOf(row) + 1).padStart(2, "0");

      const alias = document.createElement("div");
      alias.className = "leaderboard-alias";
      const badge = document.createElement("i");
      badge.className = "leaderboard-badge";
      badge.textContent = row.badge;
      const name = document.createElement("span");
      name.textContent = row.alias;
      alias.append(badge, name);

      const score = document.createElement("strong");
      score.textContent = row.score;
      const remaining = document.createElement("span");
      remaining.className = "leaderboard-time";
      remaining.textContent = formatClock(row.remaining);
      item.append(rank, alias, score, remaining);
      return item;
    })
  );
}

function saveResult(result) {
  try {
    const history = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    history.unshift(result);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 10)));
  } catch {
    // The mission remains playable when storage is unavailable.
  }
}

function loadLatestResult() {
  try {
    const [latest] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (
      latest &&
      typeof latest.score === "number" &&
      typeof latest.remaining === "number" &&
      typeof latest.division === "string"
    ) {
      return latest;
    }
  } catch {
    // Ignore malformed or unavailable local history.
  }
  return null;
}

async function shareResult() {
  if (!lastResult) return;
  const text =
    `I scored ${lastResult.score}/100 (${lastResult.division}) on Fluxgrade’s ` +
    `Black Friday engineering mission. Can you beat it?`;
  const url = new URL("./", window.location.href).href;

  try {
    if (navigator.share) {
      await navigator.share({ title: "My Fluxgrade result", text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      showToast("Result copied to clipboard");
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast("Sharing is unavailable in this browser");
  }
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function highlightCode(line) {
  const escaped = line
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  if (escaped.trim().startsWith("//")) {
    return `<span class="token-comment">${escaped}</span>`;
  }

  return escaped
    .replace(/(&quot;.*?&quot;|".*?")/g, '<span class="token-string">$1</span>')
    .replace(
      /\b(export|async|function|return|await|const|try|catch|if|new)\b/g,
      '<span class="token-keyword">$1</span>'
    )
    .replace(
      /\b(charge|transition|consume|processWithBackpressure|test|expect|read)\b(?=\()/g,
      '<span class="token-function">$1</span>'
    );
}

function playTone(frequency, duration) {
  if (!soundsEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.025, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  } catch {
    // Sound is an optional enhancement.
  }
}
