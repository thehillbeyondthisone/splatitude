import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { waitForRendered } from './render-evidence.mjs';
const base = process.env.SPLATITUDE_URL || 'http://127.0.0.1:8770';
const { assets } = await (await fetch(`${base}/api/library`)).json();
assert(assets.length >= 2, 'This integration test needs two completed scans.');
await mkdir('verification', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], external = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = route.request().url();
  if (/^https?:/.test(url) && !url.startsWith(base + '/')) { external.push(url); return route.abort(); }
  return route.continue();
});
await page.addInitScript(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const context = new AudioContext(); await context.resume();
    const oscillator = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination();
    oscillator.frequency.value = 120; gain.gain.value = 0.03; oscillator.connect(gain); gain.connect(dest); oscillator.start();
    window.__tone = { context, oscillator, gain, stream: dest.stream }; return dest.stream;
  };
});
const view = () => page.evaluate(() => __splatitude.getView());
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
async function loaded() { await page.waitForFunction(() => window.__splatitude && !__splatitude.state().loading && __splatitude.state().asset, null, { timeout: 180000 }); }
async function slider(id, value) { await page.locator(id).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input')); }, String(value)); }
try {
  console.log('Checking live frequency mix, freeze and boost...');
  await page.goto(`${base}/?debug=1&scene=${assets[0].id}`); await loaded();
  await page.locator('#connectAudio').click(); await page.waitForFunction(() => __splatitude.state().live && __bench.V.dAmt > 0.005);
  await page.locator('#bandMixer summary').click(); await slider('#lowMix', 0); await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => __bench.V.dAmt), 0);
  assert(await page.evaluate(() => __splatitude.state().levels.low > 0.05), 'mixing does not mute incoming music analysis');
  await slider('#lowMix', 1); await page.waitForFunction(() => __bench.V.dAmt > 0.005);
  await page.locator('#freezeVisuals').click();
  const frozen = await page.evaluate(() => ({ time: __bench.U.time.value, amount: __bench.V.dAmt, level: __splatitude.state().levels.low }));
  await page.evaluate(() => { __tone.oscillator.frequency.value = 800; }); await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => __bench.U.time.value), frozen.time);
  assert.equal(await page.evaluate(() => __bench.V.dAmt), frozen.amount);
  assert(await page.evaluate(old => Math.abs(__splatitude.state().levels.low - old) > 0.05, frozen.level));
  const freezeView = await view(); await page.keyboard.down('d'); await page.waitForTimeout(350); await page.keyboard.up('d');
  assert(distance((await view()).position, freezeView.position) > 0.25, 'camera remains usable while visuals are frozen');
  await page.keyboard.press('m'); assert.equal(await page.evaluate(() => __splatitude.state().frozen), false);
  await page.evaluate(() => { __tone.oscillator.frequency.value = 120; }); await page.waitForTimeout(400);
  const baseline = await page.evaluate(() => __bench.V.dAmt);
  await page.keyboard.down('b'); await page.waitForTimeout(150);
  assert(await page.evaluate(base => __splatitude.state().boosted && __bench.V.dAmt > base * 1.4, baseline));
  await page.keyboard.up('b'); assert.equal(await page.evaluate(() => __splatitude.state().boosted), false);
  await page.locator('#boostVisuals').focus(); await page.keyboard.down('Space');
  assert.equal(await page.evaluate(() => __bench.playing), false, 'accessible boost must not toggle timeline playback');
  assert.equal(await page.evaluate(() => __splatitude.state().boosted), true); await page.keyboard.up('Space');
  await page.locator('#bandMixer summary').click();
  checks.push('Band mix controls real audio routing; Freeze holds effects while audio/camera continue; Boost releases cleanly');

  console.log('Saving angles and building a smooth camera tour...');
  await page.locator('#enterSpace').click(); await page.locator('#cameraToggle').click();
  const first = await view(); await page.locator('#saveAngle').click();
  await page.waitForFunction(() => document.querySelector('#angleCount').textContent === '1 / 4');
  await page.locator('.angleCard input').first().fill('Doorway'); await page.locator('.angleCard input').first().press('Tab');
  const stage = await page.locator('#stage').boundingBox();
  await page.mouse.move(stage.x + 80, stage.y + stage.height / 2); await page.mouse.down(); await page.mouse.move(stage.x + 160, stage.y + stage.height / 2 + 10, { steps: 8 }); await page.mouse.up();
  await page.keyboard.down('w'); await page.waitForTimeout(500); await page.keyboard.up('w');
  const second = await view(); await page.locator('#saveAngle').click();
  await page.waitForFunction(() => document.querySelector('#angleCount').textContent === '2 / 4');
  assert.equal(await page.locator('#angleList img').count(), 2);
  assert.equal(await page.locator('#tourCamera').isDisabled(), false);
  await slider('#tourDuration', 4); await page.locator('#tourCamera').click(); await page.waitForTimeout(1000);
  const between = await view();
  assert(distance(between.position, second.position) > 0.04);
  assert(distance(between.position, first.position) < distance(second.position, first.position));
  assert(await page.evaluate(() => [...__splatitude.getView().position, ...__splatitude.getView().target].every(Number.isFinite)));
  assert.equal(await page.evaluate(() => __splatitude.state().live), true);
  const paceBefore = await view(); await slider('#tourDuration', 20);
  assert(distance((await view()).position, paceBefore.position) < 0.03, 'changing tour pace continues from the current pose');
  await slider('#tourDuration', 4);
  await page.waitForTimeout(3300); assert((await page.locator('#cameraStatus').textContent()).includes('Tour'));
  await page.locator('#stopCamera').click(); await page.locator('#closeCamera').click();
  await page.keyboard.press('7'); await page.waitForTimeout(1100);
  assert(distance((await view()).position, first.position) < 0.002, 'bookmark shortcut lands at the saved position');
  await page.keyboard.press('g'); const driftStart = await view(); await page.waitForTimeout(1000);
  const driftEnd = await view(); assert(distance(driftStart.position, driftEnd.position) < 0.001);
  assert(distance(driftStart.target, driftEnd.target) > 0.03, 'drift looks around without leaving the interior');
  await page.keyboard.down('w'); await page.waitForTimeout(200); await page.keyboard.up('w');
  assert.equal(await page.locator('#driftCamera').getAttribute('aria-pressed'), 'false', 'manual movement takes over');
  await page.locator('#cameraToggle').click(); await page.screenshot({ path: 'verification/creative-desktop.png' });
  checks.push('Two real preview bookmarks save/rename; tour interpolates; 7 recalls a view; drift stays inside and yields to movement');

  console.log('Checking persistence, scan isolation, preset mix and phone controls...');
  await page.locator('#closeCamera').click();
  await page.locator(`[data-asset="${assets[1].id}"]`).click(); await loaded();
  assert.equal(await page.locator('#angleCount').textContent(), '0 / 4');
  assert.equal(await page.evaluate(() => __splatitude.state().live), true);
  await page.locator(`[data-asset="${assets[0].id}"]`).click(); await loaded();
  assert.equal(await page.locator('#angleCount').textContent(), '2 / 4');
  await slider('#lowMix', 1.35); await slider('#midMix', 0.7); await slider('#highMix', 1.6);
  await slider('#masterIntensity', 1.27);
  await page.locator('[data-look="liquid"]').click();
  const presetView = await view();
  const download = page.waitForEvent('download'); await page.locator('#saveSession').click();
  await (await download).saveAs('verification/creative-session.json');
  await slider('#lowMix', 0); await page.locator('[data-look="prism"]').click(); await page.locator('#presetFile').setInputFiles('verification/creative-session.json');
  await page.waitForFunction(() => __splatitude.state().bands.low === 1.35);
  await page.waitForFunction(() => document.querySelector('[data-look="liquid"]').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.locator('#lookNote').textContent(), 'Slow, rolling waves');
  assert.deepEqual(await page.evaluate(() => __splatitude.state().bands), { low: 1.35, mid: 0.7, high: 1.6 });
  assert(distance((await view()).position, presetView.position) < 0.002, 'preset restores the interior camera');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('splatitude.bands')).low === 1.35 && localStorage.getItem('splatitude.mix') === '1.27');
  // Changing controls and reopening a preset within one UI refresh must still
  // replace the saved settings, even when the restored values equal the last frame.
  await page.evaluate(preset => {
    for (const id of ['lowMix', 'masterIntensity']) {
      const input = document.getElementById(id); input.value = 0; input.dispatchEvent(new Event('input'));
    }
    __bench.applyPreset(preset);
  }, JSON.parse(await readFile('verification/creative-session.json', 'utf8')));
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('splatitude.bands')).low === 1.35 && localStorage.getItem('splatitude.mix') === '1.27');
  await page.locator('#present').click(); await page.keyboard.press('m'); await page.keyboard.down('b');
  await page.waitForTimeout(150); assert((await page.locator('#performanceHud').textContent()).includes('FROZEN'));
  await page.keyboard.up('b'); await page.keyboard.press('m'); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1366, height: 768 });
  assert(await page.locator('#masterIntensity').isVisible()); await page.screenshot({ path: 'verification/creative-laptop.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#cameraToggle').click();
  assert(await page.locator('#cameraPanel').isVisible()); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // Capture the actual phone viewport; a full-page shot resizes the live WebGL
  // canvas during capture and can stall Chrome's compositor on larger scans.
  await page.screenshot({ path: 'verification/creative-mobile.png' });
  await page.locator('#closeCamera').click(); await page.locator('#connectAudio').click(); await page.evaluate(() => __tone.context.close());
  await page.goto(`${base}/?debug=1&scene=${assets[0].id}`); await loaded();
  assert.equal(await page.locator('#angleCount').textContent(), '2 / 4');
  assert.equal(await page.locator('.angleCard input').first().inputValue(), 'Doorway');
  assert.deepEqual(await page.evaluate(() => __splatitude.state().bands), { low: 1.35, mid: 0.7, high: 1.6 });
  assert.equal(await page.evaluate(() => __splatitude.state().look), 'liquid');
  assert.equal(await page.evaluate(() => __splatitude.state().mix), 1.27);
  await waitForRendered(page);
  checks.push('Angles persist per scan and after reload; rapid preset loads save frequency mix and intensity; fullscreen shortcuts and responsive panels work');
  assert.deepEqual({ errors, external }, { errors: [], external: [] });
  await writeFile('verification/creative-report.json', JSON.stringify({ checks, errors, external, captureTest: 'Synthetic audio stream; native system picker remains manual' }, null, 2));
  console.log('PASS: ' + checks.join('; '));
} catch (error) { console.error(error, errors); await page.screenshot({ path: 'verification/creative-failure.png' }).catch(() => {}); process.exitCode = 1; }
finally { await browser.close(); }
