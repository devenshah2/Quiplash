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

const partyTracks = {
  lobby: { bpm: 116, bars: 16 }, write: { bpm: 105, bars: 16 },
  vote: { bpm: 128, bars: 12 }, reveal: { bpm: 124, bars: 8 },
  scores: { bpm: 112, bars: 8 }, end: { bpm: 126, bars: 12 },
};

function entryOffset(view) {
  const track = partyTracks[view.phase];
  const round = Math.max(0, view.round - 1);
  const matchup = Math.max(0, (view.matchup?.number || 1) - 1);
  const startBar = view.phase === 'end' ? 0 : (round * 4 + matchup * 2) % track.bars;
  return startBar * 4 * 60 / track.bpm;
}

class HostSound {
  constructor() {
    this.clips = new Map();
    this.phaseKey = '';
    this.revision = 0;
    this.packRevision = 0;
    this.muted = false;
    this.musicMode = 'party';
    this.musicVolume = 0.65;
    this.ducked = false;
    this.musicRevision = 0;
    this.trackCache = new Map();
  }

  get contextKey() {
    return this.phaseKey;
  }

  setMusicMode(mode) {
    if (!['party', 'steam'].includes(mode) || this.musicMode === mode) return;
    this.musicMode = mode;
    if (this.current && this.phaseKey && !this.muted) {
      this.stopMusic();
      this.startMusic(cueFor(this.current).loop, this.current, this.revision);
    }
  }

  setMusicVolume(value) {
    if (!Number.isFinite(value)) return;
    this.musicVolume = Math.max(0, Math.min(1, value));
    this.duck(this.ducked);
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
        this.master.gain.value = this.muted ? 0 : 0.88;
        this.master.connect(this.ctx.destination);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = this.musicVolume;
        this.musicBus.connect(this.master);
      }
      await this.ctx.resume();
      if (this.current && !this.muted && !this.phaseKey) this.update(this.current);
    } catch { /* The next host gesture can resume a suspended context. */ }
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.master) this.master.gain.setValueAtTime(this.muted ? 0 : 0.88, this.ctx.currentTime);
    this.refresh();
  }

  clearPlayback() {
    this.revision++;
    this.promptRequest?.abort();
    this.promptRequest = null;
    this.stopMusic();
    if (this.voiceSource) {
      this.voiceSource.onended = null;
      try { this.voiceSource.stop(); } catch {}
      this.voiceSource.disconnect();
      this.voiceSource = null;
    }
    this.cueBusy = false;
    this.queuedBanter = null;
    this.banterUtterance = null;
    if (this.utterance) {
      this.utterance.onend = this.utterance.onerror = null;
      globalThis.speechSynthesis?.cancel();
      this.utterance = null;
    }
    this.duck(false);
  }

  duck(active) {
    this.ducked = active;
    if (this.musicBus) {
      const gain = this.musicBus.gain;
      gain.cancelScheduledValues(this.ctx.currentTime);
      gain.setTargetAtTime(this.musicVolume * (active ? 0.24 : 1), this.ctx.currentTime, active ? 0.035 : 0.15);
    }
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

  stopMusic() {
    this.musicRevision++;
    const source = this.loopSource;
    const fader = this.trackFader;
    this.loopSource = this.trackFader = null;
    if (!source) return;
    const now = this.ctx.currentTime;
    fader.gain.cancelScheduledValues(now);
    fader.gain.setTargetAtTime(0, now, 0.024);
    source.onended = () => { source.disconnect(); fader.disconnect(); };
    try { source.stop(now + 0.11); } catch { source.onended(); }
  }

  async partyBuffer(phase) {
    if (!partyTracks[phase]) return null;
    if (this.trackCache.has(phase)) {
      const entry = this.trackCache.get(phase);
      this.trackCache.delete(phase);
      this.trackCache.set(phase, entry);
      return entry;
    }
    const load = async () => {
      try {
        const response = await fetch(new URL('./assets/music/' + phase + '.mp3', import.meta.url));
        if (!response.ok) throw new Error('Music unavailable');
        return await this.ctx.decodeAudioData(await response.arrayBuffer());
      } catch {
        this.trackCache.delete(phase);
        return null;
      }
    };
    // Cache three decoded stereo tracks. Repeated matchups can transition without a fetch.
    if (this.trackCache.size >= 3) this.trackCache.delete(this.trackCache.keys().next().value);
    const entry = load();
    this.trackCache.set(phase, entry);
    return entry;
  }

  async startMusic(id, view, revision) {
    const serial = ++this.musicRevision;
    const steam = this.musicMode === 'steam' ? await this.decode(id, revision) : null;
    if (revision !== this.revision || serial !== this.musicRevision) return;
    const buffer = steam || await this.partyBuffer(view.phase);
    if (!buffer || revision !== this.revision || serial !== this.musicRevision) return;
    const source = this.ctx.createBufferSource();
    const fader = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = Boolean(steam) || view.phase !== 'end';
    source.connect(fader).connect(this.musicBus);
    fader.gain.setValueAtTime(0, this.ctx.currentTime);
    fader.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.075);
    source.onended = () => {
      source.disconnect(); fader.disconnect();
      if (this.loopSource === source) this.loopSource = this.trackFader = null;
    };
    this.loopSource = source;
    this.trackFader = fader;
    source.start(0, steam ? 0 : entryOffset(view));
  }

  banter(line, phaseKey = this.contextKey) {
    const text = typeof line === 'string' ? line.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
    if (!text || !phaseKey || this.muted || this.ctx?.state !== 'running' || phaseKey !== this.contextKey) return false;
    this.queuedBanter = text;
    this.flushBanter();
    return true;
  }

  cancelBanter() {
    this.queuedBanter = null;
    if (!this.banterUtterance || this.utterance !== this.banterUtterance) return;
    this.utterance.onend = this.utterance.onerror = null;
    this.banterUtterance = this.utterance = null;
    globalThis.speechSynthesis?.cancel();
    this.duck(false);
  }

  flushBanter() {
    if (this.cueBusy || this.utterance || this.voiceSource || !this.queuedBanter) return;
    const line = this.queuedBanter;
    this.queuedBanter = null;
    this.banterUtterance = this.speak(line, this.revision, () => this.flushBanter());
  }

  finishCue(revision) {
    if (revision !== this.revision) return;
    this.cueBusy = false;
    this.flushBanter();
  }

  speak(line, revision, after) {
    if (revision !== this.revision) return;
    if (!line || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
      after?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.lang = 'en-US';
    utterance.rate = 1.08;
    utterance.onend = utterance.onerror = () => {
      if (revision === this.revision) {
        this.utterance = null;
        if (this.banterUtterance === utterance) this.banterUtterance = null;
        this.duck(false);
        after?.();
      }
    };
    this.utterance = utterance;
    this.duck(true);
    speechSynthesis.speak(utterance);
    return utterance;
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
      this.speak([cue.prompt, cue.say].filter(Boolean).join(' '), revision, () => this.finishCue(revision));
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
      this.speak([cue.prompt, cue.say].filter(Boolean).join(' '), revision, () => this.finishCue(revision));
      return;
    }
    this.playVoice(buffer, revision, () => this.finishCue(revision));
  }

  update(view) {
    this.current = view;
    if (!view || this.muted || this.ctx?.state !== 'running') return;
    const key = [view.phase, view.round, view.matchup?.id].join('/');
    if (key === this.phaseKey) return;
    this.clearPlayback();
    this.phaseKey = key;
    const cue = cueFor(view);
    this.cueBusy = true;
    if (cue.loop) this.startMusic(cue.loop, view, this.revision);
    if (view.phase === 'vote' && /^\d{1,10}$/.test(view.localPromptAudioId) && isSteamLauncher()) {
      this.questionThenVote(cue, view.localPromptAudioId, this.revision);
    } else {
      this.announce(cue, this.revision);
    }
  }
}

export const sound = new HostSound();
