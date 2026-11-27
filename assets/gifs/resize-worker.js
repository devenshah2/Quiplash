// Re-encode a pasted or uploaded GIF off the UI thread while retaining its loop.
import { GifReader, GifWriter } from './omggif.js';

function dimensions(width, height, longest) {
  const scale = Math.min(1, longest / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

const palette = Array.from({ length: 256 }, (_, i) => {
  const r = Math.round((i >> 5) * 255 / 7);
  const g = Math.round(((i >> 2) & 7) * 255 / 7);
  const b = (i & 3) * 85;
  return (r << 16) | (g << 8) | b;
});

function sample(input, w, h, outW, outH, rgba = false) {
  const output = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    const row = Math.floor((y + 0.5) * h / outH) * w;
    for (let x = 0; x < outW; x++) {
      const index = row + Math.floor((x + 0.5) * w / outW);
      if (rgba) {
        const i = index * 4;
        const color = (input[i] & 224) | ((input[i + 1] >> 3) & 28) | (input[i + 2] >> 6);
        output[y * outW + x] = input[i + 3] < 128 ? 0 : (color || 1);
      } else {
        output[y * outW + x] = input[index];
      }
    }
  }
  return output;
}

function compress(bytes, limit) {
  const reader = new GifReader(new Uint8Array(bytes));
  const { width, height } = reader;
  const count = reader.numFrames();
  if (!count || count > 800 || !width || !height || width * height > 6000000) throw Error();
  const frames = Array.from({ length: count }, (_, i) => reader.frameInfo(i));
  const cost = frames.reduce((sum, f) => sum + f.width * f.height, 0);
  if (cost > 140000000 || frames.some(f => f.x + f.width > width || f.y + f.height > height)) throw Error();
  const durations = frames.map(f => Math.max(2, f.delay || 10));
  const total = durations.reduce((s, t) => s + t, 0);
  const n = Math.min(count, 24);
  const [w, h] = dimensions(width, height, 168);
  const snapshots = [];
  const buffer = new Uint8Array(width * height * 4);
  let elapsed = 0;
  for (let i = 0; i < count; i++) {
    const frame = frames[i];
    const restore = frame.disposal === 3 ? buffer.slice() : null;
    reader.decodeAndBlitFrameRGBA(i, buffer);
    const until = elapsed + durations[i];
    while (snapshots.length < n && snapshots.length * total / n < until) {
      snapshots.push(sample(buffer, width, height, w, h, true));
    }
    if (restore) buffer.set(restore);
    if (frame.disposal === 2) {
      for (let y = frame.y; y < frame.y + frame.height; y++) {
        buffer.fill(0, (y * width + frame.x) * 4, (y * width + frame.x + frame.width) * 4);
      }
    }
    elapsed = until;
  }
  for (const [longest, maxFrames] of [[168, 24], [128, 18], [100, 14], [80, 10], [64, 8], [48, 6]]) {
    const [outW, outH] = dimensions(w, h, longest);
    const size = Math.min(maxFrames, n);
    const output = new Uint8Array(limit + 1);
    const writer = new GifWriter(output, outW, outH, { palette, loop: reader.loopCount() ?? 0 });
    for (let i = 0; i < size; i++) {
      const frame = snapshots[Math.floor(i * n / size)];
      const pixels = w === outW && h === outH ? frame : sample(frame, w, h, outW, outH);
      const delay = Math.max(2, Math.round(total * (i + 1) / size) - Math.round(total * i / size));
      writer.addFrame(0, 0, outW, outH, pixels, { transparent: 0, disposal: 2, delay: Math.min(65535, delay) });
    }
    const length = writer.end();
    if (length <= limit) return output.slice(0, length);
  }
  throw Error();
}

self.onmessage = ({ data }) => {
  try {
    const output = compress(data.bytes, data.limit);
    self.postMessage({ bytes: output.buffer }, [output.buffer]);
  } catch {
    self.postMessage({ error: 'This GIF is too large to attach. Try its direct image link.' });
  }
};
