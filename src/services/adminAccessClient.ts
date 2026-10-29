import { adminAccessRecordAllows } from '../lib/adminAccess';

interface AdminSession { uid: string; getIdTokenResult(): Promise<{ claims: Record<string, unknown> }> }
interface ObserverDependencies {
  watchProfile(uid: string, next: (data: Record<string, unknown> | undefined) => void, error: () => void): () => void;
  watchAccess(uid: string, next: (data: Record<string, unknown> | undefined) => void, error: () => void): () => void;
  changed(allowed: boolean): void;
}

/** Observes server-owned authorization; callbacks from previous sessions are discarded. */
export function observeAdminAccess(user: AdminSession, dependencies: ObserverDependencies): () => void {
  let active = true; let failed = false; let claimsReady = false; let profileReady = false; let accessReady = false;
  let claims: Record<string, unknown> = {}; let profile: Record<string, unknown> | undefined;
  let access: Record<string, unknown> | undefined;
  const publish = () => {
    if (active && claimsReady && profileReady && accessReady) {
      dependencies.changed(!failed && adminAccessRecordAllows(access, claims) && (claims.admin === true || profile?.role === 'admin'));
    }
  };
  const profileStop = dependencies.watchProfile(user.uid, value => { profile = value; profileReady = true; publish(); },
    () => { failed = true; profile = undefined; profileReady = true; access = undefined; accessReady = true; publish(); });
  const accessStop = dependencies.watchAccess(user.uid, value => { access = value; accessReady = true; publish(); },
    () => { failed = true; access = undefined; accessReady = true; publish(); });
  void user.getIdTokenResult().then(token => { claims = token.claims; claimsReady = true; publish(); })
    .catch(() => { failed = true; claims = {}; claimsReady = true; access = undefined; accessReady = true; publish(); });
  return () => { active = false; profileStop(); accessStop(); };
}
