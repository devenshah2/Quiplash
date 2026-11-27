import { MAX_TEXT, MAX_MEDIA_BYTES, normalizeAnswer, safeImageSource } from './rich.js';
import { gifs } from './assets/gifs/catalog.js';
import { searchGifSnap } from './assets/gifs/gifsnap.js';
import { searchCommons } from './assets/gifs/commons.js';

const gifPath = gif => 'assets/gifs/' + gif.id + '.gif';

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function button(className, text, label = text) {
  const element = make('button', className, text);
  element.type = 'button';
  element.setAttribute('aria-label', label);
  element.title = label;
  return element;
}

function imagePart(src, alt, gifSnap) {
  const image = make('img', 'qa-inline-image');
  image.src = src;
  image.alt = alt || 'Attached image';
  image.referrerPolicy = 'no-referrer';
  if (gifSnap) {image.dataset.gifId=gifSnap.id; image.dataset.gifSource=gifSnap.source;}
  image.draggable = false;
  image.contentEditable = 'false';
  return image;
}

function contentFragment(value) {
  const fragment = document.createDocumentFragment();
  for (const item of value?.parts || []) {
    if (item.type === 'image') fragment.append(imagePart(item.src, item.alt, item.gifSnap));
    else {
      let node = document.createTextNode(item.text);
      for (const tag of [item.bold && 'b', item.italic && 'i'].filter(Boolean)) {
        const wrapper = make(tag);
        wrapper.append(node);
        node = wrapper;
      }
      fragment.append(node);
    }
  }
  return fragment;
}

function readParts(root) {
  const parts = [];
  function visit(node, bold, italic) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent) parts.push({ type: 'text', text: node.textContent.replace(/\u00a0/g, ' '), bold, italic });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const { tagName, style } = node;
    if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'SVG', 'MATH'].includes(tagName)) return;
    if (tagName === 'IMG') {
      const src = safeImageSource(node.getAttribute('src'));
      if (src) {
        const image = { type:'image', src, alt:node.alt || 'Attached image' };
        if (node.dataset.gifId) image.gifSnap = {id:node.dataset.gifId, source:node.dataset.gifSource || ''};
        parts.push(image);
      }
      return;
    }
    if (tagName === 'BR') {
      parts.push({ type: 'text', text: '\n', bold, italic });
      return;
    }
    const block = ['DIV', 'P', 'LI', 'BLOCKQUOTE'].includes(tagName);
    if (block && (node.previousSibling || parts.length) && !parts.at(-1)?.text?.endsWith('\n')) {
      parts.push({ type: 'text', text: '\n', bold, italic });
    }
    const weight = style?.fontWeight;
    const weightOn = weight ? (weight === 'bold' || Number(weight) >= 600) : bold || tagName === 'B' || tagName === 'STRONG';
    const italicOn = style?.fontStyle ? style.fontStyle === 'italic' : italic || tagName === 'EM' || tagName === 'I';
    for (const child of node.childNodes) visit(child, weightOn, italicOn);
  }
  for (const node of root.childNodes) visit(node, false, false);
  return parts;
}

function readFile(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error('This image could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      reject(Error('Image timed out. Try a direct image link or upload a file.'));
    }, 10000);
    image.onload = () => { clearTimeout(timer); resolve(image); };
    image.onerror = () => { clearTimeout(timer); reject(Error('Could not open that image. Try a direct image link or upload a file.')); };
    image.src = src;
  });
}

async function resizeGif(file) {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./assets/gifs/resize-worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error('This GIF took too long to resize. Try its direct image link.'));
    }, 15000);
    function finish() { clearTimeout(timer); worker.terminate(); }
    worker.onerror = () => { finish(); reject(Error('Could not resize this GIF. Try its direct image link.')); };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(Error(data.error));
      else resolve(new Blob([data.bytes], { type: 'image/gif' }));
    };
    worker.postMessage({ bytes, limit: MAX_MEDIA_BYTES }, [bytes]);
  });
}

async function prepareFile(file) {
  if (file.size > 22 * 1024 * 1024) throw Error('This image is over 22 MB. Use a direct image link or a smaller file.');
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const signature = String.fromCharCode(...header);
  const isGif = /^GIF8[79]a/.test(signature);
  if (isGif) {
    const blob = file.size <= MAX_MEDIA_BYTES ? new Blob([file], { type: 'image/gif' }) : await resizeGif(file);
    return readFile(blob);
  }
  if (file.size <= MAX_MEDIA_BYTES && ['image/webp', 'image/jpeg', 'image/png'].includes(file.type)) {
    const original = await readFile(file);
    if (safeImageSource(original)) return original;
  }
  if (file.type && !/^image\/(jpeg|jpg|png|webp|avif|heic|heif|bmp|tiff|gif)$/i.test(file.type)) {
    throw Error('Choose a GIF, JPEG, PNG or WebP image.');
  }
  const objectURL = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectURL);
    if (image.naturalWidth * image.naturalHeight > 64000000) throw Error('This picture is too large. Try a smaller version.');
    const canvas = document.createElement('canvas');
    for (const [edge, quality] of [[960, .82], [720, .72], [512, .64], [320, .58]]) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/jpeg', quality);
      if (safeImageSource(src)) return src;
    }
  } finally {
    URL.revokeObjectURL(objectURL);
  }
  throw Error('Could not fit this picture into an answer. Try a direct image link.');
}

function asImageUrl(value) {
  const src = safeImageSource(value.trim());
  if (!src || !src.startsWith('https://')) return null;
  const url = new URL(src);
  if (['giphy.com', 'www.giphy.com'].includes(url.hostname)) {
    const id = url.pathname.match(/^\/(?:gifs|stickers)\/(?:[^/]*-)?([a-zA-Z0-9]+)\/?$/)?.[1];
    if (id) return 'https://media.giphy.com/media/' + id + '/giphy.gif';
  }
  return src;
}

export function createEditor(container, { initial, onChange } = {}) {
  const shell = make('div', 'qa-editor');
  const surface = make('div', 'qa-surface');
  const toolbar = make('div', 'qa-toolbar');
  toolbar.setAttribute('aria-label', 'Answer tools');
  const bold = button('qa-tool qa-bold', 'B', 'Bold');
  const italic = button('qa-tool qa-italic', 'I', 'Italic');
  const separator = make('span', 'qa-divider');
  const gif = button('qa-tool qa-gif', 'GIF', 'Choose a GIF');
  const upload = button('qa-tool', 'Photo', 'Upload a picture or GIF');
  const link = button('qa-tool', 'Link', 'Add an image link');
  const remove = button('qa-remove', 'Remove image');
  remove.hidden = true;
  const field = make('div', 'qa-editable');
  field.contentEditable = 'true';
  field.spellcheck = true;
  field.setAttribute('role', 'textbox');
  field.setAttribute('aria-multiline', 'true');
  field.setAttribute('aria-label', 'Your answer');
  field.dataset.placeholder = 'Write your answer…';
  field.append(contentFragment(normalizeAnswer(initial)));
  const counter = make('span', 'qa-counter');
  const footer = make('div', 'qa-footer');
  footer.append(remove, counter);
  const status = make('p', 'qa-status');
  status.setAttribute('role', 'status');
  const chooser = make('section', 'qa-chooser');
  chooser.hidden = true;
  const input = make('input');
  input.type = 'file';
  input.accept = 'image/gif,image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif';
  input.hidden = true;
  toolbar.append(bold, italic, separator, gif, upload, link);
  surface.append(toolbar, field, footer);
  shell.append(surface, chooser, status, input);
  container.replaceChildren(shell);

  let savedRange = null;
  let alive = true;
  let uploadVersion = 0;
  let busy = false;
  let openPanel = '';
  let onlineRequest = null;
  let pickerTimer;
  let countValue = 0;
  function currentRange() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    return field.contains(range.commonAncestorContainer) ? range : null;
  }
  function remember() {
    const range = currentRange();
    if (!range) return;
    savedRange = range.cloneRange();
    bold.setAttribute('aria-pressed', String(document.queryCommandState('bold')));
    italic.setAttribute('aria-pressed', String(document.queryCommandState('italic')));
  }
  function restore() {
    field.focus({ preventScroll: true });
    if (!savedRange || !field.contains(savedRange.commonAncestorContainer)) {
      savedRange = document.createRange();
      savedRange.selectNodeContents(field);
      savedRange.collapse(false);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return savedRange;
  }
  function value() { return busy ? null : normalizeAnswer({ parts: readParts(field) }); }
  function changed() {
    const parts = readParts(field);
    const length = parts.reduce((sum, p) => sum + (p.type === 'text' ? [...p.text].length : 0), 0);
    countValue = length;
    counter.textContent = length + ' / ' + MAX_TEXT;
    counter.classList.toggle('qa-over', length > MAX_TEXT);
    remove.hidden = !field.querySelector('img');
    field.classList.toggle('qa-empty', !field.textContent.trim() && remove.hidden);
    if (!busy) status.textContent = length > MAX_TEXT ? 'Shorten your answer to send it.' : '';
    onChange?.(busy ? null : normalizeAnswer({ parts }));
  }
  function closePanel(focusBack = false) {
    clearTimeout(pickerTimer);
    onlineRequest?.abort();
    onlineRequest = null;
    chooser.replaceChildren();
    chooser.hidden = true;
    openPanel = '';
    gif.setAttribute('aria-expanded', 'false');
    link.setAttribute('aria-expanded', 'false');
    if (focusBack) restore();
  }
  function insert(fragment) {
    const range = restore();
    range.deleteContents();
    const last = fragment.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? fragment.lastChild : fragment;
    if (!last) return;
    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    savedRange = range.cloneRange();
    restore();
    changed();
  }
  function putImage(src, alt, gifSnap=null) {
    if (!safeImageSource(src)) return;
    const existing = field.querySelector('img');
    if (existing) {
      existing.replaceWith(imagePart(src, alt, gifSnap));
      changed();
    } else {
      insert(imagePart(src, alt, gifSnap));
    }
    closePanel(true);
  }
  async function addFile(file) {
    if (!file) return;
    const version = ++uploadVersion;
    busy = true;
    changed();
    status.textContent = 'Preparing image…';
    try {
      const src = await prepareFile(file);
      if (!alive || version !== uploadVersion) return;
      if (!safeImageSource(src)) throw Error('This image format could not be attached.');
      busy = false;
      putImage(src, file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Pasted image');
    } catch (error) {
      if (!alive || version !== uploadVersion) return;
      busy = false;
      changed();
      status.textContent = error.message;
    } finally { input.value = ''; }
  }
  function panel(name, title) {
    if (openPanel === name) { closePanel(true); return false; }
    closePanel();
    openPanel = name;
    chooser.hidden = false;
    const heading = make('div', 'qa-chooser-heading');
    heading.append(make('strong', '', title));
    const close = button('qa-close', '×', 'Close ' + title);
    close.onclick = () => closePanel(true);
    heading.append(close);
    chooser.append(heading);
    return true;
  }
  function showGifs() {
    if (!panel('gif', 'GIF keyboard')) return;
    gif.setAttribute('aria-expanded', 'true');
    const sources = make('div', 'qa-sources');
    sources.setAttribute('role', 'group');
    sources.setAttribute('aria-label', 'GIF library');
    const search = make('input', 'qa-search');
    search.type = 'search';
    search.maxLength = 120;
    search.setAttribute('aria-label', 'Search reaction GIFs');
    const shortcuts = make('div', 'qa-suggestions');
    for (const word of ['This is fine', 'The Office', 'Side eye', 'Popcorn']) {
      const chip = button('qa-chip', word, 'Search for ' + word);
      chip.onclick = () => { search.value = word; refresh(); };
      shortcuts.append(chip);
    }
    const grid = make('div', 'qa-grid');
    const message = make('p', 'qa-source-status');
    message.setAttribute('role', 'status');
    const actions = make('div', 'qa-result-actions');
    const more = button('qa-online', 'More GIFs');
    const retry = button('qa-online','Retry search');
    const credit = make('a', 'qa-credit');
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    actions.append(credit, more, retry);
    chooser.append(sources, search, shortcuts, message, grid, actions);

    let library = 'Meme GIFs';
    let nextPage = null, failedPage = 1;
    const seen = new Set();
    const isCurrent = ctl => alive && onlineRequest === ctl && chooser.contains(grid);
    function addTile(item) {
      const key = item.key || item.src;
      if (seen.has(key)) return;
      seen.add(key);
      const option = button('qa-option', '', 'Insert ' + item.name);
      const image = make('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      image.src = reduce && item.still ? item.still : item.preview;
      if (reduce && library !== 'Emoji') {
        image.onload = () => {
          // Some provider posters are themselves animated. Freeze the decoded frame.
          const canvas = make('canvas');
          canvas.width = 180;
          canvas.height = Math.max(1, Math.min(420, Math.round(180 * image.naturalHeight / image.naturalWidth)));
          canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
          image.replaceWith(canvas);
        };
      }
      const fallbacks = [...new Set([item.src, item.still].filter(Boolean))].filter(url => url !== image.getAttribute('src'));
      image.onerror = () => {
        if (fallbacks.length) { image.src = fallbacks.shift(); return; }
        option.remove();
        if (!grid.childElementCount) message.textContent = 'The previews could not load. Try another search.';
      };
      option.append(image, make('span', '', item.name));
      option.onclick = () => {
        ++uploadVersion; busy = false;
        const credit = library === 'Meme GIFs' ? {id:item.id, source:item.source} : null;
        putImage(item.src, item.name, credit);
      };
      grid.append(option);
    }
    function refresh(delay = 0) {
      clearTimeout(pickerTimer);
      onlineRequest?.abort();
      onlineRequest = null;
      grid.setAttribute('aria-busy', 'false');
      grid.replaceChildren();
      grid.scrollTop = 0;
      seen.clear();
      nextPage = null;
      more.hidden = retry.hidden = true;
      const meme = library === 'Meme GIFs', emoji = library === 'Emoji';
      shortcuts.hidden = !meme;
      grid.classList.toggle('qa-meme-grid', !emoji);
      for (const control of sources.children) control.setAttribute('aria-pressed', String(control.textContent === library));
      search.placeholder = meme ? 'Search memes, shows, or reactions…' : emoji ? 'Search emoji reactions…' : 'Search Wikimedia Commons…';
      credit.textContent = meme ? 'Powered by GifSnap' : emoji ? 'Google Noto Emoji · CC BY 4.0' : 'Wikimedia Commons';
      credit.href = meme ? 'https://gifsnap.com/' : emoji ? 'assets/gifs/CREDITS.md' : 'https://commons.wikimedia.org/';
      const query = search.value.trim();
      if (emoji) {
        const words = query.toLowerCase().split(/\s+/);
        for (const item of gifs.filter(g => words.every(w => (g.name + ' ' + g.tags).toLowerCase().includes(w)))) {
          const base = 'assets/gifs/previews/' + item.id;
          addTile({ name:item.name, src:gifPath(item), preview:base+'.webp', still:base+'.png' });
        }
        message.textContent = seen.size ? '' : 'No matching emoji.';
      } else if (!meme && !query) {
        message.textContent = 'Enter a search to find public-domain GIFs.';
      } else {
        message.textContent = query ? 'Searching…' : 'Loading trending GIFs…';
        if (delay) pickerTimer = setTimeout(() => load(1), delay);
        else load(1);
      }
    }
    async function load(page) {
      onlineRequest?.abort();
      const controller = new AbortController();
      onlineRequest = controller;
      const timer = setTimeout(() => controller.abort(), 12000);
      const query = search.value.trim();
      more.hidden = retry.hidden = true;
      grid.setAttribute('aria-busy', 'true');
      if (page > 1) message.textContent = 'Loading more GIFs…';
      try {
        const result = library === 'Meme GIFs'
          ? await searchGifSnap(query, page, controller.signal)
          : { items:await searchCommons(query,controller.signal), nextPage:null };
        if (!isCurrent(controller)) return;
        for (const item of result.items) addTile(item);
        nextPage = result.nextPage;
        more.hidden = nextPage === null;
        message.textContent = !seen.size ? 'No GIFs found. Try another search.' : !query ? 'Trending GIFs' : '';
      } catch (error) {
        if (!isCurrent(controller)) return;
        failedPage = page;
        retry.hidden = false;
        message.textContent = error.message?.includes('busy') ? error.message : 'GIF search is unavailable. Retry or choose another library.';
      } finally {
        clearTimeout(timer);
        if (isCurrent(controller)) grid.setAttribute('aria-busy', 'false');
      }
    }
    for (const name of ['Meme GIFs','Emoji','Commons']) {
      const control = button('qa-source',name);
      control.onclick = () => { if (library !== name) { library = name; refresh(); } };
      sources.append(control);
    }
    more.onclick = () => { if (nextPage) load(nextPage); };
    retry.onclick = () => load(failedPage);
    search.oninput = () => refresh(300);
    search.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault();refresh(); }
    };
    refresh();
    if (matchMedia('(pointer: fine)').matches) search.focus();

  }
  function showLink() {
    if (!panel('link', 'Image or GIF link')) return;
    link.setAttribute('aria-expanded', 'true');
    const group = make('div', 'qa-link-row');
    const address = make('input', 'qa-search');
    address.type = 'url';
    address.placeholder = 'https://…';
    address.setAttribute('aria-label', 'Image or GIF URL');
    const apply = button('qa-add', 'Attach');
    async function attach() {
      const src = asImageUrl(address.value);
      if (!src) { status.textContent = 'Enter a full HTTPS image link.'; return; }
      apply.disabled = true;
      status.textContent = 'Opening image…';
      try {
        await loadImage(src);
        if (alive && chooser.contains(apply)) { ++uploadVersion; busy = false; putImage(src, 'Linked image'); }
      } catch (err) {
        if (alive && chooser.contains(apply)) status.textContent = err.message;
      } finally { apply.disabled = false; }
    }
    apply.onclick = attach;
    address.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); attach(); } };
    group.append(address, apply);
    chooser.append(group);
    address.focus();
  }
  for (const [control, command] of [[bold, 'bold'], [italic, 'italic']]) {
    control.setAttribute('aria-pressed', 'false');
    control.onmousedown = e => e.preventDefault();
    control.onclick = () => {
      restore();
      document.execCommand(command, false);
      remember();
      changed();
    };
  }
  gif.setAttribute('aria-expanded', 'false');
  link.setAttribute('aria-expanded', 'false');
  gif.onclick = showGifs;
  link.onclick = showLink;
  upload.onclick = () => { closePanel(); input.click(); };
  input.onchange = () => addFile(input.files[0]);
  remove.onclick = () => {
    ++uploadVersion; busy = false;
    field.querySelector('img')?.remove();
    restore();
    changed();
  };
  shell.onkeydown = e => {
    if (openPanel && e.key === 'Escape') { e.preventDefault(); closePanel(true); }
  };
  field.oninput = changed;
  field.onblur = remember;
  document.addEventListener('selectionchange', remember);
  field.onpaste = event => {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    remember();
    const file = Array.from(data.files).find(f => f.type.startsWith('image/'));
    if (file) { addFile(file); return; }
    const html = data.getData('text/html');
    if (html) {
      const template = document.createElement('template');
      template.innerHTML = html.slice(0, 200000);
      const cleaned = normalizeAnswer({ parts: readParts(template.content) });
      if (cleaned) {
        if (cleaned.parts.some(p => p.type === 'image')) field.querySelector('img')?.remove();
        insert(contentFragment(cleaned));
        return;
      }
    }
    const text = data.getData('text/uri-list') || data.getData('text/plain');
    const src = asImageUrl(text);
    if (src && (/\.(gif|jpe?g|webp|png|avif)(?:[?#]|$)/i.test(src) || /\/media\.giphy\.com\//.test(src))) {
      putImage(src, 'Pasted image');
    } else if (text) {
      const selectionLength = [...(currentRange()?.toString() || '')].length;
      const room = Math.max(0, MAX_TEXT - countValue + selectionLength);
      document.execCommand('insertText', false, [...text.slice(0, 2048)].slice(0, room).join(''));
      changed();
    }
  };
  field.ondragover = event => event.preventDefault();
  field.ondrop = event => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) addFile(file);
  };
  changed();
  return {
    getValue: value,
    focus: () => restore(),
    destroy() {
      clearTimeout(pickerTimer);
      alive = false;
      onlineRequest?.abort();
      document.removeEventListener('selectionchange', remember);
      shell.remove();
    }
  };
}
