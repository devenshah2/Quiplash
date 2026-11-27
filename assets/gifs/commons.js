// Wikimedia search is opt-in. The bundled shelf works without any API calls.
import { safeImageSource } from '../../rich.js';

export async function searchCommons(query, signal) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    generator: 'search', gsrnamespace: '6', gsrlimit: '40',
    gsrsearch: query.trim().slice(0, 80) + ' filemime:"image/gif" filesize:<4096',
    prop: 'imageinfo', iiprop: 'url|mime|metadata|extmetadata',
    iiurlwidth: '120', iiextmetadatafilter: 'LicenseShortName'
  });
  const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw Error('GIF search is unavailable right now.');
  const result = await response.json();
  if (result.error) throw Error('GIF search is unavailable right now.');
  const options = [];
  const pages = result.query?.pages || [];
  for (const page of pages.sort((a, b) => a.index - b.index)) {
    const info = page.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value;
    const frameCount = info?.metadata?.find(entry => entry.name === 'frameCount')?.value;
    if (!['CC0', 'Public domain'].includes(license) || info?.mime !== 'image/gif' || !(frameCount > 1)) continue;
    if (!safeImageSource(info.url) || new URL(info.url).hostname !== 'upload.wikimedia.org') continue;
    const src = new URL(info.url);
    src.search = '';
    const preview = safeImageSource(info.thumburl) || src.href;
    options.push({ src: src.href, preview, name: page.title.replace(/^File:/, '').replace(/\.gif$/i, '').slice(0, 100) });
    if (options.length === 12) break;
  }
  return options;
}
