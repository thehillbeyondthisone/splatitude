import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.SPLATITUDE_URL || 'http://127.0.0.1:8770';
await mkdir('verification', { recursive: true });
const catalog = await (await fetch(`${base}/api/library`)).json();
assert(catalog.assets.length >= 2, 'This local integration test needs two completed scans.');
assert(catalog.assets.every(asset => !('file' in asset)));
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [], failed = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('requestfailed', req => { if (req.failure()?.errorText !== 'net::ERR_ABORTED') failed.push(req.url()); });
await page.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && !url.startsWith(base + '/')) { external.push(url); return route.abort(); }
  return route.continue();
});
await page.addInitScript(() => {
  navigator.mediaDevices.getDisplayMedia = async options => {
    window.__captureOptions = options;
    if (window.__cancelCapture) throw new DOMException('Cancelled', 'NotAllowedError');
    const context = new AudioContext(); await context.resume();
    const oscillator = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination();
    oscillator.frequency.value = 120; gain.gain.value = 0.03;
    oscillator.connect(gain); gain.connect(dest); oscillator.start();
    window.__tone = { context, oscillator, gain, stream: dest.stream };
    return dest.stream;
  };
});
async function visibleFraction() {
  return page.evaluate(async () => {
    await __bench.settled();
    __bench.pushUniforms(); __bench.pushCameraUniform(); __bench.updateShaderUniforms(); __bench.updateOptics(); __bench.renderWithPost();
    const gl = __bench.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const data = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
    let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 70) n++;
    return n / (w * h);
  });
}
function wave() {
  const rate = 24000, samples = rate * 3, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 120) * (Math.floor(i / rate * 4) % 2 ? 0 : 23000)), 44 + i * 2);
  return wav;
}
try {
  console.log('Checking the completed-splat library and first scene...');
  await page.goto(`${base}/?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__splatitude && !__splatitude.state().loading && __splatitude.state().asset, null, { timeout: 180000 });
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('[data-asset]').count(), catalog.assets.length);
  assert((await visibleFraction()) > 0.05, 'first scan must render visible pixels');
  await page.screenshot({ path: 'verification/performance-desktop.png' });
  checks.push('Both completed scans listed; first scan visibly renders');
  console.log('Connecting a synthetic live stream, with timeline paused...');
  await page.locator('#connectAudio').click();
  await page.waitForFunction(() => __splatitude.state().live && __bench.V.dAmt > 0.005);
  assert.equal(await page.evaluate(() => __bench.playing), false);
  const bass = await page.evaluate(() => ({ ...__splatitude.state().levels }));
  assert(bass.low > bass.mid * 2 && bass.low > bass.high * 2);
  assert.equal(await page.evaluate(() => __captureOptions.systemAudio), 'include');
  const shaderTime = await page.evaluate(() => __bench.U.time.value);
  await page.waitForTimeout(250);
  assert(await page.evaluate(time => __bench.U.time.value > time, shaderTime), 'live motion must run without timeline playback');
  await page.evaluate(() => { __tone.oscillator.frequency.value = 800; }); await page.waitForTimeout(300);
  assert(await page.evaluate(() => __splatitude.state().levels.mid > __splatitude.state().levels.low * 2));
  await page.evaluate(() => { __tone.oscillator.frequency.value = 6000; }); await page.waitForTimeout(300);
  assert(await page.evaluate(() => __splatitude.state().levels.high > __splatitude.state().levels.mid * 2));
  await page.evaluate(() => { __tone.oscillator.frequency.value = 120; });
  checks.push('Live frequency bands and motion work while timeline is paused');

  for (const look of ['pulse', 'liquid', 'prism', 'drift', 'echo', 'raw']) {
    await page.locator(`[data-look="${look}"]`).click(); await page.waitForTimeout(150);
    assert(await page.evaluate(() => Object.values(__bench.V).every(Number.isFinite)));
    assert.equal(await page.evaluate(() => __splatitude.state().look), look);
  }
  await page.locator('[data-look="pulse"]').click();
  await page.locator('#masterIntensity').evaluate(el => { el.value = '0'; el.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(150); assert.equal(await page.evaluate(() => __bench.V.dAmt), 0);
  await page.locator('#masterIntensity').evaluate(el => { el.value = '1.25'; el.dispatchEvent(new Event('input')); });
  await page.locator('#bypassEffects').click();
  assert.equal(await page.evaluate(() => __bench.V.dAmt), 0); assert.equal(await page.evaluate(() => __bench.V.sat), 1);
  await page.locator('#bypassEffects').click();
  await page.locator('[data-feel="float"]').click();
  assert.equal(await page.evaluate(() => __bench.AUD.dAmt.release), 650);
  checks.push('Six looks, intensity, response shaping and original A/B work');

  console.log('Switching to the second completed scan while live audio continues...');
  const second = catalog.assets[1];
  await page.locator(`[data-asset="${second.id}"]`).click();
  await page.waitForFunction(id => !__splatitude.state().loading && document.querySelector(`[data-asset="${id}"]`)?.getAttribute('aria-pressed') === 'true', second.id, { timeout: 180000 });
  await page.waitForTimeout(3500);
  const secondCoverage = await visibleFraction();
  assert(secondCoverage > 0.03, 'second scan must visibly render: ' + secondCoverage);
  assert.equal(await page.evaluate(() => __splatitude.state().live), true);
  await page.screenshot({ path: 'verification/second-splat-live.png' });
  const savedView = await page.evaluate(() => __splatitude.getView());
  await page.locator('#saveView').click();
  await page.evaluate(() => { __bench.camera.position.x += 1; __bench.controls.update(); });
  await page.locator('#homeView').click();
  const restored = await page.evaluate(() => __splatitude.getView());
  assert(Math.abs(restored.position[0] - savedView.position[0]) < 0.001);
  await page.locator('.splatCard.selected .renameAsset').click({ force: true });
  await page.locator('.renameInput').fill('September space'); await page.locator('.renameInput').press('Enter');
  assert.equal(await page.locator('#sceneTitle').textContent(), 'September space');
  checks.push('Live scan switching, saved camera and per-splat rename work');
  await page.locator('#present').click();
  assert(await page.locator('#exitPerformance').isVisible()); assert.equal(await page.locator('#appHeader').isVisible(), false);
  await page.keyboard.press('Escape'); assert(await page.locator('#appHeader').isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#mobileLibrary').click(); assert(await page.locator('#libraryPanel').isVisible());
  await page.locator('#mobileLibrary').click();
  await page.screenshot({ path: 'verification/performance-mobile.png', fullPage: true });
  checks.push('Performance mode and mobile layout work without horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.locator('#connectAudio').click();
  await page.waitForFunction(() => !__splatitude.state().live);
  assert(await page.evaluate(() => __tone.stream.getTracks().every(track => track.readyState === 'ended')));
  await page.evaluate(() => __tone.context.close());
  await page.evaluate(() => { window.__cancelCapture = true; });
  await page.locator('#connectAudio').click();
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('cancelled'));
  assert.equal(await page.locator('#connectAudio').isDisabled(), false);
  await page.locator('#audioFile').setInputFiles({ name: 'test-pulses.wav', mimeType: 'audio/wav', buffer: wave() });
  await page.waitForFunction(() => __splatitude.state().hasAudio && __splatitude.state().playing, null, { timeout: 30000 });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#saveSession').click();
  const preset = await downloadPromise; const presetPath = 'verification/session.json'; await preset.saveAs(presetPath);
  await page.locator('[data-look="raw"]').click();
  await page.locator('#presetFile').setInputFiles(presetPath);
  await page.waitForFunction(() => __splatitude.state().look === 'pulse' && __splatitude.state().mix === 1.25);
  await page.locator('#advancedToggle').click();
  await page.locator('[data-group="output"]').evaluate(el => { el.open = true; });
  await page.locator('#res').selectOption('1280x720');
  await page.locator('#p-dur').evaluate(el => { el.value = '1'; el.dispatchEvent(new Event('input')); });
  const mp4 = page.waitForEvent('download', { timeout: 120000 }); await page.locator('#render').click();
  await (await mp4).saveAs('verification/music-export.mp4');
  checks.push('Capture cleanup/cancel, audio-file autoplay, preset round trip and 720p MP4 export pass');
  assert.equal((await fetch(`${base}/.local/library.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/splats/unknown.ply`)).status, 404);
  assert.deepEqual({ errors, external, failed }, { errors: [], external: [], failed: [] });
  await writeFile('verification/report.json', JSON.stringify({ story: 'Choose a completed local scan, connect music, shape the performance, and export file-driven sessions',
    catalog: catalog.assets.map(({ name, splats, bytes }) => ({ name, splats, bytes })),
    captureTest: 'Synthetic MediaStream replaces the picker; native system capture still requires the user to choose a source', checks, errors, external, failed }, null, 2));
  console.log('PASS: ' + checks.join('; '));
} catch (error) {
  console.error(error); console.error(JSON.stringify({ errors, external, failed }));
  await page.screenshot({ path: 'verification/failure.png' }).catch(() => {}); process.exitCode = 1;
} finally { await browser.close(); }
