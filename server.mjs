import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLibrary, publicEntry } from './src/library.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 8770);
const packages = process.env.SPLATITUDE_DEPENDENCIES || path.join(root, 'node_modules');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json' };
const staticFiles = new Set(['index.html', 'favicon.svg', 'src/engine.mjs', 'src/app.mjs', 'src/navigation.mjs', 'src/looks.mjs', 'src/live-audio.mjs', 'src/splatitude.css']);
const vendors = [['/vendor/three/', path.join(packages, 'three')],
  ['/vendor/spark/', path.join(packages, '@sparkjsdev', 'spark')],
  ['/vendor/mp4-muxer/', path.join(packages, 'mp4-muxer')]];
let catalog = new Map();
async function refresh() {
  let config = {};
  try { config = JSON.parse(await readFile(path.join(root, '.local', 'library.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Invalid local library config; using defaults.'); }
  const entries = await discoverLibrary({ shareRoot: process.env.SPLATITUDE_SHARE_ROOT || config.shareRoot,
    localRoot: path.join(root, 'library'), config });
  catalog = new Map(entries.map(entry => [entry.id, entry]));
  return entries.map(publicEntry);
}
export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < size
    ? { start, end, status: 206 } : null;
}
export const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/health' || pathname === '/api/library') {
      const payload = pathname === '/health' ? { app: 'splatitude', port } : { assets: await refresh() };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(payload)); return;
    }
    let file;
    if (pathname.startsWith('/api/splats/')) {
      const id = pathname.slice('/api/splats/'.length).replace(/\.(ply|splat|spz|sog|ksplat)$/i, '');
      if (!catalog.has(id)) await refresh();
      file = catalog.get(id)?.file;
    } else {
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (staticFiles.has(relative)) file = path.join(root, relative);
      for (const [prefix, folder] of vendors) {
        if (!pathname.startsWith(prefix)) continue;
        const candidate = path.resolve(folder, pathname.slice(prefix.length));
        const rel = path.relative(folder, candidate);
        if (!rel.startsWith('..') && !path.isAbsolute(rel) && !rel.split(path.sep).some(p => p.startsWith('.'))) file = candidate;
        break;
      }
    }
    if (!file) { res.writeHead(404); res.end('Not found'); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const range = byteRange(req.headers.range, info.size);
    if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
    const { start, end, status } = range;
    res.writeHead(status, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}) });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(file, { start, end });
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('Unable to read local asset');
  }
});
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Splatitude: http://127.0.0.1:${port}/`));
}
