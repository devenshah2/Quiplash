import { isSteamLauncher } from './steam-questions.js';

// Cue IDs are identifiers from Quiplash 2. Imported recordings live only on this host.
const music = {
  lobby: 104463, write: [104441, 104442, 104443],
  vote1: [104280, 104281, 104282, 104283, 104284, 104285, 104286, 104287],
  vote2: [104304, 104305, 104306, 104307, 104308, 104309, 104310, 104311],
  reveal1: [104367, 104368, 104369, 104370, 104371, 104372, 104373, 104374],
  reveal2: [104232, 104233, 104234, 104235, 104236, 104237, 104238, 104239],
  finalVote: 104247, finalReveal: 122311, scores: 104245, end: 104375,
};
const voice = {
  welcome: [113498, 113577, 113584, 113602, 113612],
  round1: [113895, 113896, 113897], round2: [115338, 115345, 115350],
  round3: [115558, 115559, 115560, 115562],
  vote: [115318, 115320, 115323, 115324, 115327, 115335],
  scores1: [115354, 119772], scores2: [115303, 115308],
  final: [115593, 115594, 115595, 115596, 115597],
};
export const steamCueIds = [...new Set([...Object.values(music).flat(), ...Object.values(voice).flat()])];
const cueSet = new Set(steamCueIds);

function cueFor(v) {
  const q = v.matchup;
  switch (v.phase) {
    case 'lobby': return { loop: music.lobby, voices: voice.welcome, say: 'Welcome to the game. Join with the room code on screen.' };
    case 'write': return {
      loop: music.write[v.round - 1], voices: voice['round' + v.round],
      say: ['Round one! Answer both prompts on your device.', 'Round two. The points are doubled!',
        'Final round. Everyone gets the same prompt. Make it count!'][v.round - 1],
    };
    case 'vote': return {
      loop: v.round === 3 ? music.finalVote : music['vote' + v.round][q.number - 1],
      voices: voice.vote,
      say: v.round === 3 ? 'Time for the final vote. Give three votes to your favorites.' : 'Pick your favorite.',
      prompt: q.prompt,
    };
    case 'reveal': return {
      loop: v.round === 3 ? music.finalReveal : music['reveal' + v.round][q.number - 1],
      say: q.outcome === 'jinx' ? 'The same answer! No points this time.' :
        q.outcome === 'walkover' ? 'One answer takes it!' : q.unanimous ? 'A clean sweep!' : '',
    };
    case 'scores': return { loop: music.scores, voices: voice['scores' + v.round], say: 'Let’s see the scores.' };
    case 'end': return { loop: music.end, voices: voice.final, say: 'That’s the game! Here are your final scores.' };
    default: return {};
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('quipshow-host-audio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('packs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSaved() {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const read = db.transaction('packs').objectStore('packs').get('quiplash2');
      read.onsuccess = () => resolve(read.result || []);
      read.onerror = () => reject(read.error);
    });
  } finally { db.close(); }
}

async function savePack(clips) {
  const db = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
      tx.objectStore('packs').put([...clips], 'quiplash2');
    });
  } finally { db.close(); }
}

const chordChanges = [
  [48, 52, 55, 59], [45, 48, 52, 55], [50, 53, 57, 60], [43, 47, 50, 53],
  [48, 52, 55, 57], [45, 49, 52, 55], [50, 53, 57, 60], [43, 47, 50, 53],
];
const riff = [[0, 2, 12], [3, 1, 12], [6, 3, 12], [9, 1, 12], [12, 2, 12], [15, 0, 12]];
const bpm = { lobby: 113, write: 106, vote: 134, reveal: 143, scores: 116, end: 121 };
const transpose = { lobby: 0, write: -2, vote: 3, reveal: 5, scores: 0, end: 7 };
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

// Short envelopes and a look-ahead clock keep the original combo in time between browser frames.
class HouseBand {
  constructor(ctx, bus) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.connect(bus);
    this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  note(time, midi, duration, amplitude, type = 'triangle') {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz(midi);
    this.playSource(osc, time, duration, amplitude);
  }

  playSource(source, time, duration, level, filter) {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(level, time + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    if (filter) source.connect(filter).connect(env);
    else source.connect(env);
    env.connect(this.gain);
    source.onended = () => { source.disconnect(); filter?.disconnect(); env.disconnect(); };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  brush(time, snare) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = snare ? 2300 : 7500;
    filter.Q.value = snare ? 0.7 : 1.3;
    this.playSource(source, time, snare ? 0.12 : 0.047, snare ? 0.12 : 0.07, filter);
  }

  start(phase, round) {
    this.stop();
    this.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    let step = 0;
    let next = this.ctx.currentTime + 0.045;
    const beat = 60 / ((bpm[phase] || 110) + (phase === 'write' ? (round - 1) * 4 : 0));
    const key = transpose[phase] || 0;
    const pump = () => {
      if (this.ctx.state !== 'running') return;
      // Recover smoothly after a throttled or sleeping tab.
      if (next < this.ctx.currentTime) next = this.ctx.currentTime + 0.035;
      while (next < this.ctx.currentTime + 0.2) {
        const bar = Math.floor(step / 8) % chordChanges.length;
        const chord = chordChanges[bar].map(note => note + key);
        const part = step % 8;
        this.brush(next, part === 2 || part === 6);
        if (part % 2 === 0) {
          const walking = [chord[0], chord[1], chord[2], chord[0] + (bar % 2 ? 2 : -1)];
          this.note(next, walking[part / 2] - 12, beat * 0.83, 0.34, 'sine');
        }
        if (part === 1 || part === 4 || (bar % 2 && part === 7)) {
          for (const tone of chord.slice(1)) this.note(next, tone + 12, beat * 0.47, 0.045);
        }
        const melody = riff.find(([offset]) => offset === step % 16);
        if (melody && (phase !== 'write' || bar % 4 === 3)) {
          this.note(next, chord[melody[1]] + melody[2], beat * 0.66, 0.105, 'sine');
        }
        next += beat * (part % 2 ? 0.39 : 0.61);
        step++;
      }
    };
    pump();
    this.interval = setInterval(pump, 90);
  }

  stop() {
    clearInterval(this.interval);
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
  }
}

class HostSound {
  constructor() {
    this.clips = new Map();
    this.phaseKey = '';
    this.revision = 0;
    this.packRevision = 0;
    this.muted = false;
  }

  get packName() {
    return this.clips.size ? 'Quiplash 2' + (this.sessionOnly ? ' (this session)' : '') : '';
  }

  async restore() {
    const revision = this.packRevision;
    try {
      const saved = await loadSaved();
      if (revision === this.packRevision && saved.length && !this.clips.size) {
        this.clips = new Map(saved.filter(([id, blob]) => cueSet.has(id) && blob instanceof Blob));
        this.refresh();
      }
    } catch { /* Host can play with the built-in score when browser storage is unavailable. */ }
    return this.clips.size;
  }

  async importFiles(input, { persist = true } = {}) {
    const clips = new Map();
    const selected = Array.from(input || []).filter(file => {
      const match = /^(\d+)\.ogg$/i.exec(file.name);
      if (!match || !cueSet.has(Number(match[1])) || !file.size || file.size > 12 * 1024 * 1024) return false;
      // If the whole Steam library was selected, skip recordings from other installed games.
      const path = file.webkitRelativePath || '';
      return !/\/games\//i.test(path) || /\/games\/quiplash2\//i.test(path);
    });
    await Promise.all(selected.map(async file => {
      if (await file.slice(0, 4).text() === 'OggS') {
        clips.set(parseInt(file.name, 10), file.slice(0, file.size, 'audio/ogg'));
      }
    }));
    if (!clips.size) throw new Error('Choose the Quiplash2 folder or its TalkshowExport/project/media folder from The Jackbox Party Pack 3.');
    this.packRevision++;
    this.clips = clips;
    this.sessionOnly = !persist;
    if (persist) {
      try { await savePack(clips); } catch { this.sessionOnly = true; }
    }
    this.refresh();
    return clips.size;
  }

  async unlock() {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context) return;
    try {
      if (!this.ctx) {
        this.ctx = new Context();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.7;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.43;
        this.musicBus.connect(this.master);
        this.band = new HouseBand(this.ctx, this.musicBus);
      }
      await this.ctx.resume();
      if (this.current && !this.muted && !this.phaseKey) this.update(this.current);
    } catch { /* The next host gesture can resume a suspended context. */ }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.master) this.master.gain.setValueAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime);
    this.refresh();
  }

  clearPlayback() {
    this.revision++;
    this.promptRequest?.abort();
    this.promptRequest = null;
    for (const source of [this.loopSource, this.voiceSource]) {
      if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    }
    this.loopSource = this.voiceSource = null;
    this.band?.stop();
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = null;
      globalThis.speechSynthesis?.cancel();
      this.utterance = null;
    }
    this.duck(false);
  }

  duck(active) {
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(active ? 0.15 : 0.43, this.ctx.currentTime, 0.07);
  }

  refresh() {
    this.clearPlayback();
    this.phaseKey = '';
    if (this.current && !this.muted) this.update(this.current);
  }

  stop() {
    this.current = null;
    this.refresh();
  }

  async decode(id, revision) {
    const blob = this.clips.get(id);
    if (!blob || revision !== this.revision) return null;
    try {
      const raw = await blob.arrayBuffer();
      if (revision !== this.revision) return null;
      return await this.ctx.decodeAudioData(raw);
    } catch { return null; }
  }

  async startMusic(id, v, revision) {
    const buffer = await this.decode(id, revision);
    if (revision !== this.revision) return;
    if (!buffer) {
      this.band.start(v.phase, v.round);
      return;
    }
    this.loopSource = this.ctx.createBufferSource();
    this.loopSource.buffer = buffer;
    this.loopSource.loop = true;
    this.loopSource.connect(this.musicBus);
    this.loopSource.start();
  }

  speak(line, revision) {
    if (!line || revision !== this.revision || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'en-US';
    utterance.rate = 1.08;
    utterance.onend = utterance.onerror = () => {
      if (revision === this.revision) { this.utterance = null; this.duck(false); }
    };
    this.utterance = utterance;
    this.duck(true);
    speechSynthesis.speak(utterance);
  }

  playVoice(buffer, revision, after) {
    if (revision !== this.revision) return;
    const source = this.ctx.createBufferSource();
    this.voiceSource = source;
    source.buffer = buffer;
    source.connect(this.master);
    this.duck(true);
    source.onended = () => {
      source.disconnect();
      if (revision !== this.revision) return;
      this.voiceSource = null;
      this.duck(false);
      after?.();
    };
    source.start();
  }

  async questionThenVote(cue, id, revision) {
    const controller = new AbortController();
    this.promptRequest = controller;
    try {
      const response = await fetch('/_steam/question/' + id + '.ogg', { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('Missing local recording');
      const raw = await response.arrayBuffer();
      if (revision !== this.revision) return;
      const buffer = await this.ctx.decodeAudioData(raw);
      this.playVoice(buffer, revision, () => this.announce({ ...cue, prompt: '' }, revision));
    } catch {
      this.speak([cue.prompt, cue.say].filter(Boolean).join(' '), revision);
    } finally {
      if (this.promptRequest === controller) this.promptRequest = null;
    }
  }

  async announce(cue, revision) {
    const options = (cue.voices || []).filter(id => this.clips.has(id));
    const id = options[Math.floor(Math.random() * options.length)];
    const buffer = await this.decode(id, revision);
    if (revision !== this.revision) return;
    if (!buffer) {
      this.speak([cue.prompt, cue.say].filter(Boolean).join(' '), revision);
      return;
    }
    this.playVoice(buffer, revision);
  }

  update(view) {
    this.current = view;
    if (!view || this.muted || this.ctx?.state !== 'running') return;
    const key = [view.phase, view.round, view.matchup?.id].join('/');
    if (key === this.phaseKey) return;
    this.clearPlayback();
    this.phaseKey = key;
    const cue = cueFor(view);
    if (cue.loop) this.startMusic(cue.loop, view, this.revision);
    if (view.phase === 'vote' && /^\d{1,10}$/.test(view.localPromptAudioId) && isSteamLauncher()) {
      this.questionThenVote(cue, view.localPromptAudioId, this.revision);
    } else {
      this.announce(cue, this.revision);
    }
  }
}

export const sound = new HostSound();
