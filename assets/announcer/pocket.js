// A small, phase-conditioned variable-order word language model. Its training
// corpus is distributed with the game. No player text enters the model.
import { scenes as authored } from './corpus.js';

const start = '^', stop = '$';
const tokenPattern = /\{\w+\}|[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[,!.?]/gu;
const choose = a => a[Math.floor(Math.random() * a.length)];
const models = new Map();
const sentenceShapes = new Map();
const scenes = {
  ...authored,
  bonus: [
    'A sweep bonus. Our {official} is having the broom engraved.',
    'Sweep bonus! The {prop} is looking up tiny brooms online.',
    'Bonus points for the sweep. Someone roll up the carpet before we get carried away.',
  ],
  noballots: [
    'No ballots. Our {official} can count that on zero hands.',
    'Nobody voted. Can we expense the unused pencils?',
    'The ballot box is empty. Somebody give it a snack.',
  ],
  picture: [
    'The picture took the vote. Our {official} is retiring the crayons.',
    'That picture got the room. Somebody buy the {prop} a frame.',
    'A thousand words and the picture still finished first.',
    'Apparently a face can deliver a punchline without paying microphone rental.',
  ],
  close: [
    'That was close. Our {official} had to put on the reading glasses.',
    'One ballot made the difference. Somebody buy that ballot a chair.',
    'A one-vote win. I have seen bigger margins on a sticky note.',
    'One vote apart. The {prop} is taking the evening off to recover.',
  ],
  landslide: [
    'An emphatic vote. The {prop} just scooted over to the winning side.',
    'That was decisive. Our {official} can put away the magnifying glass.',
    'No need for a photo finish. The photographer is already at the buffet.',
    'A comfortable margin. I wish my chair had one of those.',
  ],
  walkover: [
    'One answer made it to the stage. It gets the whole dressing room.',
    'A solo performance. Our {official} can finally work just one spotlight.',
    'One answer in the room. It took the good parking spot.',
  ],
  lead: [
    'A new leader. Our {official} is turning the little arrow around.',
    'The lead changed hands. Nobody laminated the seating chart, right?',
    'New name at the top. The {prop} is requesting an introduction.',
  ],
};
// Pairs share grammatical roles. Augmenting the corpus with one substitution
// per example lets word-by-word decoding learn novel combinations of them.
const variants = [
  ['our {official}', 'my {official}', 'the evening {official}'],
  ['the {prop}', 'our {prop}', 'that suspicious {prop}'],
  ['a little', 'a tiny bit', 'just a bit'],
  ['a very', 'a suspiciously', 'a remarkably'],
  ['Somebody', 'Someone'],
  ['somebody', 'someone'],
  ['the good', 'the fancy', 'the expensive'],
  ['the snacks', 'the pretzels', 'the nachos'],
  ['the parking lot', 'the break room', 'the stairwell'],
  ['the couch', 'the sofa', 'the snack table'],
  ['the folding chairs', 'the bar stools', 'the beanbags'],
  ['tiny', 'miniature', 'ridiculously small'],
  ['the microphone', 'the stage light', 'the soundboard'],
  ['a joke', 'a punchline', 'a one-liner'],
  ['Look at', 'Just look at', 'Would you look at'],
  ['a friend', 'your cousin', 'your bowling partner'],
  ['the chips', 'the salsa', 'the popcorn'],
  ['an eyebrow', 'a single eyebrow'],
  ['back of', 'underside of', 'side of'],
  ['Somewhere', 'Across town', 'Right this minute'],
];
function record(table, context, word, weight) {
  let counts = table.get(context);
  if (!counts) { counts = new Map(); table.set(context, counts); }
  counts.set(word, weight + (counts.get(word) || 0));
}
function train(table, line, weight) {
  const words = [start, start, start, ...(line.match(tokenPattern) || []), stop];
  for (let i = 3; i < words.length; i++) {
    for (const order of [1, 2, 3]) record(table, words.slice(i-order,i).join(' '), words[i], weight);
  }
}
function sentenceShape(line) {
  const escape = word=>word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  let pattern='';
  for (let i=0;i<line.length;) {
    const variantsHere=variants.find(([original])=>line.startsWith(original,i));
    if (variantsHere) {
      pattern+='(?:'+variantsHere.map(escape).join('|')+')';
      i+=variantsHere[0].length;
    } else { pattern+=escape(line[i]); i++; }
  }
  return pattern;
}
function prepare() {
  if (models.size) return;
  for (const [scene, examples] of Object.entries(scenes)) {
    const table = new Map();
    // Shared word contexts can cross an unrelated sentence halfway through.
    // Accept the sampled words only when an original sentence shape fits.
    sentenceShapes.set(scene,new RegExp('^(?:'+examples.map(sentenceShape).join('|')+')$'));
    for (const line of examples) {
      const examples = new Set([line]);
      for (const [from, ...alternatives] of variants) {
        if (!line.includes(from)) continue;
        for (const alt of alternatives) examples.add(line.replace(from, alt));
      }
      for (const variant of examples) train(table,variant,1/examples.size);
    }
    models.set(scene, table);
  }
}

function sample(counts) {
  let n = Math.random() * [...counts.values()].reduce((a,b)=>a+b,0);
  for (const [word, mass] of counts) if ((n -= mass) < 0) return word;
}
function generate(scene) {
  const table = models.get(scene) || models.get('reveal');
  const words = [start,start,start];
  for (let step = 0; step < 32; step++) {
    // Prefer the most specific context. Occasionally back off to let shared
    // phrases branch instead of reconstructing any one training example.
    const order = step > 4 && Math.random() < 0.16 ? 2 : 3;
    let counts;
    for (let n = order; n && !counts; n--) {
      counts = table.get(words.slice(-n).join(' '));
    }
    if (!counts) break;
    const word = sample(counts);
    if (!word || word === stop) break;
    words.push(word);
  }
  return words.slice(3).join(' ').replace(/ ([,!.?])/g,'$1');
}

const fingerprint = text => new Set(text.toLowerCase().match(/[a-z][a-z'-]+/g) || []);
function overlap(a,b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count++;
  return count / Math.max(1, Math.min(a.size,b.size));
}
const recentAcrossGames = [];

export function newShow() {
  return {
    prop: choose(['fog machine','disco ball','golden stapler','desk bell','cardboard trophy','velvet rope','confetti cannon','bowling trophy','spare microphone','tiny podium']),
    official: choose(['stage manager','accountant','sound engineer','clipboard inspector','applause coach','night janitor','prop detective','snack commissioner','wardrobe assistant','understudy']),
    history: [],
  };
}

export function pocketLine(scene, view, show) {
  prepare();
  const recent = [...recentAcrossGames, ...show.history.slice(-5)].map(fingerprint);
  const examples = new Set(scenes[scene] || scenes.reveal);
  const details = { prop:show.prop, official:show.official, round:view.round || 1, players:view.players?.length || 0 };
  const repeatedMotif = show.history.slice(-2).some(s=>s.includes(show.prop) || s.includes(show.official));
  let best = '', bestScore = -Infinity;
  for (let i=0; i<45; i++) {
    const candidate = generate(scene);
    if (!sentenceShapes.get(scene)?.test(candidate)) continue;
    if (candidate.length < 18 || candidate.length > 150 || !/[.!?]$/.test(candidate)) continue;
    const text = candidate.replace(/\{(\w+)\}/g, (_,k) => details[k] ?? '');
    const tokens = fingerprint(text);
    const seen = Math.max(0,...recent.map(words=>overlap(tokens,words)));
    const callback = candidate.includes('{prop}') || candidate.includes('{official}');
    const score = Math.random() * 1.4 - 2 * seen - (examples.has(candidate) ? 0.35 : 0) +
      (callback && !repeatedMotif ? 0.7 : 0);
    if (score > bestScore) { bestScore = score; best = text; }
  }
  if (best) { recentAcrossGames.push(best); if (recentAcrossGames.length > 14) recentAcrossGames.shift(); }
  return best;
}
