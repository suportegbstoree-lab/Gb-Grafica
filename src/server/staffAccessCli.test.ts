import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStaffCheckArguments } from './staffAccessCli';
test('staff diagnostic accepts only a registered email lookup or help, never mutation flags', () => {
  assert.deepEqual(parseStaffCheckArguments(['--email', ' Person@Example.test ']), { help: false, email: 'person@example.test' });
  assert.equal(parseStaffCheckArguments(['--help']).help, true);
  for (const args of [[], ['--apply'], ['--email', 'invalid'], ['--email', 'p@example.test', '--grant'], ['--help', '--apply']]) assert.throws(() => parseStaffCheckArguments(args));
});
