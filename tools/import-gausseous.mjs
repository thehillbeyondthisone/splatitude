// One-time import of the reviewed local Gausseous build; not run on install.
// Source provenance and license are documented in THIRD_PARTY.md.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const source = path.resolve(process.argv[2] || '../experiments/martial-arts-splatsonia/gausseous/index.html');
let html = (await readFile(source, 'utf8')).replace(/\r\n/g, '\n');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!match) throw new Error('Missing upstream engine');
let engine = match[1].replace('./live-audio.mjs', './live-audio.mjs');
engine = engine.replaceAll('`gausseous-', '`splatitude-');
engine = `import { mountSplatitude } from './app.mjs';\n` + engine;
engine = engine.replace('const controls = new OrbitControls', 'let performanceNavigation = "orbit";\nconst controls = new OrbitControls');
engine = engine.replace('controls.enabled = !gestureOn && !draggingGizmo && !pickOn;', 'controls.enabled = performanceNavigation !== "walk" && !gestureOn && !draggingGizmo && !pickOn;');
engine = engine.replace('let liveAudio = null;', 'let liveAudio = null;\nlet performanceMix = 1, performanceBypass = false, performanceLook = "pulse", splatLoading = false;\nlet performanceIds = new Set();');
engine = engine.replace('a.depth * (hi - lo)', 'a.depth * performanceMix * (hi - lo)');
engine = engine.replace('    V[id] = v;', '    V[id] = performanceBypass && !NO_ANIM.has(id) && !id.startsWith("ob") && id !== "ease" ? Number(DEFAULT[id]) : v;');
engine = engine.replace('U.time.value    = playhead * V.dur;', 'U.time.value    = liveAudio?.active ? (performance.now() / 1000 - liveAudio.startedAt) : playhead * V.dur;');
// Room scans can include distant outliers. The performance looks should not
// displace an interior by metres just because the bounding sphere is large.
engine = engine.replace('U.dAmt.value    = V.dAmt * radius;', 'U.dAmt.value    = V.dAmt * (performanceIds.has("dAmt") ? Math.min(radius, 8) : radius);');
engine = engine.replace('async function loadSplat(source, label) {', 'async function loadSplat(source, label, viewOptions = {}) {\n  if (splatLoading) return false;');
engine = engine.replace('  if (mesh) { scene.remove(mesh); mesh.dispose?.(); mesh = null; }', '  splatLoading = true;\n  if (mesh) { scene.remove(mesh); mesh.dispose?.(); mesh = null; }');
engine = engine.replace('if (source === "/studio.ply") studioInteriorView();', 'if (viewOptions.shareCoordinates) setShareHome(viewOptions);');
engine = engine.replace('    setStatus(`${label} — ${n} gaussians.`);', '    setStatus(`${label} — ${n} gaussians.`);\n    return true;');
engine = engine.replace('if (mesh) { scene.remove(mesh); mesh = null; }\n  }\n}', 'if (mesh) { scene.remove(mesh); mesh.dispose?.(); mesh = null; }\n    return false;\n  } finally { splatLoading = false; }\n}');
engine = engine.replace('if (rendering) { setStatus("Wait for the video export to finish.", true); return; }', 'if (liveAudio?.active) return;\n  if (rendering) { setStatus("Wait for the video export to finish.", true); return; }');
engine = engine.replace('    $("audBassNoise").click();', '    liveAudio.startedAt = performance.now() / 1000;\n    // Keep the selected performance look and its routes when connecting.');
engine = engine.replace('    asset: assetLabel,', '    performance: { mix: performanceMix, bypass: performanceBypass, look: performanceLook },\n    asset: assetLabel,');
engine = engine.replace('  applyPreset.migrationNotes = [];', '  if (Number.isFinite(o?.performance?.mix)) performanceMix = clampNum(o.performance.mix, 0, 2);\n  performanceBypass = o?.performance?.bypass === true;\n  if (typeof o?.performance?.look === "string") performanceLook = o.performance.look;\n  applyPreset.migrationNotes = [];');
engine = engine.replace('  const code = e.code;\n\n  if (code === "Escape")', '  const code = e.code;\n  if (performanceNavigation === "walk" && /^(Key[WASDQER]|Arrow(Up|Down|Left|Right))$/.test(code)) return;\n  if (!document.body.classList.contains("advanced") && /^Digit[1-6]$/.test(code)) return;\n\n  if (code === "Escape")');
const auto = 'if (new URLSearchParams(location.search).get("studio") === "1") {\n  loadSplat("/studio.ply", "Martial Arts Studio — SHARE 30");\n}';
if (!engine.includes(auto)) throw new Error('Missing expected startup hook');
engine = engine.replace(auto, await readFile('src/bridge.fragment.txt', 'utf8'));
html = html.replace(match[0], '<script type="module" src="/src/engine.mjs"></script>');
html = html.replace('<title>GAUSSEOUS — 3DGS manipulator</title>', '<title>Splatitude — your space, in sound</title>\n<meta name="description" content="A local music playground for your Gaussian splats. Explore real places through sound.">');
html = html.replace('</head>', '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<link rel="stylesheet" href="/src/splatitude.css">\n</head>');
html = html.replace('<body>', '<body>\n' + await readFile('src/shell.html', 'utf8'));
html = html.replace('<h1>Gausseous</h1>', '<h1>Your next world is waiting.</h1>');
await writeFile('src/engine.mjs', engine.trimEnd() + '\n');
await writeFile('index.html', html.trimEnd() + '\n');
