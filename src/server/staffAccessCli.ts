export function parseStaffCheckArguments(args: string[]): { help: boolean; email: string } {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true, email: '' };
  if (args.length !== 2 || args[0] !== '--email') throw new Error('Usage: npm run security:staff-check -- --email <registered-email>');
  const email = args[1].trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid registered email.');
  return { help: false, email };
}
