import { readdir, stat, readFile, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const directories = async folder => (await readdir(folder, { withFileTypes: true }).catch(() => []))
  .filter(entry => entry.isDirectory()).map(entry => path.join(folder, entry.name));
const json = async file => JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
const idFor = file => createHash('sha256').update(file).digest('hex').slice(0, 20);

async function headerInfo(file, size) {
  if (path.extname(file).toLowerCase() !== '.ply') return {};
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const header = bytes.subarray(0, bytesRead).toString('ascii');
    if (!header.startsWith('ply') || !header.includes('end_header')) return null;
    // Ordinary point-cloud PLYs do not contain the Gaussian scale/rotation data.
    if (!/property \w+ scale_0/.test(header) || !/property \w+ rot_0/.test(header)) return null;
    const splats = Number(header.match(/element vertex (\d+)/)?.[1]);
    const scalarSize = { float: 4, float32: 4, double: 8, float64: 8, uchar: 1, uint8: 1, char: 1, int8: 1, ushort: 2, uint16: 2, short: 2, int16: 2, uint: 4, uint32: 4, int: 4, int32: 4 };
    const properties = header.split('element vertex')[1]?.split(/\nelement /)[0].matchAll(/property (\w+) \w+/g) || [];
    let stride = 0;
    for (const property of properties) stride += scalarSize[property[1]] || 0;
    const headerEnd = header.indexOf('\n', header.indexOf('end_header')) + 1;
    if (!splats || (header.includes('format binary_') && size < headerEnd + splats * stride)) return null;
    return { splats };
  } finally { await handle.close(); }
}

export async function discoverLibrary({ shareRoot = path.join(os.homedir(), 'Documents', 'SHARE', 'share-pointclouds-studio'),
  localRoot, config = {} } = {}) {
  const entries = [];
  async function add(file, details) {
    try {
      const info = await stat(file);
      if (!info.isFile() || !info.size) return;
      const header = await headerInfo(file, info.size);
      if (header === null) return;
      const id = idFor(file), alias = config.aliases?.[details.scan] || config.aliases?.[id];
      entries.push({ id, file, name: alias || details.name, bytes: info.size,
        modified: info.mtime.toISOString(), ...header, ...details, view: config.views?.[details.scan] || null, ...(alias ? { name: alias } : {}),
        url: `/api/splats/${id}${path.extname(file).toLowerCase()}` });
    } catch { /* Missing, partial or inaccessible assets are not ready to play. */ }
  }
  for (const project of await directories(shareRoot)) {
    for (const job of await directories(project)) {
      const scan = path.basename(job), folder = path.join(job, '3DGS', 'ply');
      const files = await readdir(folder).catch(() => []);
      // Earlier epochs and files belonging to a running reconstruction stay out.
      const completed = files.find(name => /_epoch_30\.ply$/i.test(name));
      if (!completed) continue;
      const projectInfo = await json(path.join(folder, 'project_info.json')).catch(() => ({}));
      const captureDate = scan.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || '';
      await add(path.join(folder, completed), { scan, name: `Capture · ${captureDate || scan}`,
        captureDate, source: 'SHARE', epoch: 30, shareCoordinates: true,
        firstCamera: projectInfo.firstCameraMatrix || null });
    }
  }
  if (localRoot) {
    for (const entry of await readdir(localRoot, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && /\.(ply|splat|spz|sog|ksplat)$/i.test(entry.name)) {
        await add(path.join(localRoot, entry.name), { scan: entry.name,
          name: path.basename(entry.name, path.extname(entry.name)), source: 'Library', shareCoordinates: false });
      }
    }
  }
  // Explicit local entries let users reference additional exports without copying.
  for (const asset of config.assets || []) {
    if (typeof asset.path !== 'string' || !/\.(ply|splat|spz|sog|ksplat)$/i.test(asset.path)) continue;
    await add(path.resolve(asset.path), { scan: path.basename(asset.path), name: asset.name || path.basename(asset.path),
      source: 'Local', shareCoordinates: asset.shareCoordinates === true });
  }
  const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()];
  return unique.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function publicEntry({ file, ...entry }) { return entry; }
