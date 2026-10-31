import { isStaffRoleId, staffPermissions, staffRecordMatches, validStaffAccess, validStaffRole, type StaffPermission } from '../lib/staffAccess';

interface Session { uid: string; getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> }
export interface StaffAccessDiagnostic { source: 'session-token' | 'staff-registry' | 'staff-policy'; code: string; }
export function staffAccessDiagnostic(source: StaffAccessDiagnostic['source'], error?: unknown): StaffAccessDiagnostic {
  const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : undefined;
  return { source, code: typeof code === 'string' && /^[a-z0-9_/-]{1,80}$/.test(code) ? code : 'unknown' };
}
export interface StaffAccessState { ready: boolean; assigned: boolean; issue: 'sign-in-required' | 'unavailable' | null; diagnostic?: StaffAccessDiagnostic; }
export const LOADING_STAFF_ACCESS: StaffAccessState = { ready: false, assigned: false, issue: null };
interface Dependencies {
  watchAccess(uid: string, next: (value: unknown) => void, error: (reason?: unknown) => void): () => void;
  watchRole(id: string, next: (value: unknown) => void, error: (reason?: unknown) => void): () => void;
  changed(permissions: StaffPermission[], state: StaffAccessState): void;
}

/** No authorization is published until the assigned role's first server response arrives. */
export function observeStaffAccess(user: Session, dependencies: Dependencies): () => void {
  let active = true, failed = false, claimsReady = false, accessReady = false, roleReady = false;
  let claims: Record<string, unknown> = {}, access: unknown, policy: unknown;
  let watchedRole = '', roleGeneration = 0, stopRole = () => {};
  let failure: StaffAccessDiagnostic | undefined;
  const recordFailure = (source: StaffAccessDiagnostic['source'], reason?: unknown) => {
    if (!active) return;
    const diagnostic = staffAccessDiagnostic(source, reason);
    failure ||= diagnostic;
    // Log only the operation and SDK code, never raw errors, tokens or claims.
    console.error('[GB Access]', diagnostic);
    failed = true;
  };
  const publish = () => {
    if (!active) return;
    const assigned = validStaffAccess(access) ? access.enabled : isStaffRoleId(claims.staffRole);
    const ready = claimsReady && accessReady && (!watchedRole || roleReady);
    let issue: StaffAccessState['issue'] = null;
    const diagnostic = failure || (ready && assigned && !validStaffAccess(access) ? { source: 'staff-registry' as const, code: 'missing-or-invalid-record' } :
      ready && watchedRole && !validStaffRole(policy) ? { source: 'staff-policy' as const, code: 'missing-or-invalid-record' } : undefined);
    if (ready && (failed || (assigned && (!validStaffAccess(access) || (watchedRole && !validStaffRole(policy)))))) {
      issue = diagnostic && ['unauthenticated', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/id-token-revoked', 'auth/id-token-expired'].includes(diagnostic.code) ? 'sign-in-required' : 'unavailable';
    }
    else if (ready && assigned && !staffRecordMatches(access, claims)) issue = 'sign-in-required';
    dependencies.changed(ready && !failed && !issue ? staffPermissions(access, policy, claims) : [], { ready, assigned, issue, ...(ready && diagnostic ? { diagnostic } : {}) });
  };
  const reconcile = () => {
    if (!active || !claimsReady || !accessReady) { publish(); return; }
    const nextRole = !failed && staffRecordMatches(access, claims) ? access.roleId : '';
    if (nextRole !== watchedRole) {
      stopRole(); watchedRole = nextRole; policy = undefined; roleReady = false;
      const generation = ++roleGeneration;
      if (nextRole) stopRole = dependencies.watchRole(nextRole, value => {
        if (active && generation === roleGeneration) { policy = value; roleReady = true; publish(); }
      }, reason => {
        if (active && generation === roleGeneration) { recordFailure('staff-policy', reason); policy = undefined; roleReady = true; publish(); }
      });
    }
    publish();
    // Assignments revoke old sessions. An explicit new sign-in avoids refresh/re-subscribe loops.
  };
  publish();
  const stopAccess = dependencies.watchAccess(user.uid, value => { access = value; accessReady = true; reconcile(); },
    reason => { recordFailure('staff-registry', reason); accessReady = true; access = undefined; reconcile(); });
  void user.getIdTokenResult().then(token => { if (active) { claims = token.claims; claimsReady = true; reconcile(); } })
    .catch(reason => { if (active) { recordFailure('session-token', reason); claimsReady = true; reconcile(); } });
  return () => { active = false; roleGeneration++; stopAccess(); stopRole(); };
}
