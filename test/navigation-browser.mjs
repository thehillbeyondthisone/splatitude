import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visibleFraction } from './render-evidence.mjs';
const base = process.env.SPLATITUDE_URL || 'http://127.0.0.1:8770';
const catalog = await (await fetch(`${base}/api/library`)).json();
catalog.assets = catalog.assets.filter(asset => asset.shareCoordinates && asset.firstCamera);
assert(catalog.assets.length >= 2, 'This test needs two completed SHARE scans.');
await mkdir('verification', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(ids => {
  localStorage.setItem('splatitude.views', JSON.stringify(Object.fromEntries(
    ids.map(id => [id, { position: [999, 999, 999], target: [0, 0, 0] }]))));
  navigator.mediaDevices.getDisplayMedia = async () => {
    const context = new AudioContext(); await context.resume();
    const oscillator = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination();
    oscillator.frequency.value = 120; gain.gain.value = 0.03; oscillator.connect(gain); gain.connect(dest); oscillator.start();
    window.__tone = { context, oscillator, stream: dest.stream }; return dest.stream;
  };
}, catalog.assets.map(asset => asset.id));
const view = () => page.evaluate(() => __splatitude.getView());
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
async function loaded() {
  await page.waitForFunction(() => window.__splatitude && !__splatitude.state().loading && __splatitude.state().asset, null, { timeout: 180000 });
  await page.waitForTimeout(1000);
}
function capturePosition(asset) {
  const m = asset.firstCamera;
  return asset.view?.position || [m[0][3], m[2][3], -m[1][3]];
}
async function visible() {
  return visibleFraction(page);
}
async function walk(key) {
  const before = await view(); await page.keyboard.down(key);
  try { await page.waitForFunction(position => Math.hypot(...__splatitude.getView().position.map((v, i) => v - position[i])) > 0.3, before.position, { timeout: 5000 }); }
  finally { await page.keyboard.up(key); }
  return [before, await view()];
}
try {
  await page.goto(`${base}/?debug=1&scene=${catalog.assets[0].id}`); await loaded();
  const initial = await view();
  assert(distance(initial.position, capturePosition(catalog.assets[0])) < 0.001, 'starts at capture location, ignoring legacy outside view');
  assert.equal(initial.fov, 70); assert(await page.evaluate(() => __bench.camera.near <= 0.02));
  assert.equal(await page.evaluate(() => __splatitude.state().navigation), 'walk');
  assert((await visible()) > 0.2); checks.push('First scan starts at the real interior camera and renders');
  const box = await page.locator('#stage').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 120, y + 30, { steps: 12 }); await page.mouse.up();
  const turned = await view();
  assert(distance(turned.position, initial.position) < 0.001, 'looking turns in place');
  assert(distance(turned.target, initial.target) > 0.3);
  const [beforeWalk, afterWalk] = await walk('w');
  assert(Math.abs(afterWalk.position[1] - beforeWalk.position[1]) < 0.001, 'walking stays at eye height');
  await walk('a'); assert.equal(await page.evaluate(() => __bench.currentMode()), 'orbit', 'A strafes without opening Adjust');
  const [beforeHeight, afterHeight] = await walk('e'); assert(afterHeight.position[1] > beforeHeight.position[1] + 0.25);
  await page.locator('#enterSpace').click(); assert(distance((await view()).position, initial.position) < 0.001);
  await page.mouse.move(x, y); await page.mouse.wheel(0, -600); await page.mouse.wheel(0, -600);
  assert(distance((await view()).position, initial.position) > 2.9, 'wheel moves through the former orbit pivot');
  await page.keyboard.press('r'); assert(distance((await view()).position, initial.position) < 0.001);
  checks.push('Drag looks in place; keys, height and wheel move freely; R returns inside');
  await walk('d'); const saved = await view(); await page.locator('#saveView').click();
  await page.locator('#enterSpace').click(); assert(distance((await view()).position, initial.position) < 0.001);
  await page.locator('#homeView').click(); assert(distance((await view()).position, saved.position) < 0.001);
  await page.locator('[data-navigation="orbit"]').click(); assert(await page.evaluate(() => __bench.controls.enabled));
  await page.locator('[data-navigation="walk"]').click(); assert.equal(await page.evaluate(() => __bench.controls.enabled), false);
  await page.locator('#connectAudio').click(); await page.waitForFunction(() => __splatitude.state().live && __bench.V.dAmt > 0.005);
  await page.locator('[data-look="liquid"]').click(); await walk('s'); assert.equal(await page.evaluate(() => __splatitude.state().live), true);
  await page.locator('#advancedToggle').click(); assert.equal(await page.evaluate(() => __splatitude.state().navigation), 'orbit');
  await page.locator('#enterSpace').click(); assert.equal(await page.evaluate(() => __splatitude.state().navigation), 'walk');
  assert.equal(await page.evaluate(() => document.body.classList.contains('advanced')), false);
  await page.locator('#enterSpace').click(); await page.screenshot({ path: 'verification/walk-desktop.png' });
  checks.push('Saved view and interior reset are separate; sidebar audio/looks and Advanced stay usable');
  const second = catalog.assets[1]; await page.locator(`[data-asset="${second.id}"]`).click(); await loaded();
  assert(distance((await view()).position, capturePosition(second)) < 0.001);
  assert.equal(await page.evaluate(() => __splatitude.state().live), true);
  assert((await visible()) > 0.2); await walk('ArrowDown'); await page.locator('#enterSpace').click();
  await page.screenshot({ path: 'verification/walk-second-splat.png' });
  checks.push('Second scan also starts inside, with walking and live audio after switching');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const pad = await page.locator('[data-walk="KeyW"]').boundingBox(), beforePad = await view();
  await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2); await page.mouse.down();
  try { await page.waitForFunction(position => Math.hypot(...__splatitude.getView().position.map((v, i) => v - position[i])) > 0.2, beforePad.position, { timeout: 5000 }); }
  finally { await page.mouse.up(); }
  await page.locator('#enterSpace').click(); await page.screenshot({ path: 'verification/walk-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.locator('#connectAudio').click();
  await page.evaluate(() => __tone.context.close());
  await page.goto(`${base}/?debug=1&scene=${catalog.assets[0].id}`); await loaded();
  assert(distance((await view()).position, saved.position) < 0.001, 'new saved view survives reload');
  await page.locator('#enterSpace').click(); assert(distance((await view()).position, initial.position) < 0.001);
  checks.push('Touch movement and saved-view reload work, with a permanent return inside');
  assert.deepEqual(errors, []);
  await writeFile('verification/navigation-report.json', JSON.stringify({ checks, errors, captureTest: 'Synthetic stream; the native system-audio picker remains manual' }, null, 2));
  console.log('PASS: ' + checks.join('; '));
} catch (error) { console.error(error, errors); await page.screenshot({ path: 'verification/navigation-failure.png' }).catch(() => {}); process.exitCode = 1; }
finally { await browser.close(); }
