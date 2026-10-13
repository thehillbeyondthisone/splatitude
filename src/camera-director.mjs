const $ = id => document.getElementById(id);
const validView = view => [view?.position, view?.target].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite));
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const editable = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

export function mountCameraDirector(api, navigation, prefs, notify) {
  const saved = prefs.read('angles.v1', {});
  let asset = null, angles = [], motion = null, capturing = false, generation = 0;
  $('tourDuration').value = Math.max(4, Math.min(30, Number(prefs.read('tourDuration', 10)) || 10));
  function status() {
    $('driftCamera').setAttribute('aria-pressed', motion?.mode === 'drift');
    $('tourCamera').setAttribute('aria-pressed', motion?.mode === 'tour');
    $('cameraToggle').classList.toggle('active', !!motion);
    $('cameraStatus').textContent = motion?.mode === 'tour' ? `Tour · ${angles[motion.index]?.name || 'next angle'}`
      : motion?.mode === 'drift' ? 'Drifting in place · drag to take over'
      : motion ? 'Moving to your angle…' : 'Manual camera · your move';
    $('tourDurationValue').textContent = `${$('tourDuration').value}s / angle`;
    $('tourCamera').disabled = !asset || angles.length < 2;
    $('driftCamera').disabled = !asset;
    $('saveAngle').disabled = !asset || capturing || angles.length >= 4;
  }
  function stop() { motion = null; status(); }
  function persist() {
    if (!asset) return;
    saved[asset.id] = angles;
    if (!prefs.write('angles.v1', saved)) notify('These angles work for this session, but the browser could not save them.', true);
  }
  function render() {
    $('angleList').replaceChildren();
    for (let index = 0; index < 4; index++) {
      const angle = angles[index], card = document.createElement('div'); card.className = 'angleCard';
      const button = document.createElement('button'); button.dataset.angle = index;
      button.disabled = !asset || capturing;
      button.setAttribute('aria-label', angle ? `Go to ${angle.name}` : `Save angle ${index + 1}`);
      if (angle?.image?.startsWith('data:image/webp;')) {
        const image = new Image(); image.src = angle.image; image.alt = ''; button.appendChild(image);
      } else button.innerHTML = '<span aria-hidden="true">＋</span>';
      const number = document.createElement('small'); number.textContent = `0${index + 1}`; button.appendChild(number);
      button.onclick = () => angle ? jump(index) : capture(); card.appendChild(button);
      if (angle) {
        const name = document.createElement('input'); name.value = angle.name; name.maxLength = 32;
        name.setAttribute('aria-label', `Rename angle ${index + 1}`);
        name.onchange = () => { angle.name = name.value.trim() || `Angle ${index + 1}`; persist(); render(); };
        card.appendChild(name);
        const remove = document.createElement('button'); remove.className = 'deleteAngle'; remove.textContent = '×';
        remove.setAttribute('aria-label', `Delete ${angle.name}`);
        remove.onclick = () => { stop(); angles.splice(index, 1); persist(); render(); }; card.appendChild(remove);
      } else {
        const label = document.createElement('span'); label.className = 'emptyAngle'; label.textContent = asset ? 'Save this view' : 'Choose a space'; card.appendChild(label);
      }
      $('angleList').appendChild(card);
    }
    $('angleCount').textContent = `${angles.length} / 4`; status();
  }
  async function capture() {
    if (!asset || capturing || angles.length >= 4 || api.state().loading || api.state().rendering) return;
    stop(); capturing = true; render();
    const token = generation, pose = api.getView();
    let image;
    try { image = await api.thumbnail(); } catch { /* A pose remains useful without an image. */ }
    if (token !== generation) { capturing = false; render(); return; }
    angles.push({ name: `Angle ${angles.length + 1}`, view: pose, image });
    capturing = false; persist(); render(); notify('Angle saved. Add another to build a tour.');
  }
  function prepare() {
    if (!asset || api.state().loading || api.state().rendering) return false;
    navigation.setMode('walk'); return true;
  }
  function jump(index) {
    if (!angles[index] || !prepare()) return;
    motion = { mode: 'jump', from: api.getView(), to: angles[index].view, start: performance.now(), duration: 0.9 }; status();
  }
  function drift() {
    if (motion?.mode === 'drift') { stop(); return; }
    if (!prepare()) return;
    motion = { mode: 'drift', from: api.getView(), start: performance.now() }; status();
  }
  function tour() {
    if (motion?.mode === 'tour') { stop(); return; }
    if (angles.length < 2 || !prepare()) return;
    const from = api.getView();
    const index = distance(from.position, angles[0].view.position) < 0.01 && distance(from.target, angles[0].view.target) < 0.05 ? 1 : 0;
    motion = { mode: 'tour', from, to: angles[index].view, index, start: performance.now() }; status();
  }
  $('cameraToggle').onclick = () => { const open = $('cameraPanel').hidden; $('cameraPanel').hidden = !open; $('cameraToggle').setAttribute('aria-expanded', open); };
  $('closeCamera').onclick = () => { $('cameraPanel').hidden = true; $('cameraToggle').setAttribute('aria-expanded', false); };
  $('saveAngle').onclick = capture; $('driftCamera').onclick = drift; $('tourCamera').onclick = tour; $('stopCamera').onclick = stop;
  $('tourDuration').oninput = () => {
    if (motion?.mode === 'tour') { motion.from = api.getView(); motion.start = performance.now(); }
    prefs.write('tourDuration', Number($('tourDuration').value)); status();
  };
  addEventListener('splatitude-camera-input', stop);
  $('stage').addEventListener('pointerdown', event => { if (event.target.tagName === 'CANVAS') stop(); }, { capture: true });
  $('stage').addEventListener('wheel', stop, { capture: true, passive: true });
  addEventListener('keydown', event => {
    if (event.code === 'Escape') { stop(); $('closeCamera').click(); }
    if (editable() || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^(Key[WASDQER]|Arrow(Up|Down|Left|Right))$/.test(event.code)) stop();
    if (document.body.classList.contains('advanced') || event.repeat) return;
    if (event.code === 'KeyG') { event.preventDefault(); drift(); }
    if (event.code === 'KeyT') { event.preventDefault(); tour(); }
    const index = ['Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(event.code);
    if (index >= 0) { event.preventDefault(); jump(index); }
  });
  let frame;
  function update(now) {
    if (motion) {
      const state = api.state();
      if (state.loading || state.rendering || document.body.classList.contains('advanced') || document.hidden) stop();
      else if (motion.mode === 'drift') {
        const seconds = (now - motion.start) / 1000, base = motion.from;
        const [dx, dy, dz] = base.target.map((v, i) => v - base.position[i]);
        const yaw = Math.sin(seconds * 0.18) * 0.23, c = Math.cos(yaw), s = Math.sin(yaw);
        const target = [base.position[0] + dx * c - dz * s, base.target[1] + Math.sin(seconds * 0.23) * 0.1, base.position[2] + dx * s + dz * c];
        api.blendView(base, { ...base, target }, 1);
      } else {
        const duration = motion.duration || Number($('tourDuration').value), t = Math.min(1, (now - motion.start) / (duration * 1000));
        api.blendView(motion.from, motion.to, t * t * (3 - 2 * t));
        if (t === 1) {
          if (motion.mode === 'jump') stop();
          else { motion.from = api.getView(); motion.index = (motion.index + 1) % angles.length; motion.to = angles[motion.index].view; motion.start = now; status(); }
        }
      }
    }
    frame = requestAnimationFrame(update);
  }
  frame = requestAnimationFrame(update);
  addEventListener('pagehide', () => cancelAnimationFrame(frame), { once: true });
  render();
  return {
    stop,
    setAsset(value) { generation++; stop(); asset = value; angles = Array.isArray(saved[value?.id]) ? saved[value.id].filter(angle => validView(angle?.view)).slice(0, 4) : []; capturing = false; render(); },
    state: () => ({ mode: motion?.mode || 'manual', angles: angles.length }),
  };
}
