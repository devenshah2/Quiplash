// The weights are fetched only after the host explicitly enables the download.
// Cached sessions can resume offline; an evicted cache never triggers a silent re-download.
const MODEL_URL = 'https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF/resolve/09816acd5d99df7be770d85ea30822623dab342c/SmolLM2-135M-Instruct-Q4_K_M.gguf';
const MODEL_BYTES = 105454432;
const SHA256 = '2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d';
const CACHE = 'punchline-announcer-weights-v1';
const preference = 'punchline.announcer.smol.v1';

let engine, loading, loadAbort, generation, writer;
let localAttempted = false;
let disabledForSession = false;
let localFile = false;
let optedIn = false;
try { optedIn = localStorage.getItem(preference) === 'yes'; } catch { /* Session-only storage. */ }

export function studioModelState() {
  return engine ? 'ready' : loading ? 'loading' : optedIn ? 'saved' : 'off';
}

function setPreference(value) {
  optedIn = value;
  try {
    if (value) localStorage.setItem(preference, 'yes');
    else localStorage.removeItem(preference);
  } catch { /* The current tab still works without persistent storage. */ }
}

async function readWeights(download, signal, onProgress) {
  if (localFile) {
    const response = await fetch('/_local/announcer.gguf', {signal});
    if (!response.ok) throw new Error('The local announcer file is unavailable.');
    const blob = await response.blob();
    if (blob.size !== MODEL_BYTES) throw new Error('The local announcer file is incomplete.');
    onProgress?.(1);
    return blob;
  }
  let cache;
  try { cache = await caches.open(CACHE); } catch { /* Private mode may disable caches. */ }
  const saved = await cache?.match(MODEL_URL);
  if (saved) {
    const blob = await saved.blob();
    if (blob.size === MODEL_BYTES) { onProgress?.(1); return blob; }
    await cache.delete(MODEL_URL);
  }
  if (!download) throw new Error('The browser cleared the saved model. Use Download to load it again.');
  const res = await fetch(MODEL_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok || !res.body) throw new Error('Could not download the announcer. Check your connection and try again.');
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MODEL_BYTES) throw new Error('The model download has an unexpected size.');
      chunks.push(chunk.value);
      onProgress?.(size / MODEL_BYTES);
    }
  } finally { reader.releaseLock(); }
  const blob = new Blob(chunks);
  if (blob.size !== MODEL_BYTES) throw new Error('The model download was incomplete.');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (hex !== SHA256) throw new Error('The model download failed its integrity check.');
  signal.throwIfAborted();
  try { await cache?.put(MODEL_URL, new Response(blob)); } catch { /* Session-only if storage is full. */ }
  return blob;
}

function prepare(download, {signal, onProgress} = {}) {
  if (engine) return Promise.resolve();
  if (loading) return loading;
  const controller = new AbortController();
  loadAbort = controller;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const operation = (async () => {
    let instance;
    try {
      const blob = await readWeights(download, controller.signal, onProgress);
      controller.signal.throwIfAborted();
      const { Wllama } = await import('../../vendor/wllama/index.js');
      controller.signal.throwIfAborted();
      const wasm = new URL('../../vendor/wllama/wllama.wasm', import.meta.url).href;
      const noop = () => {};
      instance = new Wllama({ 'single-thread/wllama.wasm': wasm }, {
        logger: { debug: noop, log: noop, warn: noop, error: noop },
      });
      await instance.loadModel([blob], { n_threads: 1, n_ctx: 512, n_batch: 64 });
      controller.signal.throwIfAborted();
      engine = instance;
      if (!localFile) setPreference(true);
    } catch (error) {
      if (instance) try { await instance.exit(); } catch { /* Failed worker already exited. */ }
      setPreference(false);
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (loadAbort === controller) { loading = null; loadAbort = null; }
    }
  })();
  loading = operation;
  return operation;
}

export function warmLocalStudio() {
  if (localAttempted || !['127.0.0.1', 'localhost'].includes(location.hostname)) return;
  localAttempted = true;
  fetch('/_local/announcer-status', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(status => {
      if (!status?.available || disabledForSession || loading || engine) return;
      localFile = true;
      return prepare(false);
    }).catch(() => {});
}

export function enableStudioModel(options) { disabledForSession = false; return prepare(true, options); }

export async function disableStudioModel() {
  disabledForSession = true;
  setPreference(false);
  loadAbort?.abort();
  generation?.abort();
  if (loading) await loading.catch(() => {});
  if (writer) await writer.catch(() => {});
  const previous = engine;
  engine = null;
  if (previous) await previous.exit();
}

export async function studioLine(messages, signal, form) {
  if (!engine && optedIn && !loading) prepare(false).catch(() => {});
  if (!engine || generation || signal?.aborted) return '';
  const controller = new AbortController();
  generation = controller;
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once:true});
  // Finish promptly on a slow device so established cues and room timers keep moving.
  const timeout = setTimeout(cancel, 6000);
  try {
    writer = (async () => {
      const {generateFragment}=await import('./decode.js');
      return generateFragment(engine,messages,form,controller.signal);
    })();
    return await writer;
  } catch { return ''; }
  finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    generation = null;
    writer = null;
  }
}
