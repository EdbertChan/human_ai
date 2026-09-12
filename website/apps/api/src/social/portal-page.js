import { portalEmptyState, portalHeader } from "./portal-assets.js";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

export function PORTAL_PAGE(googleClientId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>EmapthyAi social queue</title>
<style>
  :root {
    color-scheme: light;
    --ink: #1d1c1d;
    --muted: #5b5565;
    --line: #d9d4ef;
    --line-input: #aaa2b5;
    --purple: #4f37b8;
    --purple-dark: #38278f;
    --ring: #7c5cff;
    --surface-tint: #f7f5ff;
    --white: #ffffff;
    --red: #b42318;
    --red-border: #e0a4a4;
    --red-surface: #fff5f5;
    --red-surface-strong: #ffe8e8;
    --green: #1a7f4b;
    --green-surface: #e6f7ee;
    --disabled: #8a8a8a;
    --shadow: 0 1px 2px rgba(29, 20, 71, 0.04), 0 4px 16px rgba(29, 20, 71, 0.06);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--ink);
    background: var(--surface-tint);
    -webkit-font-smoothing: antialiased;
  }
  main { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 0 0 64px; }

  header.hero {
    background: var(--white) url('${portalHeader}') right center / contain no-repeat;
    border-bottom: 1px solid var(--line);
    margin-bottom: 20px;
  }
  header.hero .hero-inner { width: min(1080px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 24px; }
  header.hero h1 { font-size: 1.65rem; letter-spacing: -0.01em; margin: 0 0 6px; }
  header.hero p { margin: 0; color: var(--muted); max-width: 46ch; }

  nav.sections {
    position: sticky; top: 0; z-index: 5;
    display: flex; gap: 4px; flex-wrap: wrap;
    background: rgba(247, 245, 255, 0.92); backdrop-filter: blur(6px);
    border-bottom: 1px solid var(--line);
    padding: 10px 0; margin-bottom: 18px;
  }
  nav.sections a {
    color: var(--muted); text-decoration: none; font-size: 0.85rem; font-weight: 600;
    padding: 6px 12px; border-radius: 999px;
  }
  nav.sections a:hover { color: var(--purple); background: var(--white); }

  h2 { font-size: 1.05rem; letter-spacing: -0.005em; margin: 30px 0 10px; scroll-margin-top: 56px; }
  h2:first-of-type { margin-top: 0; }
  section {
    background: var(--white);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 18px;
    margin-top: 12px;
    box-shadow: var(--shadow);
  }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

  button {
    font: inherit; font-weight: 600; border: 1px solid var(--purple);
    background: var(--purple); color: var(--white);
    border-radius: 9px; padding: 8px 14px; cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  button:hover { background: var(--purple-dark); border-color: var(--purple-dark); }
  button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  button.secondary { background: var(--white); color: var(--purple); }
  button.secondary:hover { background: var(--surface-tint); }
  button.danger { background: var(--white); border-color: var(--red-border); color: var(--red); }
  button.danger:hover { background: var(--red-surface); }
  button:disabled { background: var(--disabled); border-color: var(--disabled); cursor: not-allowed; }

  input, textarea, select {
    font: inherit; border: 1px solid var(--line-input); border-radius: 8px;
    padding: 7px 10px; color: var(--ink); background: var(--white);
  }
  input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--ring); outline-offset: 1px; }

  .card { border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin-top: 12px; }
  .card:hover { border-color: var(--line-input); }
  .muted { color: var(--muted); font-size: 0.87rem; }
  .tabular { font-variant-numeric: tabular-nums; }

  .settings-master {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: var(--surface-tint); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 14px;
  }
  .settings-master strong { font-size: 0.95rem; }
  .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 680px) { .settings-grid { grid-template-columns: 1fr; } }
  .settings-group { border: 1px solid var(--line); border-radius: 12px; padding: 14px; }
  .settings-group h3 { margin: 0 0 4px; font-size: 0.9rem; }
  .settings-group .muted { margin: 0 0 10px; }

  .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { position: relative; }
  .chip input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .chip span {
    display: inline-block; padding: 5px 11px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--line-input); color: var(--muted); font-size: 0.82rem;
    transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }
  .chip:has(input:checked) span { background: var(--purple); border-color: var(--purple); color: var(--white); }
  .chip:has(input:focus-visible) span { outline: 2px solid var(--ring); outline-offset: 1px; }

  .toggle { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
  .toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .toggle .track {
    width: 40px; height: 22px; border-radius: 999px; background: var(--line-input);
    position: relative; transition: background-color 0.15s ease; flex-shrink: 0;
  }
  .toggle .track::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px;
    border-radius: 50%; background: var(--white); transition: transform 0.15s ease;
  }
  .toggle:has(input:checked) .track { background: var(--green); }
  .toggle:has(input:checked) .track::after { transform: translateX(18px); }
  .toggle:has(input:focus-visible) .track { outline: 2px solid var(--ring); outline-offset: 2px; }

  .field-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .field-grid label { display: block; font-size: 0.78rem; color: var(--muted); margin-bottom: 3px; }
  .field-grid input { width: 100%; }

  .pill {
    display: inline-block; padding: 3px 10px; border-radius: 999px;
    background: var(--surface-tint); color: var(--purple-dark); font-size: 0.78rem; font-weight: 700;
  }
  .pill.stop { background: var(--red-surface-strong); color: var(--red); }
  .pill.go { background: var(--green-surface); color: var(--green); }

  blockquote {
    margin: 8px 0; padding: 10px 12px; border-left: 3px solid var(--purple);
    background: var(--surface-tint); border-radius: 0 8px 8px 0; white-space: pre-wrap;
  }

  table { width: 100%; border-collapse: collapse; font-size: 0.87rem; }
  th {
    text-align: left; padding: 8px 8px; border-bottom: 2px solid var(--line);
    color: var(--muted); font-weight: 700; font-size: 0.82rem;
  }
  td { text-align: left; padding: 8px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:hover td { background: var(--surface-tint); }

  .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 0 8px; text-align: center; }
  .empty-state img { width: 96px; height: 96px; }
  .empty-state p { margin: 0; }

  #error { color: var(--red); font-weight: 600; }
  [hidden] { display: none !important; }

  @media (max-width: 720px) {
    header.hero { background-image: none; }
  }
</style>
</head>
<body>
<header class="hero">
  <div class="hero-inner">
    <h1>EmapthyAi social queue</h1>
    <p>A person posts every reply inside X. This portal never posts, edits, or deletes anything on X.</p>
  </div>
</header>
<main>
  <p id="error" role="alert"></p>

  <section id="signin">
    <h2>Sign in</h2>
    <p class="muted">Allowlisted Google accounts from @emapthyai.ai or @nekocatpitalventures.com only.</p>
    <div id="g_id_onload"
      data-client_id="${escapeHtml(googleClientId ?? "")}"
      data-callback="onGoogleCredential"
      data-auto_prompt="false"></div>
    <div class="g_id_signin" data-type="standard"></div>
    <p class="muted" id="signin-hint"></p>
  </section>

  <div id="app" hidden>
    <nav class="sections">
      <a href="#queue-section">Queue</a>
      <a href="#activity-section">Activity</a>
      <a href="#settings-section">Settings</a>
      <a href="#creators-section">Creators</a>
      <a href="#experiments-section">Experiments</a>
      <a href="#operations-section">Operations</a>
      <a href="#audit-section">Audit</a>
    </nav>

    <section>
      <div class="row">
        <strong id="operator"></strong>
        <span id="campaign-state" class="pill"></span>
        <span id="cap" class="muted tabular"></span>
        <select id="pause-reason"></select>
        <button class="danger" id="pause">Pause campaign</button>
        <button class="secondary" id="signout">Sign out</button>
      </div>
      <p class="muted" id="prereqs"></p>
    </section>

    <div class="row">
      <span id="x-write-status" class="muted"></span>
      <button id="x-write-connect">Connect X account</button>
    </div>

    <div class="row">
      <button class="danger" id="clear-activity">Clear activity &amp; queue</button>
      <span class="muted">Wipes every scanned post and queued reply below. Cannot be undone.</span>
    </div>

    <h2 id="queue-section">Queue</h2>
    <div id="queue"></div>

    <h2 id="activity-section">Activity</h2>
    <p class="muted">Every original post and quote-tweet scanned from a tracked creator, with why it was queued or skipped.</p>
    <div id="activity"></div>

    <h2 id="settings-section">Campaign settings</h2>
    <section id="settings"></section>

    <h2 id="creators-section">Creators</h2>
    <section>
      <div class="row">
        <input id="creator-handle" placeholder="X handle, no @" />
        <button id="creator-add">Allow</button>
        <button class="danger" id="creator-block">Block permanently</button>
      </div>
      <p class="muted">The numeric X ID is looked up automatically from the handle — no need to find it yourself.</p>
      <table id="creators"></table>
    </section>

    <h2 id="experiments-section">Experiments</h2>
    <section id="experiments"></section>

    <h2 id="operations-section">Operations</h2>
    <section id="operations"></section>

    <h2 id="audit-section">Audit trail</h2>
    <section><table id="audit"></table></section>
  </div>
</main>

<script src="https://accounts.google.com/gsi/client" async defer></script>
<script>
const state = { data: null };
const el = (id) => document.getElementById(id);
const text = (value) => document.createTextNode(String(value ?? ""));
const EMPTY_STATE_IMAGE = "${portalEmptyState}";

function showError(message) {
  el("error").textContent = message ?? "";
  // An operator scrolled down to Settings/Creators/etc. would otherwise
  // never see this — it sits at the very top of the page.
  if (message) el("error").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function api(path, options) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.reason || body.error || response.statusText);
    error.body = body;
    throw error;
  }
  return body;
}

window.onGoogleCredential = async (response) => {
  showError("");
  try {
    await api("/portal/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: response.credential })
    });
    await refresh();
  } catch (error) { showError(error.message); }
};

function node(tag, properties = {}, children = []) {
  const element = document.createElement(tag);
  Object.assign(element, properties);
  for (const child of children) element.append(child);
  return element;
}

function emptyState(message) {
  return node("div", { className: "empty-state" }, [
    node("img", { src: EMPTY_STATE_IMAGE, alt: "" }),
    node("p", { className: "muted", textContent: message })
  ]);
}

function renderQueue(queue) {
  const container = el("queue");
  container.replaceChildren();
  if (queue.length === 0) container.append(emptyState("Nothing queued."));
  for (const item of queue) {
    const card = node("div", { className: "card" });
    card.append(node("div", { className: "row" }, [
      node("span", { className: "pill", textContent: item.canonicalCategory }),
      node("span", { className: item.expired ? "pill stop" : "pill go", textContent: item.state }),
      node("span", { className: "muted tabular", textContent: "age " + item.sourceAgeMinutes + "m · expires " + item.expiresAt })
    ]));
    card.append(node("p", { className: "muted", textContent: "@" + (item.creatorHandle ?? "unknown") }));
    const details = [];
    if (item.sourceUrl) details.push("source " + item.sourceUrl);
    if (item.riskClass) details.push("risk " + item.riskClass);
    if (item.skipReason) details.push("skip " + item.skipReason);
    if (item.creatorCooldownUntil) details.push("creator cooldown until " + item.creatorCooldownUntil);
    if (details.length > 0) card.append(node("p", { className: "muted", textContent: details.join(" · ") }));
    card.append(node("blockquote", { textContent: item.originalText ?? "(text purged)" }));
    card.append(node("blockquote", { textContent: item.replyText ?? "(text purged)" }));

    const reason = node("select");
    for (const value of state.data.settingsSchema.rejectionReasons) {
      reason.append(node("option", { value, textContent: value }));
    }
    const note = node("input", { placeholder: "note (stays internal)" });

    if (item.state === "failed") {
      // An earlier auto-post attempt got no response from X -- whether it
      // actually posted is unknown, so this never auto-retries. An operator
      // checks X by hand and reconciles with the same manual flow as before.
      card.append(node("p", { className: "muted", textContent: "Post outcome unknown -- check X, then reconcile below." }));
      const replyUrl = node("input", { placeholder: "posted reply URL, if it went through" });
      const verify = node("button", { className: "secondary", textContent: "Reconcile" });
      verify.onclick = async () => {
        showError("");
        try {
          await api("/portal/api/candidates/" + item.id + "/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ replyUrl: replyUrl.value })
          });
          await refresh();
        } catch (error) { showError(error.message); }
      };
      card.append(node("div", { className: "row" }, [replyUrl, verify]));
    } else {
      const reply = node("button", {
        textContent: "Reply",
        disabled: item.expired || !state.data.xWriteConnected.connected
      });
      reply.onclick = async () => {
        if (!confirm("Post this reply to X right now? This cannot be undone.")) return;
        showError("");
        try {
          await api("/portal/api/candidates/" + item.id + "/post", { method: "POST" });
          await refresh();
        } catch (error) { showError(error.message); }
      };
      const rowChildren = [reply];
      if (!state.data.xWriteConnected.connected) {
        rowChildren.push(node("span", { className: "muted", textContent: "Connect an X account above to enable this." }));
      }
      card.append(node("div", { className: "row" }, rowChildren));
    }

    const reject = node("button", { className: "danger", textContent: "Reject" });
    reject.onclick = async () => {
      showError("");
      try {
        await api("/portal/api/candidates/" + item.id + "/reject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.value, note: note.value })
        });
        await refresh();
      } catch (error) { showError(error.message); }
    };

    card.append(node("div", { className: "row" }, [reason, note, reject]));
    container.append(card);
  }
}

function describeDiagnostics(diagnostics) {
  if (!diagnostics) return null;
  const { screening, classification, rewrite } = diagnostics;
  const confidence = (value) => (typeof value === "number" ? value.toFixed(2) : "unknown");
  if (screening && screening.eligible === false) {
    return "screening: " + screening.reason;
  }
  if (classification && classification.eligible === false) {
    return "classification: " + classification.reason + " (confidence " + confidence(classification.languageConfidence) + ", risk " + (classification.riskClass ?? "unknown") + ")";
  }
  if (rewrite && rewrite.eligible === false) {
    return "rewrite: " + rewrite.reason + (rewrite.factsChanged ? " (" + rewrite.factsChanged + ")" : "");
  }
  if (classification && classification.eligible === true) {
    return "classification: " + classification.category + "/" + classification.riskClass + " (confidence " + confidence(classification.languageConfidence) + ")";
  }
  return null;
}

function renderActivity(activity) {
  const container = el("activity");
  container.replaceChildren();
  if (activity.length === 0) container.append(emptyState("No tracked creator has posted anything yet."));
  for (const item of activity) {
    const card = node("div", { className: "card" });
    const statePill = item.state === "queued" || item.state === "posted" ? "pill go" : item.state === "skipped" || item.state === "failed" ? "pill stop" : "pill";
    card.append(node("div", { className: "row" }, [
      ...(item.canonicalCategory ? [node("span", { className: "pill", textContent: item.canonicalCategory })] : []),
      node("span", { className: statePill, textContent: item.state }),
      node("span", { className: "muted tabular", textContent: "discovered " + item.discoveredAt })
    ]));
    card.append(node("p", { className: "muted", textContent: "@" + (item.creatorHandle ?? "unknown") }));
    const details = [item.sourceUrl];
    if (item.candidateState) details.push("candidate " + item.candidateState);
    const diagnosticsLine = describeDiagnostics(item.diagnostics);
    if (diagnosticsLine) details.push(diagnosticsLine);
    card.append(node("p", { className: "muted", textContent: details.join(" · ") }));
    card.append(node("blockquote", { textContent: item.originalText ?? "(text purged)" }));
    container.append(card);
  }
}

function chip(box, label) {
  return node("label", { className: "chip" }, [box, node("span", { textContent: label })]);
}

function field(labelText, input) {
  return node("div", {}, [node("label", { textContent: labelText }), input]);
}

// The posting window only ever stores whole hours (validateSettings
// rejects fractional ones), so an <input type="time"> here only needs
// to round-trip HH:00 — the step=3600 attribute keeps the native
// picker on hour boundaries.
function hourToTime(hour) {
  return String(Math.min(hour, 23)).padStart(2, "0") + ":00";
}
function timeToHour(value) {
  return Number(String(value).split(":")[0]);
}

function renderSettings(settings, schema, settingsVersion) {
  const container = el("settings");
  container.replaceChildren();
  const categories = node("div", { className: "chip-row" });
  for (const category of schema.canonicalCategories) {
    const box = node("input", { type: "checkbox", checked: settings.enabledCategories.includes(category), id: "cat-" + category });
    categories.append(chip(box, category));
  }
  const topics = node("div", { className: "chip-row" });
  for (const topic of schema.excludedTopics) {
    const box = node("input", { type: "checkbox", checked: settings.excludedTopics.includes(topic), id: "topic-" + topic });
    topics.append(chip(box, topic));
  }
  const cap = node("input", { type: "number", value: settings.dailyPostedCap, min: 0, max: 10 });
  const weightA = node("input", { type: "number", value: settings.templateWeights.A, min: 0, max: 100 });
  const weightB = node("input", { type: "number", value: settings.templateWeights.B, min: 0, max: 100 });
  const windowStart = node("input", { type: "time", value: hourToTime(settings.postingWindow.startHour), step: 3600 });
  const windowEnd = node("input", { type: "time", value: hourToTime(settings.postingWindow.endHour), step: 3600 });
  const budget = node("input", { type: "number", value: settings.monthlyXBudgetUsd, min: 1, max: 100 });
  const cooldown = node("input", { type: "number", value: settings.creatorCooldownDays, min: 7 });
  const maxAge = node("input", { type: "number", value: settings.maxSourceAgeHours, min: 1, max: 12 });
  const batch = node("input", { type: "number", value: settings.scanBatchSize, min: 1, max: 25 });
  const enabled = node("input", { type: "checkbox", checked: settings.enabled });
  const save = node("button", { textContent: "Save settings" });
  save.onclick = async () => {
    showError("");
    const enabledCategories = schema.canonicalCategories.filter((category) => el("cat-" + category).checked);
    const excludedTopics = schema.excludedTopics.filter((topic) => el("topic-" + topic).checked);
    try {
      await api("/portal/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseVersion: settingsVersion,
          patch: {
            enabledCategories,
            excludedTopics,
            dailyPostedCap: Number(cap.value),
            templateWeights: { A: Number(weightA.value), B: Number(weightB.value) },
            postingWindow: { timezone: "America/Los_Angeles", startHour: timeToHour(windowStart.value), endHour: timeToHour(windowEnd.value) },
            monthlyXBudgetUsd: Number(budget.value),
            creatorCooldownDays: Number(cooldown.value),
            maxSourceAgeHours: Number(maxAge.value),
            scanBatchSize: Number(batch.value),
            enabled: enabled.checked,
            pauseReason: enabled.checked ? null : "manual_kill_switch"
          }
        })
      });
      await refresh();
    } catch (error) {
      // The save was rejected, so nothing changed server-side — the toggle
      // (and every other control) must not keep showing what was clicked,
      // or the operator has no way to tell a save actually failed.
      enabled.checked = settings.enabled;
      const missing = Array.isArray(error.body?.missing) && error.body.missing.length > 0
        ? " (" + error.body.missing.join(" ") + ")"
        : "";
      showError(error.message + missing);
    }
  };
  container.append(node("div", { className: "settings-master" }, [
    node("strong", { textContent: "Campaign status" }),
    node("label", { className: "toggle" }, [enabled, node("span", { className: "track" }), text("Campaign enabled")])
  ]));

  const grid = node("div", { className: "settings-grid" });
  grid.append(node("div", { className: "settings-group" }, [
    node("h3", { textContent: "Content categories" }),
    node("p", { className: "muted", textContent: "Clarity is off by default." }),
    categories
  ]));
  grid.append(node("div", { className: "settings-group" }, [
    node("h3", { textContent: "Excluded topics" }),
    node("p", { className: "muted", textContent: "Highlighted topics always skip." }),
    topics
  ]));
  grid.append(node("div", { className: "settings-group" }, [
    node("h3", { textContent: "Posting limits" }),
    node("div", { className: "field-grid" }, [
      field("Daily cap", cap),
      field("Window start (Pacific)", windowStart),
      field("Window end (Pacific)", windowEnd),
      field("Monthly X budget USD", budget),
      field("Creator cooldown days", cooldown),
      field("Max source age hours", maxAge),
      field("Scan batch", batch)
    ])
  ]));
  grid.append(node("div", { className: "settings-group" }, [
    node("h3", { textContent: "Experiment weights" }),
    node("p", { className: "muted", textContent: "The % split between the two reply wordings below." }),
    node("blockquote", { textContent: "A: " + (schema.templateVariants?.A ?? "") }),
    node("blockquote", { textContent: "B: " + (schema.templateVariants?.B ?? "") }),
    node("div", { className: "field-grid" }, [
      field("Template A %", weightA),
      field("Template B %", weightB)
    ])
  ]));
  container.append(grid);
  container.append(node("div", { className: "row", style: "margin-top: 14px" }, [save]));
}

function renderTable(target, rows, columns) {
  const table = el(target);
  table.replaceChildren();
  const head = node("tr");
  for (const column of columns) head.append(node("th", { textContent: column }));
  table.append(head);
  for (const row of rows) {
    const tr = node("tr");
    for (const column of columns) tr.append(node("td", { textContent: String(row[column] ?? "") }));
    table.append(tr);
  }
}

function renderCreators(creators) {
  const table = el("creators");
  table.replaceChildren();
  const columns = ["handle", "xUserId", "status", "lastPostedAt"];
  const head = node("tr");
  for (const column of columns) head.append(node("th", { textContent: column }));
  head.append(node("th"));
  table.append(head);
  for (const row of creators) {
    const tr = node("tr");
    for (const column of columns) tr.append(node("td", { textContent: String(row[column] ?? "") }));
    const remove = node("button", {
      className: "danger",
      title: "Remove from tracking",
      textContent: "×",
      disabled: row.status === "removed"
    });
    remove.onclick = async () => {
      showError("");
      try {
        await api("/portal/api/creators/remove", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ xUserId: row.xUserId })
        });
        await refresh();
      } catch (error) { showError(error.message); }
    };
    tr.append(node("td", {}, [remove]));
    table.append(tr);
  }
}

function renderExperiments(experiments) {
  const container = el("experiments");
  container.replaceChildren();
  for (const [variant, arm] of Object.entries(experiments.arms)) {
    container.append(node("p", {
      textContent: variant + ": posted " + arm.posted + ", rejected " + arm.rejected +
        ", positive engagement " + arm.positiveEngagement +
        ", rate " + (arm.positiveEngagementRate ?? "n/a") +
        ", objections " + arm.objections + ", deletions " + arm.deletions
    }));
  }
  for (const warning of experiments.warnings) container.append(node("p", { className: "muted", textContent: warning }));
  container.append(node("p", { className: "muted", textContent: experiments.attributionNote }));
  container.append(node("p", { className: "muted", textContent: "Tracked profile link: " + experiments.profileLink }));
  for (const step of experiments.conversionFunnel) {
    container.append(node("p", { className: "muted", textContent: step.step + ". " + step.event + " — " + step.description }));
  }
}

function renderOperations(operations) {
  const container = el("operations");
  container.replaceChildren();
  container.append(node("p", { textContent: "Pause reason: " + (operations.pauseReason ?? "none") }));
  container.append(node("p", {
    className: "tabular",
    textContent: "X spend " + operations.xSpend.estimatedUsd + " / " + operations.xSpend.monthlyBudgetUsd +
      " USD (" + operations.xSpend.reads + " reads this month)"
  }));
  const outbox = operations.outbox;
  for (const destination of ["posthog", "slack"]) {
    const stats = (outbox.byDestination ?? {})[destination] ?? { pending: 0, delivered: 0, failed: 0 };
    container.append(node("p", {
      className: "tabular",
      textContent: destination + " delivery: pending " + stats.pending + ", delivered " + stats.delivered + ", failed " + stats.failed
    }));
  }

  container.append(node("p", { textContent: "Failed jobs: " + operations.failedJobs.length }));
  for (const job of operations.failedJobs) {
    container.append(node("p", {
      className: "muted",
      textContent: job.kind + " · attempts " + job.attemptCount + " · " + (job.failureSignature ?? "unknown") + " · " + job.id
    }));
  }

  container.append(node("p", { textContent: "Objection deletion queue: " + operations.objectionQueue.length }));
  for (const item of operations.objectionQueue) {
    const card = node("div", { className: "card" });
    card.append(node("p", { textContent: (item.stateReason ?? "objection") + " · " + (item.replyUrl ?? "no reply URL") }));
    const confirm = node("button", { className: "danger", textContent: "I deleted this reply in X" });
    confirm.onclick = async () => {
      showError("");
      try {
        await api("/portal/api/candidates/" + item.id + "/deletion-confirmed", { method: "POST" });
        await refresh();
      } catch (error) { showError(error.message); }
    };
    card.append(node("div", { className: "row" }, [confirm]));
    container.append(card);
  }

  const objectionCandidate = node("input", { placeholder: "candidate ID" });
  const objectionClass = node("select");
  for (const value of state.data.settingsSchema.objectionClasses) {
    objectionClass.append(node("option", { value, textContent: value }));
  }
  const recordObjection = node("button", { className: "danger", textContent: "Record creator objection" });
  recordObjection.onclick = async () => {
    showError("");
    try {
      await api("/portal/api/candidates/" + objectionCandidate.value.trim() + "/objection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objectionClass: objectionClass.value })
      });
      await refresh();
    } catch (error) { showError(error.message); }
  };
  container.append(node("p", { className: "muted", textContent: "Objection: permanently blocklists the creator and pauses after two in 24h." }));
  container.append(node("div", { className: "row" }, [objectionCandidate, objectionClass, recordObjection]));
}

async function refresh() {
  const data = await api("/portal/api/state");
  state.data = data;
  el("signin").hidden = true;
  el("app").hidden = false;
  el("operator").textContent = data.operator;
  el("campaign-state").textContent = data.settings.enabled ? "enabled" : "disabled";
  el("campaign-state").className = data.settings.enabled ? "pill go" : "pill stop";
  el("cap").textContent = data.operations.postedToday + " / " + data.operations.dailyPostedCap + " verified replies today (Pacific)";
  const pauseSelect = el("pause-reason");
  pauseSelect.replaceChildren();
  for (const value of data.settingsSchema.pauseReasons) {
    pauseSelect.append(node("option", { value, textContent: value }));
  }
  el("prereqs").textContent = data.operations.missingPrerequisites.join(" ");
  el("x-write-status").textContent = data.xWriteConnected.connected
    ? "Posting as @" + data.xWriteConnected.handle
    : "No X account connected -- Reply is disabled until one is.";
  el("x-write-connect").textContent = data.xWriteConnected.connected ? "Reconnect X account" : "Connect X account";
  renderQueue(data.queue);
  renderActivity(data.activity);
  renderSettings(data.settings, data.settingsSchema, data.settingsVersion);
  renderCreators(data.creators);
  renderExperiments(data.experiments);
  renderOperations(data.operations);
  renderTable("audit", data.audit, ["created_at", "actor", "action", "subject_type", "subject_id"]);
}

el("signout").onclick = async () => {
  await api("/portal/api/signout", { method: "POST" });
  location.reload();
};
el("pause").onclick = async () => {
  showError("");
  const reasons = state.data ? state.data.settingsSchema.pauseReasons : ["manual_kill_switch"];
  const reason = el("pause-reason") ? el("pause-reason").value : "manual_kill_switch";
  try {
    await api("/portal/api/campaign/pause", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reasons.includes(reason) ? reason : "manual_kill_switch" })
    });
    await refresh();
  } catch (error) { showError(error.message); }
};
el("creator-add").onclick = async () => {
  showError("");
  try {
    await api("/portal/api/creators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: el("creator-handle").value })
    });
    await refresh();
  } catch (error) { showError(error.message); }
};
el("creator-block").onclick = async () => {
  showError("");
  try {
    await api("/portal/api/creators/block", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: el("creator-handle").value })
    });
    await refresh();
  } catch (error) { showError(error.message); }
};
el("clear-activity").onclick = async () => {
  showError("");
  if (!confirm("Clear every scanned post and queued reply? This cannot be undone.")) return;
  try {
    await api("/portal/api/activity/clear", { method: "POST" });
    await refresh();
  } catch (error) { showError(error.message); }
};

el("x-write-connect").onclick = () => {
  window.location.href = "/portal/api/oauth/x/start";
};

const xConnectParams = new URLSearchParams(window.location.search);
if (xConnectParams.has("xConnected")) showError("");
if (xConnectParams.has("xConnectError")) showError("Connecting the X account failed: " + xConnectParams.get("xConnectError"));
if (xConnectParams.has("xConnected") || xConnectParams.has("xConnectError")) {
  window.history.replaceState(null, "", "/portal");
}

refresh().catch(() => {
  el("signin-hint").textContent = "Not signed in yet.";
});
</script>
</body>
</html>`;
}
