export function parseAdminAccessArguments(args: string[], sync = false) {
  let email = ''; let uid = ''; let revoke = false; let dryRun = sync; let apply = false; let help = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Repeated argument: ${flag}`);
    seen.add(flag);
    if (flag === '--help' || flag === '-h') help = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (sync && flag === '--apply') { apply = true; dryRun = false; }
    else if (!sync && flag === '--revoke') revoke = true;
    else if (!sync && flag === '--email') {
      email = (args[++i] || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid --email address.');
    } else if (!sync && flag === '--uid') {
      uid = (args[++i] || '').trim();
      if (uid.startsWith('--') || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Provide a valid --uid.');
    } else throw new Error(`Unsupported argument: ${flag}`);
  }
  if (seen.has('--dry-run') && apply) throw new Error('--dry-run and --apply cannot be combined.');
  if (email && uid) throw new Error('Use either --email or --uid.');
  if (uid && !revoke && !help) throw new Error('--uid is supported only with --revoke.');
  if (!sync && !help && !email && !uid) throw new Error('Usage: npm run admin:set -- --email EMAIL [--revoke] [--dry-run], or --uid UID --revoke');
  return { email, uid, revoke, dryRun, help };
}
