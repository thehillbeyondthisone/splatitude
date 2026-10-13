const movementKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const editable = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

export function mountNavigation(api) {
  const stage = document.getElementById('stage'), keys = new Set();
  let mode = 'orbit', drag = null, previous = performance.now(), fast = false;
  stage.tabIndex = 0;
  stage.setAttribute('aria-label', '3D space. In Walk mode, drag to look; use W A S D or arrow keys to move, Q and E for height.');
  const active = () => mode === 'walk' && !document.body.classList.contains('advanced') && !api.state().loading && !api.state().rendering && !!api.state().asset;
  function clear() { keys.clear(); fast = false; drag = null; }
  function setMode(value) {
    dispatchEvent(new Event('splatitude-camera-input'));
    clear(); mode = value === 'walk' ? 'walk' : 'orbit';
    if (mode === 'walk' && document.body.classList.contains('advanced')) {
      document.body.classList.remove('advanced');
      document.getElementById('advancedToggle').setAttribute('aria-pressed', 'false'); api.resize();
    }
    api.setNavigation(mode); document.body.classList.toggle('walking', mode === 'walk');
    document.querySelectorAll('[data-navigation]').forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.navigation === mode);
    });
    document.getElementById('navigationHint').textContent = mode === 'walk'
      ? 'Drag to look · WASD / arrows to move · Q / E height · Shift faster · wheel to move'
      : 'Drag to orbit · right-drag to pan · wheel to zoom';
    document.querySelector('.libraryFooter .muted').textContent = mode === 'walk' ? 'Drag to look · WASD to move' : 'Drag to orbit · scroll to zoom';
  }
  document.querySelectorAll('[data-navigation]').forEach(button => { button.onclick = () => setMode(button.dataset.navigation); });
  stage.addEventListener('pointerdown', event => {
    if (!active() || event.button !== 0 || (event.target !== stage && event.target.tagName !== 'CANVAS')) return;
    event.preventDefault(); stage.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId || !active()) return;
    api.look((event.clientX - drag.x) * -0.003, (event.clientY - drag.y) * -0.003);
    drag.x = event.clientX; drag.y = event.clientY;
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, () => { drag = null; });
  stage.addEventListener('wheel', event => {
    if (!active() || event.ctrlKey) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
    api.move(Math.max(-1.5, Math.min(1.5, -pixels * 0.003)), 0, 0);
  }, { passive: false });
  addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || editable() || !active()) return;
    if (event.code === 'KeyR') { event.preventDefault(); document.getElementById('enterSpace').click(); return; }
    fast = event.shiftKey;
    if (!movementKeys.has(event.code)) return;
    event.preventDefault(); keys.add(event.code);
  });
  addEventListener('keyup', event => { keys.delete(event.code); fast = event.shiftKey; });
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  for (const button of document.querySelectorAll('[data-walk]')) {
    button.addEventListener('pointerdown', event => {
      if (!active()) return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(button.dataset.walk);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => keys.delete(button.dataset.walk));
  }
  let frame;
  function update(now) {
    const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
    if (keys.size && active() && !editable()) {
      const held = (...codes) => codes.some(code => keys.has(code)) ? 1 : 0;
      let forward = held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown');
      let right = held('KeyD', 'ArrowRight') - held('KeyA', 'ArrowLeft');
      let up = held('KeyE') - held('KeyQ');
      const distance = Math.hypot(forward, right, up) || 1, speed = dt * (fast ? 4.5 : 1.5) / distance;
      api.move(forward * speed, right * speed, up * speed);
    }
    frame = requestAnimationFrame(update);
  }
  frame = requestAnimationFrame(update);
  addEventListener('pagehide', () => { cancelAnimationFrame(frame); clear(); }, { once: true });
  return { setMode, clear, getMode: () => mode };
}
