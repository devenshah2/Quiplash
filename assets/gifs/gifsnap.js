import { safeImageSource } from '../../rich.js';

const pageSize = 16;

function remoteImage(url) {
  return typeof url === 'string' && url.startsWith('https://') ? safeImageSource(url) : null;
}

export async function searchGifSnap(query, page = 1, signal) {
  if (!Number.isSafeInteger(page) || page < 1) throw new RangeError('Invalid GIF search page.');
  const term = query.trim().slice(0, 120);
  const endpoint = term ? 'search' : 'trending';
  const url = new URL('https://gifsnap.com/api/v1/gifs/' + endpoint);
  url.searchParams.set('page', page);
  url.searchParams.set('limit', pageSize);
  if (term) url.searchParams.set('q', term);

  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (response.status === 429) throw new Error('GIF search is busy. Try again in a moment.');
  if (!response.ok) throw new Error('GifSnap could not load GIFs.');
  const result = await response.json();
  if (!Array.isArray(result?.data)) throw new Error('GifSnap returned an unreadable result.');

  const items = [];
  const seen = new Set();
  for (const gif of result.data) {
    const src = remoteImage(gif?.url);
    if (!src || typeof gif.id !== 'string' || !gif.id) continue;
    const key = typeof gif.content_id === 'string' && gif.content_id ? gif.content_id : gif.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const variant = gif.animated_preview;
    const animated = variant?.animated === true && ['image/gif', 'image/webp'].includes(variant.mime_type)
      ? remoteImage(variant.url) : null;
    items.push({
      id: gif.id,
      key,
      name: typeof gif.title === 'string' && gif.title.trim() ? gif.title.trim().slice(0, 100) : 'Reaction GIF',
      src,
      preview: animated || src,
      still: remoteImage(gif.preview_url),
      source: typeof gif.source === 'string' ? gif.source.slice(0, 100) : '',
    });
  }
  const pagination = result.pagination;
  const nextPage = pagination?.has_next === true && pagination.next_page === page + 1
    ? pagination.next_page : null;
  return { items, nextPage };
}
