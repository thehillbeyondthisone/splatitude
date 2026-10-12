// Local live-audio analysis. The capture stream is never connected to speakers.
export class LiveAudioDrive {
  constructor(bands) {
    this.bands = bands;
    this.active = false;
    this.levels = Object.fromEntries(Object.keys(bands).map(band => [band, 0]));
    this.history = [];
    this.routes = new Map();
    this.sensitivity = 2;
  }

  async attach(stream, onEnded) {
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('No audio was shared. Choose Entire screen and enable Share system audio.');
    }
    this.stream = stream;
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    this.sink = this.context.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.context.destination);
    this.spectrumNode = this.context.createAnalyser();
    this.spectrumNode.fftSize = 1024;
    this.spectrumNode.smoothingTimeConstant = 0.8;
    this.spectrum = new Uint8Array(this.spectrumNode.frequencyBinCount);
    this.source.connect(this.spectrumNode); this.spectrumNode.connect(this.sink);
    this.nodes = {};
    for (const [band, [lo, hi]] of Object.entries(this.bands)) {
      const hp = this.context.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = lo; hp.Q.value = 0.7;
      const lp = this.context.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.min(hi, this.context.sampleRate * 0.45); lp.Q.value = 0.7;
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      this.source.connect(hp); hp.connect(lp); lp.connect(analyser); analyser.connect(this.sink);
      this.nodes[band] = { analyser, samples: new Float32Array(analyser.fftSize), peak: 0.08 };
    }
    // Keep the browser capture session alive, without consuming video frames.
    stream.getVideoTracks().forEach(track => { track.enabled = false; });
    this.onEnded = () => { if (this.active) onEnded?.(); };
    stream.getTracks().forEach(track => track.addEventListener('ended', this.onEnded));
    this.active = true;
  }

  update(seconds) {
    if (!this.active) return;
    const dt = Math.max(0, Math.min(0.1, seconds - (this.time ?? seconds)));
    this.time = seconds;
    this.spectrumNode.getByteFrequencyData(this.spectrum);
    for (const [band, node] of Object.entries(this.nodes)) {
      node.analyser.getFloatTimeDomainData(node.samples);
      let sum = 0;
      for (const sample of node.samples) sum += sample * sample;
      const rms = Math.sqrt(sum / node.samples.length);
      node.peak = Math.max(0.08, rms, node.peak * Math.exp(-dt / 3));
      this.levels[band] = rms < 0.001 ? 0 : Math.min(1, rms * this.sensitivity / node.peak);
    }
    this.history.push({ time: seconds, levels: { ...this.levels } });
    while (this.history.length > 1 && this.history[0].time < seconds - 1) this.history.shift();
  }

  level(id, route) {
    if (!this.active || !route.band || !Number.isFinite(this.time)) return 0;
    const target = this.time - Math.max(0, route.lag || 0) / 1000;
    let sample = null;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].time <= target) { sample = this.history[i]; break; }
    }
    let value = sample?.levels[route.band] || 0;
    if (value < route.floor) value = 0;
    value = Math.min(1, Math.pow(Math.max(0, value * route.gain), route.curve));
    const previous = this.routes.get(id) || { value: 0, time: this.time - 1 / 60 };
    const dt = Math.max(0, Math.min(0.1, this.time - previous.time));
    const tau = (value >= previous.value ? route.attack : route.release) / 1000;
    const alpha = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    const next = { value: previous.value + alpha * (value - previous.value), time: this.time };
    this.routes.set(id, next);
    return next.value;
  }

  async dispose() {
    this.active = false;
    for (const track of this.stream?.getTracks() || []) {
      track.removeEventListener('ended', this.onEnded);
      track.stop();
    }
    this.source?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.history = []; this.routes.clear();
  }
}
