import { LOOKS, CONTROLLED_IDS, FEELS } from './looks.mjs';
import { mountNavigation } from './navigation.mjs';
import { mountPerformance } from './performance.mjs';
import { mountCameraDirector } from './camera-director.mjs';

const $ = id => document.getElementById(id);
const prefs = {
  read(key, fallback) { try { return JSON.parse(localStorage.getItem(`splatitude.${key}`)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(`splatitude.${key}`, JSON.stringify(value)); return true; } catch { return false; } },
};
const number = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
const fmtSize = bytes => `${Math.round(bytes / 1024 / 1024)} MB`;

export async function mountSplatitude(api) {
  // Keep the scene before its controls when the narrow layout becomes a document.
  $('performancePanel').before($('stage'));
  const navigation = mountNavigation(api);
  let library = [], selected = null, busy = false, toastTimer, lastFile = null;
  let lookId = prefs.read('look', 'pulse'), feelId = prefs.read('feel', 'balanced');
  let homeView = null, lastState = null;
  const names = prefs.read('names', {}), views = prefs.read('views.v2', {}), thumbnails = prefs.read('thumbnails', {});
  if (!FEELS[feelId]) feelId = 'balanced';
  if (!LOOKS.some(look => look.id === lookId)) lookId = 'pulse';
  const notify = (message, error = false) => {
    $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 5000);
  };
  const liveControls = mountPerformance(api, prefs);
  const cameraDirector = mountCameraDirector(api, navigation, prefs, notify);
  function renderLook(look) {
    $('lookNote').textContent = look.note;
    document.querySelectorAll('[data-look]').forEach(button => {
      const active = button.dataset.look === look.id;
      button.classList.toggle('selected', active); button.setAttribute('aria-pressed', active);
    });
    document.documentElement.style.setProperty('--look-color', look.color);
  }
  function chooseLook(id) {
    if (api.state().rendering) { notify('Wait for the video export to finish.'); return; }
    const look = LOOKS.find(item => item.id === id);
    if (!look) return;
    lookId = id; api.applyLook(look, CONTROLLED_IDS, FEELS[feelId]); prefs.write('look', id); renderLook(look);
  }
  for (const [index, look] of LOOKS.entries()) {
    const button = document.createElement('button');
    button.dataset.look = look.id; button.style.setProperty('--card-color', look.color);
    button.setAttribute('aria-label', `${look.name}: ${look.note}`);
    button.innerHTML = `<span class="lookArt" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="lookLabel">${look.name}<small>0${index + 1}</small></span>`;
    button.onclick = () => chooseLook(look.id); $('lookGrid').appendChild(button);
  }
  function renderLibrary() {
    $('libraryCount').textContent = String(library.length).padStart(2, '0');
    $('libraryList').replaceChildren();
    if (!library.length) {
      const empty = document.createElement('p'); empty.className = 'emptyLibrary';
      empty.textContent = 'No finished exports found yet. Open a splat file, or add a library folder in the local settings.';
      $('libraryList').appendChild(empty);
    }
    for (const asset of library) {
      const card = document.createElement('div'); card.className = 'splatCard';
      card.classList.toggle('selected', asset.id === selected?.id);
      const button = document.createElement('button'); button.className = 'splatCardOpen'; button.dataset.asset = asset.id;
      button.disabled = busy; button.setAttribute('aria-pressed', asset.id === selected?.id);
      const image = document.createElement('div'); image.className = 'splatThumb';
      if (typeof thumbnails[asset.id] === 'string' && thumbnails[asset.id].startsWith('data:image/webp;')) {
        image.style.backgroundImage = `url("${thumbnails[asset.id]}")`;
      } else { image.innerHTML = '<span class="spaceGlyph" aria-hidden="true">⌑</span><small>EXPLORE THIS SPACE</small>'; }
      const ready = document.createElement('span'); ready.className = 'readyTag'; ready.textContent = asset.id === selected?.id ? 'NOW PLAYING' : 'READY'; image.appendChild(ready);
      const title = document.createElement('strong'); title.textContent = names[asset.id] || asset.name;
      const info = document.createElement('span'); info.className = 'splatCardMeta';
      info.textContent = `${asset.source} · ${fmtSize(asset.bytes)}${asset.splats ? ` · ${(asset.splats / 1e6).toFixed(1)}M splats` : ''}`;
      button.append(image, title, info); button.onclick = () => chooseAsset(asset); card.appendChild(button);
      const rename = document.createElement('button'); rename.className = 'renameAsset'; rename.textContent = 'Rename';
      rename.setAttribute('aria-label', `Rename ${title.textContent}`);
      rename.onclick = () => {
        const input = document.createElement('input'); input.className = 'renameInput'; input.value = title.textContent;
        input.setAttribute('aria-label', 'Splat name'); input.maxLength = 60; card.appendChild(input); input.focus(); input.select();
        const save = () => {
          const name = input.value.trim(); if (name) names[asset.id] = name; prefs.write('names', names); renderLibrary();
          if (selected?.id === asset.id) $('sceneTitle').textContent = names[asset.id] || asset.name;
        };
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
          if (event.key === 'Escape') { input.onblur = null; input.remove(); } };
        input.onblur = save;
      };
      card.appendChild(rename); $('libraryList').appendChild(card);
    }
  }
  async function chooseAsset(asset) {
    if (busy || api.state().rendering || api.state().loading) return;
    cameraDirector.setAsset(null); liveControls.reset();
    busy = true; renderLibrary(); $('importSplat').disabled = true;
    $('sceneTitle').textContent = `Opening ${names[asset.id] || asset.name}…`;
    $('sceneInfo').textContent = `${fmtSize(asset.bytes)} · loading from your computer`;
    try {
      const loaded = await api.loadSplat(asset.url, names[asset.id] || asset.name, asset);
      if (!loaded) throw new Error(api.state().status || 'Could not load that splat.');
      selected = asset; homeView = api.getView();
      $('enterSpace').textContent = asset.shareCoordinates ? '⌂ Enter space' : '⌂ Reset view';
      navigation.setMode(asset.shareCoordinates && !document.body.classList.contains('advanced') ? 'walk' : 'orbit');
      document.body.classList.remove('library-open'); $('mobileLibrary').setAttribute('aria-expanded', 'false');
      if (views[asset.id]) api.setView(views[asset.id]);
      cameraDirector.setAsset(asset);
      prefs.write('selected', asset.id);
      const url = new URL(location.href); url.searchParams.set('scene', asset.id); history.replaceState(null, '', url);
      $('sceneTitle').textContent = names[asset.id] || asset.name;
      $('sceneCategory').textContent = asset.captureDate ? `CAPTURED ${asset.captureDate.replaceAll('-', '.')}` : 'YOUR CURRENT SPACE';
      $('sceneInfo').textContent = `${api.state().splats} splats · ${fmtSize(asset.bytes)} · ${asset.source}`;
      // Save a real preview once the GPU has had time to sort the new scene.
      setTimeout(async () => {
        if (selected?.id !== asset.id || api.state().loading || api.state().rendering) return;
        try {
          const thumbnail = await api.thumbnail();
          if (selected?.id !== asset.id || api.state().loading || api.state().rendering) return;
          thumbnails[asset.id] = thumbnail;
          const retained = Object.fromEntries(Object.entries(thumbnails).slice(-12));
          prefs.write('thumbnails', retained); renderLibrary();
        } catch { /* A preview is optional; loading and performance remain usable. */ }
      }, 2500);
    } catch (error) {
      notify(error.message, true); $('sceneTitle').textContent = 'That space could not open'; $('sceneInfo').textContent = 'Try another splat or refresh the library.';
    } finally { busy = false; $('importSplat').disabled = false; renderLibrary(); }
  }
  async function loadCatalog(initial = false) {
    $('refreshLibrary').disabled = true;
    try {
      const response = await fetch('/api/library', { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('The local library could not be read.');
      const data = await response.json(); library = data.assets || []; renderLibrary();
      if (initial && library.length) {
        const id = new URL(location.href).searchParams.get('scene') || prefs.read('selected', null);
        await chooseAsset(library.find(asset => asset.id === id) || library[0]);
      } else if (!initial) notify(`${library.length} completed splat${library.length === 1 ? '' : 's'} ready.`);
    } catch (error) { notify(error.message, true); $('libraryList').textContent = 'Library unavailable. You can still open a splat file.'; }
    finally { $('refreshLibrary').disabled = false; }
  }
  $('refreshLibrary').onclick = () => loadCatalog();
  $('mobileLibrary').onclick = () => { const open = document.body.classList.toggle('library-open'); $('mobileLibrary').setAttribute('aria-expanded', open); };
  $('importSplat').onclick = () => api.openSplat();
  $('connectAudio').onclick = async () => {
    $('connectAudio').disabled = true;
    try {
      if (api.state().live) await api.stopSystemAudio(); else await api.startSystemAudio();
      if (!api.state().live && !api.state().liveStatus.startsWith('Choose')) notify(api.state().liveStatus, true);
    } finally { $('connectAudio').disabled = false; }
  };
  $('openTrack').onclick = () => api.startFile();
  $('trackPlay').onclick = () => api.play();
  $('saveSession').onclick = () => api.savePreset();
  $('openSession').onclick = () => api.openPreset();
  $('homeView').onclick = () => { cameraDirector.stop(); if (selected) api.setView(views[selected.id] || homeView); else if (homeView) api.setView(homeView); };
  $('enterSpace').onclick = () => {
    navigation.setMode('walk'); if (homeView) api.setView(homeView);
    notify('Back inside. Drag to look; WASD or arrows to move.');
  };
  $('saveView').onclick = () => {
    if (!selected) { notify('Choose a library splat first.'); return; }
    views[selected.id] = api.getView(); prefs.write('views.v2', views); notify('View saved for this space.');
  };
  $('masterIntensity').value = number(prefs.read('mix', 1), 0, 2, 1);
  $('liveSensitivity').value = number(prefs.read('sensitivity', 2), 0.25, 8, 2);
  function mixChanged() { const value = Number($('masterIntensity').value); api.setMix(value); prefs.write('mix', value); }
  function sensitivityChanged() { const value = Number($('liveSensitivity').value); api.setSensitivity(value); prefs.write('sensitivity', value); }
  $('masterIntensity').oninput = mixChanged; $('liveSensitivity').oninput = sensitivityChanged;
  $('bypassEffects').onclick = () => api.setBypass(!api.state().bypass);
  document.querySelectorAll('[data-feel]').forEach(button => {
    button.classList.toggle('selected', button.dataset.feel === feelId);
    button.onclick = () => {
      feelId = button.dataset.feel; api.setFeel(FEELS[feelId]); prefs.write('feel', feelId);
      document.querySelectorAll('[data-feel]').forEach(item => item.classList.toggle('selected', item === button));
    };
  });
  $('advancedToggle').onclick = () => {
    const active = document.body.classList.toggle('advanced');
    $('advancedToggle').setAttribute('aria-pressed', active); api.resize();
    navigation.setMode(active ? 'orbit' : selected?.shareCoordinates ? 'walk' : 'orbit');
    if (active) { document.querySelector('[data-group="audio"]').open = true; $('rail').scrollTop = 0; }
  };
  function present(on) { document.body.classList.toggle('performing', on); document.body.classList.remove('hud-hidden'); api.resize(); }
  $('present').onclick = () => present(true); $('exitPerformance').onclick = () => present(false);
  $('fullScreen').onclick = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { notify('Fullscreen is unavailable in this browser.', true); }
  };
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.altKey || event.metaKey || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (event.code === 'Escape') present(false);
    if (event.code === 'KeyH') { event.preventDefault(); present(!document.body.classList.contains('performing')); }
    if (!document.body.classList.contains('advanced') && /^Digit[1-6]$/.test(event.code)) chooseLook(LOOKS[Number(event.code.slice(5)) - 1].id);
  });
  const canvas = $('frequencyCanvas'), ctx = canvas.getContext('2d');
  function drawSpectrum(state) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 48, gap = 5, width = (canvas.width - (bars - 1) * gap) / bars;
    for (let i = 0; i < bars; i++) {
      const frequency = Math.round(1 + Math.pow(i / (bars - 1), 2.1) * 350);
      const level = state.live && state.spectrum ? state.spectrum[frequency] / 255
        : state.hasAudio ? state.levels[['low', 'mid', 'high'][Math.min(2, Math.floor(i / 16))]] : 0;
      const height = Math.max(3, level * (canvas.height - 8));
      ctx.fillStyle = i < 16 ? '#c7f582' : i < 32 ? '#80d9d2' : '#f2b291';
      ctx.globalAlpha = level ? 0.8 : 0.17;
      ctx.beginPath(); ctx.roundRect(i * (width + gap), canvas.height - height, width, height, 3); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function update() {
    const state = api.state();
    liveControls.update(state);
    const hud = [LOOKS.find(look => look.id === state.look)?.name, state.live ? 'LIVE' : state.hasAudio ? 'TRACK' : '', state.frozen ? 'FROZEN' : '', state.boosted ? 'BOOST' : '', cameraDirector.state().mode !== 'manual' ? cameraDirector.state().mode.toUpperCase() : ''].filter(Boolean).join(' · ');
    if ($('performanceHud').textContent !== hud) $('performanceHud').textContent = hud;
    if (state.hasAudio && state.audioName !== lastFile) {
      lastFile = state.audioName;
      if (!state.playing) api.play();
      notify('Track ready. Your space is listening.');
    }
    $('connectAudio').classList.toggle('connected', state.live);
    $('connectAudio').children[1].textContent = state.live ? 'Stop system audio' : 'Use system audio';
    $('sourceBadge').textContent = state.live ? 'LIVE' : state.hasAudio ? 'TRACK' : 'READY';
    $('sourceBadge').classList.toggle('live', state.live);
    $('sourceName').textContent = state.live ? 'Listening to your system audio' : state.hasAudio ? state.audioName : 'Waiting for sound';
    $('audioGuide').hidden = state.live || state.hasAudio;
    $('footerState').textContent = state.loading ? state.status : state.live ? 'Live input. Let the space move.' : state.hasAudio ? state.playing ? 'Track playing · your world, on repeat.' : 'Track paused' : 'Choose a space. Bring the music.';
    $('audioDot').classList.toggle('live', state.live || (state.hasAudio && state.playing));
    $('performanceSplats').textContent = `${state.splats} SPLATS`;
    $('performanceFps').textContent = `${state.fps} FPS`;
    $('trackPlay').disabled = !state.hasAudio;
    $('trackPlay').innerHTML = state.playing ? 'Ⅱ <span>Pause track</span>' : '▶ <span>Play track</span>';
    $('intensityValue').innerHTML = `${Math.round(state.mix * 100)}<span>%</span>`;
    $('masterIntensity').value = state.mix;
    $('sensitivityValue').textContent = Number($('liveSensitivity').value).toFixed(1) + '×';
    $('bypassEffects').classList.toggle('selected', state.bypass); $('bypassEffects').setAttribute('aria-pressed', state.bypass);
    if (state.look !== lookId && LOOKS.some(look => look.id === state.look)) {
      lookId = state.look; prefs.write('look', lookId); renderLook(LOOKS.find(look => look.id === lookId));
    }
    if (state.mix !== lastState?.mix) prefs.write('mix', state.mix);
    if (lastState?.live && !state.live) notify('System audio disconnected.');
    if (state.asset && !state.loading && state.asset !== lastState?.asset && !busy && state.asset !== (names[selected?.id] || selected?.name)) {
      selected = null; homeView = api.getView(); cameraDirector.setAsset(null); liveControls.reset(); navigation.setMode('orbit'); $('enterSpace').textContent = '⌂ Reset view'; $('sceneTitle').textContent = state.asset;
      $('sceneInfo').textContent = `${state.splats} splats · local file`; renderLibrary();
    }
    lastState = state; drawSpectrum(state);
  }
  chooseLook(lookId); mixChanged(); sensitivityChanged(); api.resize(); update();
  const timer = setInterval(update, 100);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
  // Keyboard H is handled above; keep the engine's editor shortcut from hiding
  // only half of the new performance shell.
  const observer = new MutationObserver(() => { if (document.body.classList.contains('hud-hidden')) document.body.classList.remove('hud-hidden'); });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  await loadCatalog(true);
}
