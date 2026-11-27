// These endpoints exist only in the opt-in local Mac launcher.
export function isSteamLauncher() {
  const url = globalThis.location;
  return !!url && ['localhost', '127.0.0.1'].includes(url.hostname) && new URLSearchParams(url.search).has('steam');
}

export function parseSteamQuestions(payload) {
  if (!Array.isArray(payload?.content)) return [];
  const bank = [];
  const seenIds = new Set();
  const seenPrompts = new Set();
  for (const row of payload.content) {
    if (!row || row.includesPlayerName || typeof row.prompt !== 'string') continue;
    const id = String(row.id ?? '');
    if (!/^\d{1,10}$/.test(id) || seenIds.has(id)) continue;
    const prompt = row.prompt.replace(/<blank>/gi, '_____').replace(/<\/?i>/gi, '').trim();
    // Skip unresolved game-specific names, formatting, and variable placeholders.
    if (!prompt || prompt.length > 400 || /[<>{}\u0000-\u001f]/.test(prompt) || seenPrompts.has(prompt)) continue;
    bank.push({ id, prompt });
    seenIds.add(id);
    seenPrompts.add(prompt);
  }
  return bank;
}

export async function loadSteamQuestions() {
  if (!isSteamLauncher()) return [];
  try {
    const response = await fetch('/_steam/questions', { cache: 'no-store', redirect: 'error' });
    return response.ok ? parseSteamQuestions(await response.json()) : [];
  } catch { return []; }
}

export function useSteamQuestions(game, pack) {
  // A full eight-player game needs sixteen different head-to-head prompts.
  if (game.phase !== 'lobby' || !Array.isArray(pack) || pack.length < 16) return false;
  game.steamQuestions = pack;
  game.steamDeck = [];
  return true;
}
