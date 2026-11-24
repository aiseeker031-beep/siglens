'use strict';

const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const rootDir = path.resolve(__dirname, '..');
const deployDir = path.join(rootDir, 'deploy');

async function main() {
  fs.rmSync(deployDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(deployDir, 'dist', 'assets'), { recursive: true });

  // 1. Bundle standalone CommonJS server (zero external npm deps; node:sqlite built into Node 24)
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'server.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    outfile: path.join(deployDir, 'server.cjs'),
    external: ['node:sqlite', 'bufferutil', 'utf-8-validate'],
    plugins: [
      {
        name: 'stub-vite-prod',
        setup(build) {
          build.onResolve({ filter: /^vite$/ }, () => ({
            path: 'vite',
            namespace: 'stub',
          }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export function createServer() { throw new Error("Vite dev server disabled in production"); }',
            loader: 'js',
          }));
        },
      },
    ],
    logLevel: 'info',
  });

  // 2. Write Passenger/LiteSpeed CommonJS bootstrapper (prefers IPv4 for fast exchange APIs)
  const appCjs = `'use strict';

const dns = require('node:dns');
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

process.chdir(__dirname);
process.env.NODE_ENV = 'production';

try {
  require('./server.cjs');
} catch (error) {
  console.error('Siglens startup failed:', error);
  process.exit(1);
}
`;
  fs.writeFileSync(path.join(deployDir, 'app.cjs'), appCjs, 'utf8');

  // 3. Copy clean Vite frontend production build into deploy/dist
  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('dist/index.html missing — run "npm run build" before bundling.');
  }
  fs.copyFileSync(path.join(distDir, 'index.html'), path.join(deployDir, 'dist', 'index.html'));
  if (fs.existsSync(path.join(distDir, 'landing.html'))) {
    fs.copyFileSync(path.join(distDir, 'landing.html'), path.join(deployDir, 'dist', 'landing.html'));
  } else if (fs.existsSync(path.join(rootDir, 'public', 'landing.html'))) {
    fs.copyFileSync(path.join(rootDir, 'public', 'landing.html'), path.join(deployDir, 'dist', 'landing.html'));
  }
  if (fs.existsSync(path.join(distDir, 'favicon.ico'))) {
    fs.copyFileSync(path.join(distDir, 'favicon.ico'), path.join(deployDir, 'dist', 'favicon.ico'));
  }
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.copyFileSync(
          path.join(assetsDir, entry.name),
          path.join(deployDir, 'dist', 'assets', entry.name),
        );
      }
    }
  }

  console.log('[bundle-server] Staged deploy/ (app.cjs, server.cjs, dist/) cleanly.');
}

main().catch((err) => {
  console.error('[bundle-server] Failed:', err);
  process.exit(1);
});

