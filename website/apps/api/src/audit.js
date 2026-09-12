export function redactAuditEvent({
  runId,
  personaVersion,
  provider = null,
  status,
  errorCode = null,
  attemptCount = 0,
  durationMs = 0,
  categoryLabels = null
}) {
  return {
    run_id: runId,
    persona_version: personaVersion,
    provider,
    status,
    error_code: errorCode,
    attempt_count: attemptCount,
    duration_ms: durationMs,
    category_labels: categoryLabels
  };
}

export function logRedactedAudit(event, log = console.info) {
  log(JSON.stringify({ type: "rewrite_audit", ...redactAuditEvent(event) }));
}
