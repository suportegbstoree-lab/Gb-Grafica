import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

interface VercelHeader {
	key: string;
	value: string;
}

interface VercelHeaderRule {
	source: string;
	headers: VercelHeader[];
}

test('a CSP do Vercel permite os recursos oficiais do reCAPTCHA Enterprise', () => {
	const config = JSON.parse(
		readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'),
	) as { headers?: VercelHeaderRule[] };
	const globalHeaders = config.headers?.find(({ source }) => source === '/(.*)')?.headers ?? [];
	const policy = globalHeaders.find(({ key }) => key.toLowerCase() === 'content-security-policy')?.value;

	assert.ok(policy, 'Content-Security-Policy global não encontrada no vercel.json.');
	assert.match(policy, /script-src[^;]*https:\/\/www\.google\.com\/recaptcha\//);
	assert.match(policy, /script-src[^;]*https:\/\/www\.gstatic\.com\/recaptcha\//);
	assert.match(policy, /connect-src[^;]*https:\/\/www\.google\.com\/recaptcha\//);
	assert.match(policy, /frame-src[^;]*https:\/\/www\.google\.com\/recaptcha\//);
	assert.match(policy, /frame-src[^;]*https:\/\/recaptcha\.google\.com\/recaptcha\//);
});
