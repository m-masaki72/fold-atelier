const clamp = (value) => Math.max(0, Math.min(1, value));
const midiHz = (note) => 440 * 2 ** ((note - 69) / 12);

export function paperTone(note, sampleRate = 24000, duration = 3.6) {
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  const frequency = midiHz(note);
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate,
      phase = 2 * Math.PI * frequency * t;
    const attack = 1 - Math.exp(-t / 0.035);
    const tail = Math.min(1, (duration - t) / 0.3);
    samples[i] =
      0.3 *
      attack *
      tail *
      (Math.sin(phase) * Math.exp(-t / (duration * 0.3)) +
        0.18 * Math.sin(phase * 2) * Math.exp(-t / 0.5) +
        0.045 * Math.sin(phase * 3) * Math.exp(-t / 0.18));
  }
  return samples;
}

export function paperRustle(seed = 1, sampleRate = 24000) {
  const duration = 0.42,
    samples = new Float32Array(Math.ceil(sampleRate * duration));
  let low = 0,
    slow = 0;
  for (let i = 0; i < samples.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = seed / 2147483648 - 1,
      t = i / sampleRate;
    low += 0.3 * (noise - low);
    slow += 0.035 * (noise - slow);
    const rub = Math.sin((Math.PI * t) / duration) ** 1.5;
    const crease = Math.exp(-(((t - 0.29) / 0.025) ** 2));
    const grain = 0.7 + 0.3 * Math.sin(t * 98) ** 2;
    samples[i] = (low - slow) * (0.25 * rub * grain + 0.13 * crease);
  }
  return samples;
}

// A paper sound is tied to the start of actual hinge motion, in either direction.
// Scrubbing and model changes do not call this function.
export function audibleFold(sequence, from, to) {
  if (from === to) return null;
  const forward = to > from;
  for (let i = Math.floor(Math.min(from, to) * sequence.count); i < sequence.count; i++) {
    const point = (i + (forward ? 0.22 : 0.78)) / sequence.count;
    if (point > Math.max(from, to)) break;
    if (point > Math.min(from, to) && sequence.steps[i]?.kind === 'hinge') return i;
  }
  return null;
}

export class FoldAudio {
  constructor() {
    this.enabled = false;
    this.enableRequest = 0;
    this.visible = true;
    this.volumes = { bgm: 0.32, se: 0.55 };
    this.buffers = new Map();
    this.voices = new Set();
    this.randomSeed = 427;
    this.beat = 0;
    this.lastNote = null;
    try {
      const saved = JSON.parse(localStorage.getItem('fold-audio-volume'));
      for (const key of ['bgm', 'se'])
        if (Number.isFinite(saved?.[key])) this.volumes[key] = clamp(saved[key]);
    } catch {
      /* Private mode can disable local storage. */
    }
  }

  random() {
    this.randomSeed = (1664525 * this.randomSeed + 1013904223) >>> 0;
    return this.randomSeed / 4294967296;
  }

  createContext() {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    const limiter = this.context.createDynamicsCompressor();
    limiter.threshold.value = -18;
    limiter.knee.value = 18;
    limiter.ratio.value = 4;
    this.master.connect(limiter).connect(this.context.destination);
    this.bgm = this.context.createGain();
    this.se = this.context.createGain();
    this.duck = this.context.createGain();
    this.bgm.connect(this.duck).connect(this.master);
    this.se.connect(this.master);
    this.bgm.gain.value = this.volumes.bgm;
    this.se.gain.value = this.volumes.se;
  }

  async setEnabled(enabled) {
    const request = ++this.enableRequest;
    this.enabled = enabled;
    if (enabled) {
      try {
        if (!this.context) this.createContext();
        await this.context.resume();
        if (request !== this.enableRequest) return;
        if (this.context.state !== 'running') throw new Error('Audio did not start');
      } catch (error) {
        if (request !== this.enableRequest) return;
        this.enabled = false;
        this.sync();
        throw error;
      }
    }
    this.sync();
  }

  setVisible(visible) {
    if (this.visible === visible) return;
    this.visible = visible;
    this.sync();
  }

  sync() {
    if (!this.context) return;
    const active = this.enabled && this.visible;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(active ? 0.85 : 0, now, 0.09);
    if (active && !this.timer) {
      this.nextBeat = now + 0.08;
      this.tick();
      this.timer = setInterval(() => this.tick(), 100);
    } else if (!active) {
      clearInterval(this.timer);
      this.timer = null;
      for (const source of this.voices) source.stop(now + 0.3);
    }
  }

  setVolume(kind, value) {
    this.volumes[kind] = clamp(value);
    if (this.context) this[kind].gain.setTargetAtTime(this.volumes[kind], this.context.currentTime, 0.05);
    try {
      localStorage.setItem('fold-audio-volume', JSON.stringify(this.volumes));
    } catch {
      /* optional */
    }
  }

  buffer(key, samples) {
    if (!this.buffers.has(key)) {
      const data = samples();
      const buffer = this.context.createBuffer(1, data.length, 24000);
      buffer.copyToChannel(data, 0);
      this.buffers.set(key, buffer);
    }
    return this.buffers.get(key);
  }

  voice(buffer, destination, time, level, pan = 0, rate = 1) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.context.createGain();
    gain.gain.value = level;
    const panner = this.context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(destination);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
      panner.disconnect();
    };
    source.start(time);
  }

  tick() {
    if (!this.enabled || !this.visible || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (this.nextBeat < now - 0.3) this.nextBeat = now + 0.05;
    // Four quiet harmonies; sparse notes and rests vary each pass (64 bpm).
    const chords = [
      [48, 60, 64, 67, 74],
      [45, 60, 64, 69, 72],
      [41, 60, 65, 69, 74],
      [43, 62, 67, 69, 74],
    ];
    while (this.nextBeat < now + 0.18) {
      const chord = chords[Math.floor(this.beat / 8) % chords.length];
      if (this.beat % 8 === 0)
        this.voice(
          this.buffer(`root-${chord[0]}`, () => paperTone(chord[0], 24000, 6)),
          this.bgm,
          this.nextBeat,
          0.52,
          -0.15,
        );
      if (this.beat % 2 === 0 && (this.beat % 8 === 0 || this.random() > 0.24)) {
        const choices = chord.slice(1).filter((note) => note !== this.lastNote);
        const note = choices[Math.floor(this.random() * choices.length)];
        this.lastNote = note;
        this.voice(
          this.buffer(`tone-${note}`, () => paperTone(note)),
          this.bgm,
          this.nextBeat,
          0.65 + this.random() * 0.15,
          (this.random() - 0.5) * 0.5,
        );
      }
      this.beat++;
      this.nextBeat += 60 / 64;
    }
  }

  fold(index) {
    if (!this.enabled || !this.visible || this.context?.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - (this.lastFoldTime ?? -1) < 0.12) return;
    this.lastFoldTime = now;
    const variant = index % 5;
    this.voice(
      this.buffer(`paper-${variant}`, () => paperRustle(variant + 31)),
      this.se,
      now,
      0.95,
      0,
      0.94 + this.random() * 0.12,
    );
    this.duck.gain.cancelScheduledValues(now);
    this.duck.gain.setTargetAtTime(0.62, now, 0.03);
    this.duck.gain.setTargetAtTime(1, now + 0.35, 0.2);
  }
}
