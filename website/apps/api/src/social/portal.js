import { decryptJson, encryptJson } from "../crypto.js";
import { loadSocialConfig, describeMissingPrerequisites } from "./config.js";
import { loadCampaignSettings, pauseCampaign, recordCreatorObjection } from "./campaign.js";
import {
  CANONICAL_CATEGORIES,
  EXCLUDED_TOPICS,
  DEFAULT_SETTINGS,
  OBJECTION_CLASSES,
  PAUSE_REASONS,
  REJECTION_REASONS,
  TEMPLATE_VARIANTS,
  mergeSettings,
  SettingsError
} from "./settings.js";
import { creatorBucket, pacificDateKey } from "./identity.js";
import { recordXReads } from "./scanner.js";
import { buildComposerUrl, composerGate } from "./composer.js";
import { isProtocolDeviation, verifyPostedReply } from "./verification.js";
import { enqueuePostHogEvent } from "./outbox.js";
import { summarizeExperiment, campaignProfileLink, CONVERSION_FUNNEL } from "./engagement.js";
import { BlocklistViolationError, OPEN_CANDIDATE_STATES } from "./store.js";
import { XRequestError } from "./x-read-only.js";
import {
  createSessionToken,
  createOAuthStateToken,
  parseCookies,
  PortalAuthError,
  readSessionToken,
  readOAuthStateToken,
  verifyGoogleIdToken
} from "./google-auth.js";
import {
  buildAuthorizeUrl,
  codeChallengeFromVerifier,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  XOAuthError
} from "./x-oauth.js";
import { createWriteXClient, getValidAccessToken, XReconnectRequiredError, XWriteError } from "./x-write.js";
import { PORTAL_PAGE } from "./portal-page.js";

const X_OAUTH_STATE_COOKIE = "emapthyai_x_oauth_state";
const X_WRITE_SCOPES = ["tweet.write", "tweet.read", "users.read", "offline.access"];

const SESSION_COOKIE = "emapthyai_portal_session";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function sessionCookie(value, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${value}; Path=/portal; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function oauthStateCookie(value, maxAgeSeconds) {
  return `${X_OAUTH_STATE_COOKIE}=${value}; Path=/portal; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function safeText(candidateText) {
  return typeof candidateText === "string" ? candidateText : null;
}

export function createPortalHandler(env = process.env, dependencies = {}) {
  const config = dependencies.config ?? loadSocialConfig(env);
  const store = dependencies.store ?? null;
  const encryptionKey = dependencies.encryptionKey ?? null;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const createXClient = dependencies.createXClient ?? null;
  const now = dependencies.now ?? (() => new Date());
  const log = dependencies.log ?? console.error;

  // The operator only ever types a handle; X's own API requires the numeric
  // ID for every other read (tweets, cooldowns, blocklist), and handles can
  // be renamed while the ID can't, so this is the one place that ID gets
  // resolved instead of asking the operator to look it up themselves.
  // Returns either { ok: true, xUserId, handle } or { ok: false, response }
  // (an already-built json() Response) so callers can just `return` it.
  async function resolveCreatorHandle(handle, { settings }) {
    if (!/^[A-Za-z0-9_]{1,15}$/.test(String(handle ?? ""))) {
      return { ok: false, response: json(400, { error: "invalid_creator", message: "handle must be an X handle without @." }) };
    }
    if (!createXClient) {
      return { ok: false, response: json(503, { error: "social_not_configured", message: "X_READ_BEARER_TOKEN is not configured." }) };
    }
    let user;
    try {
      user = await createXClient().getUserByUsername(String(handle));
    } catch (error) {
      await recordXReads({ store, config, settings, reads: 0, now: now() });
      if (error instanceof XRequestError && error.status === 404) {
        return { ok: false, response: json(404, { error: "creator_not_found", message: `No X account found for handle "${handle}".` }) };
      }
      if (error instanceof XRequestError) {
        return { ok: false, response: json(502, { error: error.code, message: error.message }) };
      }
      throw error;
    }
    await recordXReads({ store, config, settings, reads: 1, now: now() });
    if (!user?.data?.id) {
      return { ok: false, response: json(404, { error: "creator_not_found", message: `No X account found for handle "${handle}".` }) };
    }
    return { ok: true, xUserId: user.data.id, handle: user.data.username };
  }

  function decryptOrNull(cipher) {
    if (!cipher?.ciphertext) return null;
    try {
      return decryptJson(encryptionKey, cipher);
    } catch (error) {
      log("[social-portal] decrypt failed", { message: error.message });
      return null;
    }
  }

  // The one write-capable X client in this whole application. Only ever
  // constructed here, only ever used by the /post candidate action -- never
  // confused with the read-only client built from X_READ_BEARER_TOKEN.
  function createWriteClient(credentialRow) {
    return createWriteXClient({
      fetchImpl,
      getAccessToken: () =>
        getValidAccessToken(credentialRow, {
          clientId: config.xOAuth.clientId,
          clientSecret: config.xOAuth.clientSecret,
          encryptionKey,
          store,
          fetchImpl,
          now
        })
    });
  }

  async function requireOperator(request) {
    const cookies = parseCookies(request.headers.get("cookie"));
    const session = readSessionToken({
      token: cookies[SESSION_COOKIE],
      key: encryptionKey,
      allowedEmails: config.portal.allowedEmails,
      now: now().getTime()
    });
    if (!session) throw new PortalAuthError("unauthorized", "Sign in with an allowlisted EmapthyAi Google account.");
    return session;
  }

  async function buildQueue(settings) {
    const candidates = await store.listCandidatesByState(OPEN_CANDIDATE_STATES, 100);
    const rows = [];
    for (const candidate of candidates) {
      const sourcePost = await store.getSourcePost(candidate.source_post_id);
      const creator = await store.getCreator(candidate.x_user_id);
      const source = decryptOrNull({
        ciphertext: sourcePost?.text_ciphertext,
        iv: sourcePost?.text_iv,
        tag: sourcePost?.text_tag
      });
      const reply = decryptOrNull({
        ciphertext: candidate.reply_ciphertext,
        iv: candidate.reply_iv,
        tag: candidate.reply_tag
      });
      const current = now();
      rows.push({
        id: candidate.id,
        state: candidate.state,
        // The variant label stays out of the operator view on purpose so
        // rejections cannot be biased by which template was drawn.
        canonicalCategory: candidate.canonical_category,
        creatorHandle: creator?.handle ?? null,
        creatorCooldownUntil: creator?.last_posted_at
          ? new Date(new Date(creator.last_posted_at).getTime() + settings.creatorCooldownDays * 86_400_000).toISOString()
          : null,
        sourceUrl: sourcePost ? `https://x.com/i/status/${sourcePost.x_post_id}` : null,
        sourceAgeMinutes: sourcePost
          ? Math.round((current.getTime() - new Date(sourcePost.posted_at).getTime()) / 60_000)
          : null,
        expiresAt: new Date(candidate.expires_at).toISOString(),
        expired: new Date(candidate.expires_at).getTime() <= current.getTime(),
        riskClass: sourcePost?.risk_class ?? null,
        skipReason: sourcePost?.skip_reason ?? null,
        originalText: safeText(source?.text),
        replyText: safeText(reply?.replyText)
      });
    }
    return rows;
  }

  async function buildActivity() {
    const posts = await store.listSourcePostsRecent({ limit: 100 });
    const rows = [];
    for (const post of posts) {
      const creator = await store.getCreator(post.x_user_id);
      const candidate = post.state === "queued" ? await store.getCandidateBySourcePost(post.id) : null;
      const source = decryptOrNull({ ciphertext: post.text_ciphertext, iv: post.text_iv, tag: post.text_tag });
      rows.push({
        id: post.id,
        creatorHandle: creator?.handle ?? null,
        sourceUrl: `https://x.com/i/status/${post.x_post_id}`,
        discoveredAt: post.discovered_at,
        state: post.state,
        candidateState: candidate?.state ?? null,
        skipReason: post.skip_reason,
        canonicalCategory: post.canonical_category,
        riskClass: post.risk_class,
        diagnostics: post.diagnostics ?? null,
        originalText: safeText(source?.text)
      });
    }
    return rows;
  }

  async function buildExperiments() {
    const candidates = await store.listCandidatesByState(
      ["queued", "composer_opened", "posted_pending_verification", "posted", "rejected", "deleted", "deletion_required"],
      500
    );
    const snapshotsByCandidate = {};
    const objectionsByVariant = { A: 0, B: 0 };
    for (const candidate of candidates) {
      snapshotsByCandidate[candidate.id] = await store.listMetricsSnapshots(candidate.id);
      if (candidate.state === "deletion_required" || candidate.state === "deleted") {
        objectionsByVariant[candidate.template_variant] = (objectionsByVariant[candidate.template_variant] ?? 0) + 1;
      }
    }
    return {
      ...summarizeExperiment({ candidates, snapshotsByCandidate, objectionsByVariant }),
      profileLink: campaignProfileLink({ campaignId: config.campaignId }),
      conversionFunnel: CONVERSION_FUNNEL,
      attributionNote:
        "Replies contain no link. Installs are attributed to the campaign as a whole, never to a single template."
    };
  }

  // Never return the token ciphertext to the browser -- only enough to show
  // which account (if any) is connected.
  async function buildXWriteConnected() {
    const credential = await store.getActiveXWriteCredential();
    if (!credential) return { connected: false };
    return { connected: true, handle: credential.handle, xUserId: credential.x_user_id };
  }

  async function buildOperations(settings) {
    const current = now();
    const month = current.toISOString().slice(0, 7);
    const spend = await store.getXSpend(month);
    // Raw rows stay server-side: template_variant would bias pending operator
    // actions and ciphertext blobs have no business in the browser.
    const failedJobs = (await store.listFailedJobs(25)).map((job) => ({
      id: job.id,
      kind: job.kind,
      attemptCount: job.attempt_count,
      failureSignature: job.failure_signature,
      updatedAt: job.updated_at
    }));
    const objectionQueue = (await store.listCandidatesByState(["deletion_required"], 50)).map((candidate) => ({
      id: candidate.id,
      state: candidate.state,
      stateReason: candidate.state_reason,
      replyUrl: candidate.reply_url,
      postedAt: candidate.posted_at,
      expiresAt: candidate.expires_at
    }));
    return {
      enabled: settings.enabled,
      pauseReason: settings.pauseReason,
      postedToday: await store.countPostedOnPacificDate(pacificDateKey(current)),
      dailyPostedCap: settings.dailyPostedCap,
      xSpend: {
        month,
        reads: spend.reads,
        estimatedUsd: Number((spend.estimated_micros / 1_000_000).toFixed(4)),
        monthlyBudgetUsd: settings.monthlyXBudgetUsd
      },
      failedJobs,
      outbox: await store.outboxStats(),
      objectionQueue,
      missingPrerequisites: describeMissingPrerequisites(config),
      configured: config.configured
    };
  }

  async function handleApi(request, url) {
    if (request.method === "POST" && url.pathname === "/portal/api/session") {
      const body = await request.json().catch(() => ({}));
      const identity = await verifyGoogleIdToken({
        idToken: body.credential,
        clientId: config.portal.googleClientId,
        allowedEmails: config.portal.allowedEmails,
        fetchImpl,
        now: () => now().getTime()
      });
      const token = createSessionToken({
        email: identity.email,
        key: encryptionKey,
        ttlMs: config.portal.sessionTtlMs,
        now: now().getTime()
      });
      await store.appendAudit({ actor: identity.email, action: "portal_signed_in" });
      return json(200, { email: identity.email }, {
        "set-cookie": sessionCookie(token, Math.floor(config.portal.sessionTtlMs / 1000))
      });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/signout") {
      return json(200, { ok: true }, { "set-cookie": sessionCookie("", 0) });
    }

    const operator = await requireOperator(request);
    const { version: settingsVersion, settings } = await loadCampaignSettings(store, { actor: operator.email });

    if (request.method === "GET" && url.pathname === "/portal/api/state") {
      return json(200, {
        operator: operator.email,
        settings,
        settingsVersion,
        settingsSchema: {
          canonicalCategories: CANONICAL_CATEGORIES,
          excludedTopics: EXCLUDED_TOPICS,
          rejectionReasons: REJECTION_REASONS,
          objectionClasses: OBJECTION_CLASSES,
          pauseReasons: PAUSE_REASONS,
          templateVariants: TEMPLATE_VARIANTS,
          defaults: DEFAULT_SETTINGS
        },
        queue: await buildQueue(settings),
        activity: await buildActivity(),
        creators: (await store.listCreators()).map((creator) => ({
          xUserId: creator.x_user_id,
          handle: creator.handle,
          status: creator.status,
          notes: creator.notes,
          lastScannedAt: creator.last_scanned_at,
          lastPostedAt: creator.last_posted_at
        })),
        experiments: await buildExperiments(),
        operations: await buildOperations(settings),
        audit: await store.listAudit(50),
        xWriteConnected: await buildXWriteConnected()
      });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/settings") {
      const body = await request.json().catch(() => ({}));
      if (body.baseVersion != null && Number(body.baseVersion) !== settingsVersion) {
        return json(409, {
          error: "settings_conflict",
          message: "Another operator changed the settings first. Reload and retry.",
          currentVersion: settingsVersion
        });
      }
      let next;
      try {
        next = mergeSettings(settings, body.patch ?? {});
      } catch (error) {
        if (error instanceof SettingsError) return json(400, { error: error.code, message: error.message });
        throw error;
      }
      if (next.enabled && !config.configured) {
        return json(409, {
          error: "social_not_configured",
          message: "The campaign cannot be enabled until every prerequisite is configured.",
          missing: describeMissingPrerequisites(config)
        });
      }
      const saved = await store.saveSettings({ settings: next, changedBy: operator.email, reason: body.reason ?? null });
      await store.appendAudit({
        actor: operator.email,
        action: "campaign_settings_updated",
        subjectType: "campaign_settings",
        subjectId: String(saved.version),
        previousValue: settings,
        nextValue: next
      });
      return json(200, { version: saved.version, settings: next });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/creators") {
      const body = await request.json().catch(() => ({}));
      const resolved = await resolveCreatorHandle(body.handle, { settings });
      if (!resolved.ok) return resolved.response;
      try {
        const previous = await store.getCreator(resolved.xUserId);
        const creator = await store.upsertCreator({
          xUserId: resolved.xUserId,
          handle: resolved.handle,
          notes: body.notes ?? null,
          addedBy: operator.email
        });
        await store.appendAudit({
          actor: operator.email,
          action: "creator_allowlisted",
          subjectType: "creator",
          subjectId: creator.x_user_id,
          previousValue: previous ? { handle: previous.handle, status: previous.status, notes: previous.notes } : null,
          nextValue: { handle: creator.handle, status: creator.status }
        });
        return json(200, { creator: { xUserId: creator.x_user_id, handle: creator.handle, status: creator.status } });
      } catch (error) {
        if (error instanceof BlocklistViolationError) {
          return json(409, { error: error.code, message: error.message });
        }
        throw error;
      }
    }

    if (request.method === "POST" && url.pathname === "/portal/api/creators/block") {
      const body = await request.json().catch(() => ({}));
      const resolved = await resolveCreatorHandle(body.handle, { settings });
      if (!resolved.ok) return resolved.response;
      const previous = await store.getCreator(resolved.xUserId);
      const creator = await store.blockCreator({
        xUserId: resolved.xUserId,
        handle: resolved.handle,
        notes: body.notes ?? null,
        blockedBy: operator.email
      });
      await store.appendAudit({
        actor: operator.email,
        action: "creator_blocked",
        subjectType: "creator",
        subjectId: creator.x_user_id,
        previousValue: previous ? { status: previous.status } : null,
        nextValue: { status: "blocked" }
      });
      return json(200, { creator: { xUserId: creator.x_user_id, handle: creator.handle, status: creator.status } });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/creators/remove") {
      const body = await request.json().catch(() => ({}));
      const xUserId = String(body.xUserId ?? "");
      const previous = await store.getCreator(xUserId);
      if (!previous) return json(404, { error: "creator_not_found", message: `No tracked creator with ID ${xUserId}.` });
      const creator = await store.removeCreator({ xUserId });
      await store.appendAudit({
        actor: operator.email,
        action: "creator_removed",
        subjectType: "creator",
        subjectId: creator.x_user_id,
        previousValue: { status: previous.status },
        nextValue: { status: "removed" }
      });
      return json(200, { creator: { xUserId: creator.x_user_id, handle: creator.handle, status: creator.status } });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/activity/clear") {
      const cleared = await store.clearActivityAndQueue();
      await store.appendAudit({
        actor: operator.email,
        action: "activity_and_queue_cleared",
        subjectType: "campaign",
        subjectId: null,
        previousValue: cleared,
        nextValue: null
      });
      return json(200, { cleared });
    }

    if (request.method === "POST" && url.pathname === "/portal/api/campaign/pause") {
      const body = await request.json().catch(() => ({}));
      const reason = body.reason ?? "manual_kill_switch";
      if (!PAUSE_REASONS.includes(reason)) {
        return json(400, { error: "invalid_pause_reason", allowed: PAUSE_REASONS });
      }
      const paused = await pauseCampaign({
        store,
        config,
        actor: operator.email,
        reason
      });
      return json(200, { paused: paused.paused, settings: paused.settings });
    }

    if (request.method === "GET" && url.pathname === "/portal/api/oauth/x/start") {
      if (!config.xOAuth.clientId || !config.xOAuth.redirectUri) {
        return json(503, { error: "x_oauth_not_configured", message: "X_OAUTH_CLIENT_ID and X_OAUTH_REDIRECT_URI are not set." });
      }
      const codeVerifier = generateCodeVerifier();
      const state = generateState();
      const stateToken = createOAuthStateToken({
        state,
        codeVerifier,
        key: encryptionKey,
        ttlMs: 10 * 60 * 1000,
        now: now().getTime()
      });
      const authorizeUrl = buildAuthorizeUrl({
        clientId: config.xOAuth.clientId,
        redirectUri: config.xOAuth.redirectUri,
        state,
        codeChallenge: codeChallengeFromVerifier(codeVerifier),
        scopes: X_WRITE_SCOPES
      });
      return new Response(null, {
        status: 302,
        headers: { location: authorizeUrl, "set-cookie": oauthStateCookie(stateToken, 600) }
      });
    }

    if (request.method === "GET" && url.pathname === "/portal/api/oauth/x/callback") {
      const clearStateCookie = oauthStateCookie("", 0);
      if (url.searchParams.get("error")) {
        return new Response(null, { status: 302, headers: { location: "/portal?xConnectError=denied", "set-cookie": clearStateCookie } });
      }
      const cookies = parseCookies(request.headers.get("cookie"));
      const pending = readOAuthStateToken({ token: cookies[X_OAUTH_STATE_COOKIE], key: encryptionKey, now: now().getTime() });
      const returnedState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!pending || !code || pending.state !== returnedState) {
        return new Response(null, { status: 302, headers: { location: "/portal?xConnectError=invalid_state", "set-cookie": clearStateCookie } });
      }
      try {
        const tokens = await exchangeCodeForTokens({
          code,
          codeVerifier: pending.codeVerifier,
          redirectUri: config.xOAuth.redirectUri,
          clientId: config.xOAuth.clientId,
          clientSecret: config.xOAuth.clientSecret,
          fetchImpl
        });
        const identity = await fetchImpl("https://api.x.com/2/users/me", {
          headers: { authorization: `Bearer ${tokens.accessToken}` }
        }).then((response) => response.json());
        const expiresAt = new Date(now().getTime() + tokens.expiresIn * 1000);
        await store.saveXWriteCredential({
          xUserId: identity.data.id,
          handle: identity.data.username,
          accessToken: encryptJson(encryptionKey, tokens.accessToken),
          accessTokenExpiresAt: expiresAt,
          refreshToken: encryptJson(encryptionKey, tokens.refreshToken),
          scopes: tokens.scope ?? X_WRITE_SCOPES.join(" "),
          connectedBy: operator.email
        });
        await store.appendAudit({
          actor: operator.email,
          action: "x_write_account_connected",
          subjectType: "x_write_credential",
          subjectId: identity.data.id,
          nextValue: { handle: identity.data.username }
        });
        return new Response(null, {
          status: 302,
          headers: { location: `/portal?xConnected=${encodeURIComponent(identity.data.username)}`, "set-cookie": clearStateCookie }
        });
      } catch (error) {
        if (error instanceof XOAuthError) {
          log("[social-portal] X OAuth exchange failed", { code: error.code, message: error.message });
          return new Response(null, { status: 302, headers: { location: "/portal?xConnectError=exchange_failed", "set-cookie": clearStateCookie } });
        }
        throw error;
      }
    }

    const candidateMatch = /^\/portal\/api\/candidates\/([0-9a-fA-F-]{36})\/(composer|reject|verify|objection|deletion-confirmed|post)$/.exec(
      url.pathname
    );
    if (candidateMatch && request.method === "POST") {
      return handleCandidateAction({
        action: candidateMatch[2],
        candidateId: candidateMatch[1],
        request,
        operator,
        settings
      });
    }

    return json(404, { error: "not_found" });
  }

  async function handleCandidateAction({ action, candidateId, request, operator, settings }) {
    const body = await request.json().catch(() => ({}));
    const candidate = await store.getCandidate(candidateId);
    if (!candidate) return json(404, { error: "not_found" });
    const sourcePost = await store.getSourcePost(candidate.source_post_id);
    const creator = await store.getCreator(candidate.x_user_id);
    const current = now();

    if (action === "reject") {
      // Only the canonical enum reaches PostHog: free-form operator text
      // could carry names or paraphrased tweet content past the redaction
      // gate. The optional note stays in the database and audit trail only.
      const reason = body.reason;
      if (!REJECTION_REASONS.includes(reason)) {
        return json(400, { error: "invalid_reason", allowed: REJECTION_REASONS });
      }
      const note = String(body.note ?? "").trim().slice(0, 200) || null;
      const stateReason = note ? `${reason}: ${note}` : reason;
      await store.updateCandidate(candidate.id, { state: "rejected", state_reason: stateReason, closed_by: operator.email });
      await store.appendAudit({
        actor: operator.email,
        action: "candidate_rejected",
        subjectType: "candidate",
        subjectId: candidate.id,
        previousValue: { state: candidate.state },
        nextValue: { state: "rejected", reason, note }
      });
      await enqueuePostHogEvent(store, {
        name: "social draft rejected",
        distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
        idempotencyKey: `rejected:${candidate.id}`,
        properties: {
          campaign: config.campaignId,
          reason,
          template_variant: candidate.template_variant,
          operator_role: "emapthyai_operator"
        }
      });
      return json(200, { state: "rejected" });
    }

    if (action === "objection") {
      const objectionClass = body.objectionClass ?? "explicit_stop";
      if (!OBJECTION_CLASSES.includes(objectionClass)) {
        return json(400, { error: "invalid_objection_class", allowed: OBJECTION_CLASSES });
      }
      const recorded = await recordCreatorObjection({
        store,
        config,
        encryptionKey,
        actor: operator.email,
        candidate,
        xUserId: candidate.x_user_id,
        objectionClass,
        now: current
      });
      return json(200, {
        recentObjectionCount: recorded.recentObjectionCount,
        campaignPaused: recorded.paused
      });
    }

    if (action === "deletion-confirmed") {
      if (candidate.state !== "deletion_required") {
        return json(409, { error: "invalid_state", message: "Only a deletion_required candidate can be confirmed deleted." });
      }
      await store.updateCandidate(candidate.id, { state: "deleted", closed_by: operator.email });
      await store.appendAudit({
        actor: operator.email,
        action: "candidate_deletion_confirmed",
        subjectType: "candidate",
        subjectId: candidate.id,
        previousValue: { state: candidate.state },
        nextValue: { state: "deleted" }
      });
      return json(200, { state: "deleted" });
    }

    if (!sourcePost) return json(409, { error: "source_unavailable" });
    const postedToday = await store.countPostedOnPacificDate(pacificDateKey(current));

    // Shared by "composer" and "post": re-read the source post live (it may
    // have been deleted or locked to replies since it was drafted) and
    // expire the candidate on a definitive block. Returns the decrypted
    // reply text on success, or null after already writing an error response.
    async function recheckSourceAndDecryptReply() {
      if (!createXClient) {
        return { ok: false, response: json(503, { error: "social_not_configured", reason: "x_client_unavailable" }) };
      }
      const xClient = createXClient();
      let live = null;
      let sourceGone = false;
      try {
        live = await xClient.getPost(sourcePost.x_post_id);
      } catch (error) {
        // Only a definitive "the post is gone" may expire the candidate. A
        // rate limit or outage is transient: report it and change nothing.
        if (error instanceof XRequestError && error.status !== 404) {
          log("[social-portal] source re-read failed", {
            candidateId: candidate.id,
            status: error.status,
            message: error.message
          });
          return { ok: false, response: json(502, { error: error.code, message: "X could not be read; the candidate is unchanged." }) };
        }
        sourceGone = true;
      }
      await recordXReads({ store, config, settings, reads: live?.data ? 1 : 0, now: current });

      const livePost = live?.data;
      const blockReason = sourceGone || !livePost || String(livePost.id) !== String(sourcePost.x_post_id)
        ? "source_unavailable"
        : livePost.reply_settings && livePost.reply_settings !== "everyone"
          ? "reply_restricted"
          : null;
      if (blockReason) {
        await store.updateCandidate(candidate.id, { state: "expired", state_reason: blockReason });
        await store.appendAudit({
          actor: operator.email,
          action: "candidate_expired",
          subjectType: "candidate",
          subjectId: candidate.id,
          previousValue: { state: candidate.state },
          nextValue: { state: "expired", reason: blockReason }
        });
        return { ok: false, response: json(409, { error: "composer_blocked", reason: blockReason }) };
      }

      const reply = decryptOrNull({
        ciphertext: candidate.reply_ciphertext,
        iv: candidate.reply_iv,
        tag: candidate.reply_tag
      });
      if (!reply?.replyText) return { ok: false, response: json(409, { error: "composer_blocked", reason: "text_purged" }) };
      return { ok: true, reply };
    }

    if (action === "composer") {
      const gate = composerGate({ candidate, sourcePost, creator, settings, postedToday, now: current });
      if (!gate.allowed) return json(409, { error: "composer_blocked", reason: gate.reason });

      const recheck = await recheckSourceAndDecryptReply();
      if (!recheck.ok) return recheck.response;
      const { reply } = recheck;

      const composerUrl = buildComposerUrl({ sourceXPostId: sourcePost.x_post_id, replyText: reply.replyText });
      await store.updateCandidate(candidate.id, {
        state: "composer_opened",
        composer_opened_at: current,
        composer_opened_by: operator.email
      });
      await store.appendAudit({
        actor: operator.email,
        action: "composer_opened",
        subjectType: "candidate",
        subjectId: candidate.id,
        previousValue: { state: candidate.state },
        nextValue: { state: "composer_opened" }
      });
      await enqueuePostHogEvent(store, {
        name: "social reply composer opened",
        distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
        idempotencyKey: `composer:${candidate.id}`,
        properties: {
          campaign: config.campaignId,
          template_variant: candidate.template_variant,
          source_age_minutes: Math.round((current.getTime() - new Date(sourcePost.posted_at).getTime()) / 60_000),
          queue_latency_minutes: Math.round((current.getTime() - new Date(candidate.created_at).getTime()) / 60_000)
        }
      });
      return json(200, { composerUrl, replyText: reply.replyText, state: "composer_opened" });
    }

    if (action === "post") {
      const gate = composerGate({ candidate, sourcePost, creator, settings, postedToday, now: current });
      if (!gate.allowed) return json(409, { error: "composer_blocked", reason: gate.reason });

      const recheck = await recheckSourceAndDecryptReply();
      if (!recheck.ok) return recheck.response;
      const { reply } = recheck;

      const credential = await store.getActiveXWriteCredential();
      if (!credential) return json(503, { error: "x_write_not_connected", message: "Connect an X account before replying automatically." });

      let posted;
      try {
        posted = await createWriteClient(credential).postReply({
          text: reply.replyText,
          inReplyToTweetId: sourcePost.x_post_id
        });
      } catch (error) {
        if (error instanceof XReconnectRequiredError) {
          return json(409, { error: error.code, message: error.message });
        }
        if (error instanceof XWriteError) {
          if (error.ambiguous) {
            // The response never arrived -- whether the tweet posted is
            // unknown. Never retry this automatically (could double-post);
            // leave a trail for a human to reconcile with the old verify flow.
            await store.updateCandidate(candidate.id, { state: "failed", state_reason: `post_ambiguous:${error.code}` });
            await store.appendAudit({
              actor: operator.email,
              action: "reply_post_ambiguous",
              subjectType: "candidate",
              subjectId: candidate.id,
              previousValue: { state: candidate.state },
              nextValue: { state: "failed", reason: error.code }
            });
            return json(502, { error: error.code, message: error.message, reconcile: true });
          }
          return json(409, { error: error.code, message: error.message });
        }
        throw error;
      }

      const postedAt = current;
      const patch = {
        state: "posted",
        reply_x_post_id: posted.id,
        reply_url: `https://x.com/i/status/${posted.id}`,
        posted_at: postedAt,
        posted_pacific_date: pacificDateKey(postedAt),
        verified_by: operator.email,
        protocol_deviation: false
      };
      await store.updateCandidate(candidate.id, patch);
      await store.markCreatorPosted({ xUserId: candidate.x_user_id, postedAt });
      await store.appendAudit({
        actor: operator.email,
        action: "reply_auto_posted",
        subjectType: "candidate",
        subjectId: candidate.id,
        previousValue: { state: candidate.state },
        nextValue: { state: "posted" }
      });
      await enqueuePostHogEvent(store, {
        name: "social reply posted",
        distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
        idempotencyKey: `posted:${candidate.id}`,
        properties: {
          campaign: config.campaignId,
          template_variant: candidate.template_variant,
          category: candidate.canonical_category,
          creator_bucket: creatorBucket(candidate.x_user_id, encryptionKey),
          reply_age_minutes: 0,
          protocol_deviation: false
        }
      });
      return json(200, { state: "posted", replyUrl: patch.reply_url, protocolDeviation: false });
    }

    if (action === "verify") {
      if (!["composer_opened", "posted_pending_verification"].includes(candidate.state)) {
        return json(409, { error: "invalid_state", message: "Open the composer before verifying a reply." });
      }
      if (postedToday >= settings.dailyPostedCap) {
        return json(409, { error: "daily_cap_reached", message: "The Pacific-day posting cap is already reached." });
      }
      if (!createXClient) return json(503, { error: "social_not_configured", reason: "x_client_unavailable" });

      await store.updateCandidate(candidate.id, { state: "posted_pending_verification" });
      let verification;
      try {
        verification = await verifyPostedReply({
          xClient: createXClient(),
          replyUrl: body.replyUrl,
          sourceXPostId: sourcePost.x_post_id,
          accountUserId: config.x.accountUserId,
          findExisting: (replyPostId) => store.findCandidateByReplyPostId(replyPostId)
        });
      } catch (error) {
        // A transient X failure must not leave the candidate stranded in
        // posted_pending_verification with no retry path.
        await store.updateCandidate(candidate.id, { state: candidate.state });
        throw error;
      }
      const lookupReturnedPost = verification.verified
        || ["reply_not_owned", "reply_not_to_source"].includes(verification.reason);
      await recordXReads({ store, config, settings, reads: lookupReturnedPost ? 1 : 0, now: current });
      if (!verification.verified) {
        await store.updateCandidate(candidate.id, { state: candidate.state });
        await store.appendAudit({
          actor: operator.email,
          action: "reply_verification_failed",
          subjectType: "candidate",
          subjectId: candidate.id,
          previousValue: { state: candidate.state },
          nextValue: { state: candidate.state, reason: verification.reason }
        });
        return json(409, { error: "verification_failed", reason: verification.reason });
      }

      // The cap must be enforced against the Pacific day the reply was
      // actually posted on, which is also the day it is recorded under —
      // otherwise a reply just after Pacific midnight is counted against the
      // empty new day but stamped onto the already-full previous one.
      const capDate = pacificDateKey(verification.postedAt);
      if (await store.countPostedOnPacificDate(capDate) >= settings.dailyPostedCap) {
        await store.updateCandidate(candidate.id, { state: candidate.state });
        await store.appendAudit({
          actor: operator.email,
          action: "reply_verification_failed",
          subjectType: "candidate",
          subjectId: candidate.id,
          previousValue: { state: candidate.state },
          nextValue: { state: candidate.state, reason: "daily_cap_reached" }
        });
        return json(409, { error: "daily_cap_reached", message: "The Pacific-day posting cap is already reached." });
      }

      const reply = decryptOrNull({
        ciphertext: candidate.reply_ciphertext,
        iv: candidate.reply_iv,
        tag: candidate.reply_tag
      });
      const deviated = reply?.replyText ? isProtocolDeviation(reply.replyText, verification.text) : false;
      const patch = {
        state: "posted",
        reply_x_post_id: verification.replyPostId,
        reply_url: verification.replyUrl,
        posted_at: verification.postedAt,
        posted_pacific_date: pacificDateKey(verification.postedAt),
        verified_by: operator.email,
        protocol_deviation: deviated
      };
      if (deviated && verification.text) {
        const cipher = encryptJson(encryptionKey, { postedText: verification.text });
        Object.assign(patch, { posted_ciphertext: cipher.ciphertext, posted_iv: cipher.iv, posted_tag: cipher.tag });
      }
      await store.updateCandidate(candidate.id, patch);
      await store.markCreatorPosted({ xUserId: candidate.x_user_id, postedAt: verification.postedAt });
      await store.appendAudit({
        actor: operator.email,
        action: "reply_verified",
        subjectType: "candidate",
        subjectId: candidate.id,
        previousValue: { state: candidate.state },
        nextValue: { state: "posted", protocolDeviation: deviated }
      });
      await enqueuePostHogEvent(store, {
        name: "social reply posted",
        distinctId: creatorBucket(candidate.x_user_id, encryptionKey),
        idempotencyKey: `posted:${candidate.id}`,
        properties: {
          campaign: config.campaignId,
          template_variant: candidate.template_variant,
          category: candidate.canonical_category,
          creator_bucket: creatorBucket(candidate.x_user_id, encryptionKey),
          reply_age_minutes: Math.max(0, Math.round((current.getTime() - verification.postedAt.getTime()) / 60_000)),
          protocol_deviation: deviated
        }
      });
      return json(200, { state: "posted", replyUrl: verification.replyUrl, protocolDeviation: deviated });
    }

    return json(404, { error: "not_found" });
  }

  return async function handlePortal(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/portal")) return json(404, { error: "not_found" });

    if (!store || !encryptionKey) {
      return json(503, {
        error: "social_not_configured",
        message: "Configure DATABASE_URL and EMPATHY_RUN_ENCRYPTION_KEY on the server.",
        missing: describeMissingPrerequisites(config)
      });
    }

    if (request.method === "GET" && (url.pathname === "/portal" || url.pathname === "/portal/")) {
      return new Response(PORTAL_PAGE(config.portal.googleClientId), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }

    try {
      return await handleApi(request, url);
    } catch (error) {
      if (error instanceof PortalAuthError) {
        const status = error.code === "unauthorized" ? 401 : error.code === "forbidden" ? 403 : 502;
        return json(status, { error: error.code, message: error.message });
      }
      if (error instanceof XRequestError) {
        log("[social-portal] X read failed", { path: url.pathname, status: error.status, message: error.message });
        return json(502, { error: error.code, message: error.message });
      }
      log("[social-portal] request failed", { path: url.pathname, message: error.message, stack: error.stack });
      return json(500, { error: "portal_failed", message: "The portal request failed." });
    }
  };
}
