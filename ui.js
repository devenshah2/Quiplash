const paths = {
  mic: '<rect x="8" y="2" width="8" height="14" rx="4"/><path d="M8 6h8M8 9h8M5 11v1a7 7 0 0 0 14 0v-1m-7 8v3m-4 0h8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.35 2.35 0 1 1 3.6 2c-1.2.6-1.4 1.2-1.4 2m0 3h.01"/>',
  speaker: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M3 9h4l5-4v14l-5-4H3zM16 9l6 6m0-6-6 6"/>',
  screen: '<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
  players: '<circle cx="9" cy="8" r="3"/><path d="M2 20v-2c0-6 14-6 14 0v2m0-14a3 3 0 0 1 0 5m2 3c3 .5 4 2 4 5"/>',
  cards: '<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M5 17 3 5a2 2 0 0 1 2-2l10-1m-1 9v6m-3-3h6"/>',
  clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2m-6-13h6"/>',
  play: '<path d="m7 4 13 8-13 8Z" fill="currentColor" stroke-width="1"/>',
  ticket: '<path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM15 6v2m0 3v2m0 3v2"/>',
  link: '<path d="m10 13 4-4m-4 7-2 2a4 4 0 1 1-6-6l4-4a4 4 0 0 1 6 0m0 8a4 4 0 0 0 6 0l4-4a4 4 0 1 0-6-6l-2 2"/>',
  check: '<path d="m4 12 5 6L21 5"/>',
  crown: '<path d="m2 6 5 5 5-8 5 8 5-5-3 13H5zM6 22h12"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  pencil: '<path d="m3 15 12-12a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3L9 21l-7 1zM14 5l5 5"/>',
  clap: '<path d="m3 15 4-3 3 2 6-8a2 2 0 0 1 3 2l-4 6 3-2c2-1 3 1 2 3l-4 5c-2 2-5 3-8 1zM3 5l3 3m2-6 1 4m4-5-1 3"/>',
  hash: '<path d="m9 2-4 20m14-20-4 20M2 9h19M1 15h19"/>',
  exit: '<path d="M10 4H4v16h6m3-13 5 5-5 5m-5-5h12"/>',
  bolt: '<path d="M13 1 3 14h7l-1 9 12-15h-8z" fill="currentColor"/>',
};
export function icon(name) {
  return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || '') + '</svg>';
}
export function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
export function badge(name, color, symbol) {
  return '<span class="badge ' + color + '">' + (symbol ? icon(symbol) : '') + escapeText(name) + '</span>';
}
export function button(label, action, style = 'primary', glyph = '', disabled = false) {
  return '<button type="button" data-act="' + action + '" class="btn ' + style + '"' + (disabled ? ' disabled' : '') + '>' + (glyph ? icon(glyph) : '') + escapeText(label) + '</button>';
}
