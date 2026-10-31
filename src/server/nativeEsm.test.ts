import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Strip types without bundling or rewriting imports, as required by native Node ESM. */
function compileRuntimeGraph(directory: string): number {
  const visited = new Set<string>();
  function visit(source: string): void {
    if (visited.has(source)) return;
    visited.add(source);
    const relative = path.relative(root, source);
    assert.ok(!relative.startsWith('..'), `Import outside the project: ${relative}`);
    const output = path.join(directory, relative.replace(/\.[cm]?tsx?$/, '.js'));
    mkdirSync(path.dirname(output), { recursive: true });
    if (source.endsWith('.json')) {
      writeFileSync(output, readFileSync(source));
      return;
    }
    const result = ts.transpileModule(readFileSync(source, 'utf8'), {
      fileName: source,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    });
    writeFileSync(output, result.outputText);
    const ast = ts.createSourceFile(output, result.outputText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    function walk(node: ts.Node): void {
      const specifier = ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
      if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
        const target = path.resolve(path.dirname(source), specifier.text);
        const candidates = [target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx'), target, `${target}.ts`, path.join(target, 'index.ts')];
        const resolved = candidates.find(candidate => existsSync(candidate));
        assert.ok(resolved, `Missing module ${specifier.text} imported by ${relative}`);
        visit(resolved);
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
  }
  visit(path.join(root, 'api/index.ts'));
  visit(path.join(root, 'api/admin-ai.ts'));
  return visited.size;
}

test('Vercel API starts with native Node ESM, without tsx or a bundler resolving imports', () => {
  const directory = mkdtempSync(path.join(root, '.native-esm-'));
  try {
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    assert.ok(compileRuntimeGraph(directory) > 10, 'The check must include transitive server dependencies.');
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      const { default: app } = await import('./api/index.js');
      const { default: ai } = await import('./api/admin-ai.js');
      assert.equal(typeof ai, 'function');
      const server = createServer(app);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const health = await fetch(base + '/api/health');
        assert.equal(health.status, 200);
        const status = await fetch(base + '/api/app-check/status');
        assert.equal(status.status, 200);
        assert.equal((await status.json()).mode, 'off');
        const checkout = await fetch(base + '/api/checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        assert.equal(checkout.status, 503);
        assert.equal((await checkout.json()).code, 'SERVICE_UNAVAILABLE');
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    `], {
      cwd: directory,
      // Do not inherit loaders or live provider credentials into the native-runtime check.
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, NODE_OPTIONS: '', NODE_ENV: 'production', LOG_LEVEL: 'silent', FIREBASE_APP_CHECK_MODE: 'off' },
      encoding: 'utf8', timeout: 20_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `Native API startup failed:\n${result.stdout}\n${result.stderr}`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
