// Only this structured subset travels between players. Never send or insert answer HTML.
export const MAX_TEXT = 160;
export const MAX_MEDIA_BYTES = 72 * 1024;
const maxDataLength = 4 * Math.ceil(MAX_MEDIA_BYTES / 3);
const bundledGif = /^assets\/gifs\/[0-9a-f_-]{2,65}\.gif$/;
const dataImage = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

export function safeImageSource(value) {
  if (typeof value !== 'string' || value.length > maxDataLength + 30) return null;
  if (bundledGif.test(value)) return value;
  if (value.startsWith('data:')) {
    const match = dataImage.exec(value);
    if (!match || match[2].length > maxDataLength || match[2].length % 4) return null;
    if (match[2].length < 16) return null;
    const header = atob(match[2].slice(0, 16));
    const valid = {
      png: header.startsWith('\x89PNG\r\n\x1a\n'),
      jpeg: header.startsWith('\xff\xd8\xff'),
      gif: /^GIF8[79]a/.test(header),
      webp: header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP'
    };
    return valid[match[1]] ? value : null;
  }
  if (value.length > 2048 || !value.startsWith('https://') || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port || !url.hostname.includes('.')) return null;
    if (/^(?:\d+\.){3}\d+$/.test(url.hostname) || /\.(?:localhost|local|internal|home|invalid|test)$/i.test(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function normalizeAnswer(raw) {
  if (!raw || !Array.isArray(raw.parts) || raw.parts.length > MAX_TEXT + 1) return null;
  const parts = [];
  let characters = 0;
  let hasImage = false;
  let hasText = false;
  for (const item of raw.parts) {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'image') {
      const src = safeImageSource(item.src);
      if (!src || hasImage) return null;
      const alt = typeof item.alt === 'string' ? item.alt.slice(0, 100).trim() : '';
      const image = { type: 'image', src, alt: alt || 'Attached image' };
      if (src.startsWith('https://') && typeof item.gifSnap?.id === 'string' && /^[a-z0-9._-]{1,180}$/i.test(item.gifSnap.id)) {
        image.gifSnap = { id:item.gifSnap.id, source:typeof item.gifSnap.source === 'string' ? item.gifSnap.source.slice(0,100) : '' };
      }
      parts.push(image);
      hasImage = true;
      continue;
    }
    if (item.type !== 'text' || typeof item.text !== 'string' || item.text.length > MAX_TEXT * 2 + 3) return null;
    const text = item.text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    if (!text) continue;
    characters += [...text].length;
    if (characters > MAX_TEXT) return null;
    hasText ||= !!text.trim();
    const bold = item.bold === true;
    const italic = item.italic === true;
    const last = parts.at(-1);
    if (last?.type === 'text' && !!last.bold === bold && !!last.italic === italic) {
      last.text += text;
    } else {
      const run = { type: 'text', text };
      if (bold) run.bold = true;
      if (italic) run.italic = true;
      parts.push(run);
    }
  }
  return hasImage || hasText ? { parts } : null;
}

export function renderAnswer(container, value) {
  const answer = normalizeAnswer(value);
  container.replaceChildren();
  if (!answer) return;
  const body = document.createElement('span');
  body.className = 'qa-answer';
  for (const part of answer.parts) {
    if (part.type === 'image') {
      const image = document.createElement('img');
      image.className = 'qa-answer-image';
      image.alt = part.alt;
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.src = part.src;
      body.append(image);
    } else {
      let child = document.createTextNode(part.text);
      for (const tag of [part.bold && 'strong', part.italic && 'em'].filter(Boolean)) {
        const element = document.createElement(tag);
        element.append(child);
        child = element;
      }
      body.append(child);
    }
  }
  container.append(body);
}
