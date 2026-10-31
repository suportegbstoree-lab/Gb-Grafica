import React from 'react';
import { DEFAULT_ROLE_PERMISSIONS, parseStaffPermissions, type StaffPermission } from '../lib/staffAccess';
import { observeStaffAccess, LOADING_STAFF_ACCESS, type StaffAccessState } from '../services/staffAccessClient';

const epoch = 'a'.repeat(32);
const policy = (permissions: StaffPermission[]) => ({ schemaVersion: 1, enabled: true, revision: 'b'.repeat(32), permissions });
export function useStaffEntryFixture() {
  const scenario = React.useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get('role') === 'designer' ? 'designer' : 'product-manager';
    const configured = params.get('permissions');
    return { active: window.location.pathname.startsWith('/__e2e/team'), role, none: params.has('none'),
      permissions: configured !== null ? parseStaffPermissions(configured ? configured.split(',') : []) || [] : DEFAULT_ROLE_PERMISSIONS[role],
      stale: params.has('stale'), fail: params.has('fail'), delay: params.has('delay') ? 2000 : 0, guest: params.has('guest') };
  }, []);
  const [signedIn, setSignedIn] = React.useState(!scenario.guest), [freshToken, setFreshToken] = React.useState(!scenario.stale);
  const [failure, setFailure] = React.useState(scenario.fail), [revision, setRevision] = React.useState(0);
  const [state, setState] = React.useState<{ permissions: StaffPermission[]; access: StaffAccessState }>({ permissions: [], access: LOADING_STAFF_ACCESS });
  const publishPolicy = React.useRef<(value: unknown) => void>(() => {}), publishAccess = React.useRef<(value: unknown) => void>(() => {});
  const currentPermissions = React.useRef(scenario.permissions);
  React.useEffect(() => {
    if (!scenario.active) return;
    if (!signedIn) { setState({ permissions: [], access: { ready: true, assigned: false, issue: null } }); return; }
    const access = { schemaVersion: 1, enabled: true, epoch, roleId: scenario.role };
    return observeStaffAccess({ uid: 'e2e-user', getIdTokenResult: async () => ({ claims: freshToken && !scenario.none ? { staffRole: scenario.role, gbStaffEpoch: epoch } : {} }) }, {
      watchAccess: (_uid, next) => { publishAccess.current = next; const timer = setTimeout(() => next(scenario.none ? undefined : access), 0); return () => clearTimeout(timer); },
      watchRole: (_id, next, error) => { publishPolicy.current = next; const timer = setTimeout(() => failure ? error() : next(policy(currentPermissions.current)), scenario.delay); return () => clearTimeout(timer); },
      changed: (permissions, access) => setState({ permissions, access }),
    });
  }, [scenario, signedIn, freshToken, failure, revision]);
  React.useEffect(() => {
    if (!scenario.active) return;
    const change = (event: Event) => {
      const permissions = parseStaffPermissions((event as CustomEvent).detail);
      if (permissions) { currentPermissions.current = permissions; publishPolicy.current(policy(permissions)); }
    };
    const revoke = () => publishAccess.current({ schemaVersion: 1, enabled: false, epoch, roleId: scenario.role });
    window.addEventListener('e2e:staff-policy', change); window.addEventListener('e2e:staff-revoke', revoke);
    return () => { window.removeEventListener('e2e:staff-policy', change); window.removeEventListener('e2e:staff-revoke', revoke); };
  }, [scenario]);
  return { active: scenario.active, signedIn, ...state,
    async signIn() { setFreshToken(true); setSignedIn(true); setRevision(value => value + 1); },
    async signOut() { setSignedIn(false); }, retry() { setFailure(false); setRevision(value => value + 1); } };
}
