export function mountPerformance(api, prefs) {
  const freeze = document.getElementById('freezeVisuals'), boost = document.getElementById('boostVisuals');
  const sliders = [...document.querySelectorAll('[data-band-mix]')];
  const saved = prefs.read('bands', {});
  let previousBands = '';
  function persistBands(bands) { previousBands = JSON.stringify(bands); prefs.write('bands', bands); }
  api.setBands(Object.fromEntries(['low', 'mid', 'high'].map(band => [band, Number.isFinite(saved[band]) ? saved[band] : 1])));
  for (const slider of sliders) slider.oninput = () => {
    api.setBands({ [slider.dataset.bandMix]: Number(slider.value) }); persistBands(api.state().bands);
  };
  document.getElementById('resetBands').onclick = () => { api.setBands({ low: 1, mid: 1, high: 1 }); persistBands(api.state().bands); };
  freeze.onclick = () => api.setFrozen(!api.state().frozen);
  boost.addEventListener('pointerdown', event => { event.preventDefault(); boost.setPointerCapture(event.pointerId); api.setBoost(true); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) boost.addEventListener(type, () => api.setBoost(false));
  for (const type of ['keydown', 'keyup']) boost.addEventListener(type, event => {
    if (!['Space', 'Enter'].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation(); api.setBoost(type === 'keydown');
  });
  const editable = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  addEventListener('keydown', event => {
    if (editable() || event.ctrlKey || event.metaKey || event.altKey || document.body.classList.contains('advanced')) return;
    if (event.code === 'KeyB') { event.preventDefault(); api.setBoost(true); }
    if (event.code === 'KeyM' && !event.repeat) { event.preventDefault(); freeze.click(); }
  });
  addEventListener('keyup', event => {
    if (event.code === 'KeyB') api.setBoost(false);
  });
  addEventListener('blur', () => api.setBoost(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) api.setBoost(false); });
  return {
    reset() { api.setBoost(false); api.setFrozen(false); },
    update(state) {
      const bands = JSON.stringify(state.bands);
      if (bands !== previousBands) persistBands(state.bands);
      freeze.setAttribute('aria-pressed', state.frozen); freeze.classList.toggle('selected', state.frozen);
      freeze.innerHTML = state.frozen ? 'Unfreeze <kbd>M</kbd>' : 'Freeze <kbd>M</kbd>';
      boost.classList.toggle('selected', state.boosted); boost.setAttribute('aria-pressed', state.boosted);
      freeze.disabled = boost.disabled = state.loading || state.rendering || !state.asset;
      for (const slider of sliders) {
        const value = state.bands[slider.dataset.bandMix]; slider.value = value;
        document.getElementById(`${slider.dataset.bandMix}MixValue`).textContent = `${Math.round(value * 100)}%`;
      }
    },
  };
}
