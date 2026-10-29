import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import type { NextFunction } from 'express';

type Environment = Record<string, string | undefined>;
export interface LocalNetworkPolicy { allowNetwork: boolean; hosts: string[] }
export interface LocalServerOptions {
  mode: 'development' | 'production'; host: string; port: number; network: LocalNetworkPolicy;
}

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const fail = (message: string): never => { throw new Error(message); };

export function localNetworkPolicy(env: Environment = process.env, e2e = false): LocalNetworkPolicy {
  if (e2e) return { allowNetwork: false, hosts: [...LOOPBACK_HOSTS] };
  const flag = env.DEV_SERVER_ALLOW_NETWORK?.trim() || 'false';
  if (!['true', 'false'].includes(flag)) fail('DEV_SERVER_ALLOW_NETWORK must be true or false.');
  const extra = (env.VITE_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (extra.length && flag !== 'true') fail('Extra development hosts require DEV_SERVER_ALLOW_NETWORK=true.');
  if (flag === 'true' && !extra.length) fail('Network access requires exact hosts in VITE_ALLOWED_HOSTS.');
  for (const host of extra) {
    if (host.startsWith('.') || host.includes('*') || host.length > 253
      || !(isIP(host.replace(/^\[|\]$/g, '')) || /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host))
      || ['0.0.0.0', '::', '[::]'].includes(host)) fail('VITE_ALLOWED_HOSTS accepts exact hostnames/IPs only; no URL, wildcard or port.');
  }
  const normalized = extra.map(host => isIP(host) === 6 ? `[${host}]` : host);
  return { allowNetwork: flag === 'true', hosts: [...new Set([...LOOPBACK_HOSTS, ...normalized])] };
}

export function isLoopbackAddress(value: string): boolean {
  const normalized = value.replace(/^::ffff:/, '').toLowerCase();
  return normalized === '::1' || (isIP(normalized) === 4 && normalized.startsWith('127.'));
}

export function validateLocalBind(host: string | boolean | undefined, policy: LocalNetworkPolicy): void {
  const value = typeof host === 'string' ? host.toLowerCase() : host === true ? '0.0.0.0' : 'localhost';
  if (!policy.allowNetwork && value !== 'localhost' && !isLoopbackAddress(value)) {
    fail('Development/preview servers bind to loopback by default. Network access requires explicit opt-in and exact hosts.');
  }
}

export function localServerOptions(args: string[], env: Environment = process.env): LocalServerOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]; const value = args[i + 1];
    if (!['--mode', '--host', '--port'].includes(flag) || flags.has(flag) || !value || value.startsWith('--')) {
      fail('Usage: server.ts [--mode development|production] [--host HOST] [--port PORT]');
    }
    flags.set(flag, value);
  }
  const nodeEnv = env.NODE_ENV?.trim();
  if (nodeEnv && !['development', 'production', 'staging'].includes(nodeEnv)) fail('Unsupported NODE_ENV. Use development, production or staging.');
  const explicit = flags.get('--mode');
  if (explicit && !['development', 'production'].includes(explicit)) fail('Unsupported --mode. Use development or production.');
  const fromEnv = nodeEnv === 'development' ? 'development' : nodeEnv ? 'production' : undefined;
  if (explicit && fromEnv && explicit !== fromEnv) fail('--mode conflicts with NODE_ENV.');
  // An unset environment never enables Vite implicitly.
  const mode = (explicit || fromEnv || 'production') as LocalServerOptions['mode'];
  const host = flags.get('--host') || (mode === 'development' ? '127.0.0.1' : '0.0.0.0');
  if (/[\s/\\@?#]/.test(host) || (!isIP(host) && !/^[a-z0-9.-]+$/i.test(host))) fail('Invalid bind host.');
  const portText = flags.get('--port') ?? env.PORT ?? '3000';
  const port = /^\d+$/.test(portText) ? Number(portText) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT/--port must be an integer from 1 to 65535.');
  const network = mode === 'development' ? localNetworkPolicy(env) : { allowNetwork: true, hosts: [] };
  if (mode === 'development') validateLocalBind(host, network);
  return { mode, host, port, network };
}

/** Applied before Express proxy handling: forwarded headers cannot expand local access. */
export function localRequestAllowed(req: IncomingMessage, policy: LocalNetworkPolicy): boolean {
  if (!policy.allowNetwork && req.socket.remoteAddress && !isLoopbackAddress(req.socket.remoteAddress)) return false;
  if (req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length !== 1) return false;
  const host = req.headers.host;
  if (!host || /[\s/\\@?#,]/.test(host)) return false;
  let target: URL;
  try { target = new URL(`http://${host}`); } catch { return false; }
  if (!policy.hosts.includes(target.hostname.toLowerCase())) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.host.toLowerCase() !== target.host.toLowerCase()) return false;
    } catch { return false; }
  }
  return true;
}

export function rejectLocalRequest(res: ServerResponse, status = 403): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(status === 403 ? 'Local server access denied.' : 'Not found.');
}

export function localNetworkMiddleware(policy: LocalNetworkPolicy) {
  return (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    if (!localRequestAllowed(req, policy)) { rejectLocalRequest(res); return; }
    next();
  };
}

const guardedServers = new WeakSet<EventEmitter>();
export function guardLocalWebSocket(server: EventEmitter, policy: LocalNetworkPolicy, disabled = false): void {
  if (guardedServers.has(server)) return;
  guardedServers.add(server);
  server.prependListener('upgrade', (req: IncomingMessage, socket: Duplex) => {
    if (disabled || !localRequestAllowed(req, policy)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
    }
  });
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function sensitiveFile(relative: string): boolean {
  const parts = relative.replace(/\\/g, '/').split('/');
  return parts.some(part => part.startsWith('.') && part !== '.vite')
    || /(?:^|[/_.-])(?:secret|secrets|credential|credentials|service[-_]?account|private[-_]?key)(?:[/_.-]|$)/i.test(relative)
    || /\.(?:pem|key|crt|p12|pfx|log|patch|diff|zip|tar|gz|tgz|bak|sqlite|db)$/i.test(relative)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relative);
}

const publicExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif', '.woff', '.woff2', '.ttf', '.otf', '.css', '.txt', '.xml', '.webmanifest', '.pdf', '.mp4', '.webm', '.mp3', '.ogg', '.wav']);
const clientExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', ...publicExtensions]);

function publicAsset(relative: string): boolean {
  return !sensitiveFile(relative) && publicExtensions.has(path.extname(relative).toLowerCase())
    && !/^(?:src|api|scripts|test|e2e|node_modules|@[^/]*)(?:\/|$)/i.test(relative.replace(/\\/g, '/'));
}

export function decodedRequestPath(value: string | undefined): string | null {
  const raw = (value || '').split(/[?#]/, 1)[0];
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (/[\\\x00-\x1f\x7f%?#]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..')) return null;
    return decoded;
  } catch { return null; }
}

export class ClientFilePolicy {
  readonly root: string;
  readonly source: string;
  readonly dependencies: string;
  readonly realDependencies: string;
  readonly publicDir: string;
  readonly dist: string;

  constructor(root: string, private readonly allowE2E = false) {
    this.root = realpathSync(root);
    this.source = path.join(this.root, 'src');
    this.dependencies = path.join(this.root, 'node_modules');
    this.realDependencies = existsSync(this.dependencies) ? realpathSync(this.dependencies) : this.dependencies;
    this.publicDir = path.join(this.root, 'public');
    this.dist = path.join(this.root, 'dist');
  }

  private canonicalWithin(root: string, file: string): boolean {
    try { return inside(realpathSync(root), realpathSync(file)); } catch { return false; }
  }

  allowedFile(file: string): boolean {
    const absolute = path.resolve(file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return false;
    if (inside(this.dependencies, absolute) || inside(this.realDependencies, absolute)) {
      const dependencyRoot = this.realDependencies;
      const lexicalRoot = inside(this.dependencies, absolute) ? this.dependencies : dependencyRoot;
      return !inside(dependencyRoot, this.root)
        && !sensitiveFile(path.relative(lexicalRoot, absolute)) && this.canonicalWithin(this.dependencies, absolute)
        && !sensitiveFile(path.relative(dependencyRoot, realpathSync(absolute)));
    }
    const relative = path.relative(this.root, absolute).replace(/\\/g, '/');
    if (sensitiveFile(relative)) return false;
    if (relative === 'index.html' || relative === 'firebase-applet-config.json'
      || (this.allowE2E && relative === 'e2e/fixtures/app-check.ts')) return this.canonicalWithin(this.root, absolute)
      && realpathSync(absolute) === absolute;
    if (inside(this.source, absolute)) {
      const sourceRelative = path.relative(this.source, absolute).replace(/\\/g, '/');
      return !lstatSync(this.source).isSymbolicLink()
        && !/^(?:server|.*\/(?:server))(?:\/|$)/i.test(sourceRelative)
        && (this.allowE2E || !/^e2e(?:\/|$)/i.test(sourceRelative))
        && clientExtensions.has(path.extname(absolute).toLowerCase())
        && this.canonicalWithin(this.source, absolute)
        && !/^server(?:\/|$)/i.test(path.relative(realpathSync(this.source), realpathSync(absolute)).replace(/\\/g, '/'))
        && (this.allowE2E || !/^e2e(?:\/|$)/i.test(path.relative(realpathSync(this.source), realpathSync(absolute)).replace(/\\/g, '/')))
        && !sensitiveFile(path.relative(this.root, realpathSync(absolute)));
    }
    if (inside(this.publicDir, absolute)) return !lstatSync(this.publicDir).isSymbolicLink()
      && publicAsset(path.relative(this.publicDir, absolute)) && this.canonicalWithin(this.publicDir, absolute)
      && publicAsset(path.relative(realpathSync(this.publicDir), realpathSync(absolute)));
    return false;
  }

  assertPublicTree(): void {
    if (!existsSync(this.publicDir)) return;
    if (lstatSync(this.publicDir).isSymbolicLink()) fail('Unsafe public/ directory symlink.');
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        const relative = path.relative(this.publicDir, file).replace(/\\/g, '/');
        if (entry.isSymbolicLink() || sensitiveFile(relative)) fail('Unsafe file or symlink in public/. Move private files outside public/.');
        if (entry.isDirectory()) visit(file);
        else if (!publicAsset(relative)) fail('Unsupported public asset. public/ is restricted to client assets.');
      }
    };
    visit(this.publicDir);
  }

  assertDist(): void {
    if (!existsSync(path.join(this.dist, 'index.html')) || !statSync(path.join(this.dist, 'index.html')).isFile()) {
      fail('Production build missing. Run npm run build before npm start.');
    }
    if (lstatSync(this.dist).isSymbolicLink() || !this.canonicalWithin(this.dist, path.join(this.dist, 'index.html'))
      || lstatSync(path.join(this.dist, 'index.html')).isSymbolicLink()) fail('Unsafe production build directory.');
  }

  private allowedRequestFile(file: string): boolean {
    if (existsSync(file)) return this.allowedFile(file);
    // Vite waits for these generated modules when its optimizer is still running.
    // Permit that wait, without permitting arbitrary missing files or symlink exits.
    const lexicalRoot = inside(this.dependencies, file) ? this.dependencies : this.realDependencies;
    const relative = path.relative(lexicalRoot, file).replace(/\\/g, '/');
    if (inside(this.realDependencies, this.root) || sensitiveFile(relative)
      || !/^\.vite\/(?:development|e2e)\/deps\/[a-z0-9_@-]+\.js$/i.test(relative)) return false;
    let parent = path.dirname(file);
    while (true) {
      try {
        lstatSync(parent); // Includes dangling links, which realpath must reject.
        return this.canonicalWithin(this.dependencies, parent)
          && !sensitiveFile(path.relative(this.realDependencies, realpathSync(parent)));
      } catch {
        const next = path.dirname(parent);
        if (next === parent) return false;
        parent = next;
      }
    }
  }

  allowedRequest(url: string | undefined, production = false): boolean {
    const pathname = decodedRequestPath(url);
    if (!pathname || sensitiveFile(pathname)) return false;
    if (production && (!existsSync(this.dist) || lstatSync(this.dist).isSymbolicLink())) return false;
    if (pathname === '/__open-in-editor' || pathname.startsWith('/__open-in-editor/')) return false;
    if (pathname === '/') return true;
    if (production) {
      if (/^\/(?:src|api|scripts|test|e2e|node_modules|@[^/]*)(?:\/|$)/i.test(pathname)
        || /\.(?:[cm]?tsx?|jsx|json|map)$/i.test(pathname)) return false;
      const file = path.join(this.dist, pathname);
      if (!existsSync(file)) return !path.extname(pathname);
      return statSync(file).isFile() && this.canonicalWithin(this.dist, file)
        && !sensitiveFile(path.relative(realpathSync(this.dist), realpathSync(file)));
    }
    if (['/@vite/client', '/@vite/env', '/@react-refresh'].includes(pathname)) return true;
    if (pathname.startsWith('/@fs/')) {
      let file = pathname.slice('/@fs/'.length);
      if (process.platform === 'win32' && /^\/[a-z]:\//i.test(file)) file = file.slice(1);
      // Vite encodes POSIX absolute paths as /@fs/workspace/file (one slash).
      if (process.platform !== 'win32' && !file.startsWith('/')) file = `/${file}`;
      return path.isAbsolute(file) && this.allowedRequestFile(file);
    }
    if (pathname.startsWith('/@')) return false;
    const publicFile = path.join(this.publicDir, pathname);
    if (existsSync(publicFile)) return this.allowedFile(publicFile);
    const projectFile = path.join(this.root, pathname);
    if (this.allowedRequestFile(projectFile)) return true;
    if (existsSync(projectFile)) return false;
    return !path.extname(pathname) && !/^\/(?:src|node_modules|scripts|api|docs|test|e2e)(?:\/|$)/i.test(pathname);
  }

  middleware(production = false) {
    return (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
      if (!this.allowedRequest(req.url, production)) { rejectLocalRequest(res); return; }
      next();
    };
  }
}
