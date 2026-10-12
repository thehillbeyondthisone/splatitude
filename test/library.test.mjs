import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverLibrary, publicEntry } from '../src/library.mjs';
import { byteRange } from '../server.mjs';

test('the library offers final Gaussian exports and excludes running epochs and point clouds', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'splatitude-test-'));
  try {
    const final = path.join(root, 'Project', '2026-01-01_10-00-00_3DGS', '3DGS', 'ply');
    const running = path.join(root, 'Project', '2026-02-01_10-00-00_3DGS', '3DGS', 'ply');
    const local = path.join(root, 'library');
    await Promise.all([final, running, local].map(folder => mkdir(folder, { recursive: true })));
    const header = 'ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float scale_0\nproperty float rot_0\nend_header\n';
    const gaussian = Buffer.concat([Buffer.from(header), Buffer.alloc(16)]);
    await writeFile(path.join(final, 'capture_epoch_30.ply'), gaussian);
    await writeFile(path.join(final, 'capture_epoch_25.ply'), gaussian);
    await writeFile(path.join(running, 'capture_epoch_10.ply'), gaussian);
    await writeFile(path.join(running, 'capture_epoch_30.ply'), header); // Still being written.
    await writeFile(path.join(local, 'point-cloud.ply'), 'ply\nelement vertex 100\nproperty float x\nend_header\n');
    const assets = await discoverLibrary({ shareRoot: root, localRoot: local, config: { aliases: { '2026-01-01_10-00-00_3DGS': 'My room' } } });
    assert.equal(assets.length, 1); assert.equal(assets[0].name, 'My room'); assert.equal(assets[0].splats, 2);
    assert.equal(assets[0].epoch, 30); assert.match(assets[0].url, /^\/api\/splats\/[a-f0-9]+\.ply$/);
    assert(!('file' in publicEntry(assets[0])), 'public catalog must not disclose absolute file paths');
    const direct = await discoverLibrary({ shareRoot: path.join(root, 'missing'), config: { assets: [{ path: path.join(final, 'capture_epoch_30.ply'), name: 'Referenced' }] } });
    assert.equal(direct.length, 1);
    assert(!JSON.stringify(publicEntry(direct[0])).includes(root), 'referenced assets must not expose their full paths either');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('partial reads work and invalid ranges are rejected', () => {
  assert.deepEqual(byteRange(undefined, 100), { start: 0, end: 99, status: 200 });
  assert.deepEqual(byteRange('bytes=0-9', 100), { start: 0, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=95-', 100), { start: 95, end: 99, status: 206 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99, status: 206 });
  for (const invalid of ['bytes=100-', 'bytes=10-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5']) assert.equal(byteRange(invalid, 100), null);
});
