import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { localServerOptions } from './src/server/localServerSecurity.js';
import { logEvent } from './src/server/observability.js';

dotenv.config({ quiet: true });

try {
  const options = localServerOptions(process.argv.slice(2));
  process.env.NODE_ENV = options.mode;
  const { startLocalServer } = await import('./src/server/localServer.js');
  await startLocalServer(fileURLToPath(new URL('.', import.meta.url)), options);
} catch (error) {
  logEvent('error', 'server_start_failed', { error });
  process.exitCode = 1;
}
