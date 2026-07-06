// Spec 009B has no audit table in v1 (accepted debt — see KNOWN_ISSUES.md).
// Until one lands, every admin mutation emits ONE structured line so moderation
// actions stay traceable in the log stream. Shared by every admin mutation so
// the shape ({ actor, action, target }) never drifts between procedures.
export function logAdminAudit(
  actor: string,
  action: string,
  target: string,
): void {
  console.info(JSON.stringify({ event: "admin.audit", actor, action, target }));
}
