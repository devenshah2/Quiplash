import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, join, setConnected, act, tick, view } from '../game.js';

const now = 100000;
const text = value => ({ parts: [{ type: 'text', text: value }] });
function fillRoom(count) {
  const game = createGame();
  for (let n = 1; n <= count; n++) join(game, 'secret-' + n, 'Guest ' + n);
  return game;
}
const host = (game, type) => act(game, null, { type }, now);
function writeAll(game) {
  for (const m of game.members) {
    for (const task of view(game, m.id).tasks) {
      act(game, m.id, { type: 'answer', promptId: task.id, answer: text(m.name + ' ' + task.id) }, now);
    }
  }
}
function voteAll(game) {
  for (const m of game.members) {
    const snapshot = view(game, m.id);
    if (!snapshot.canVote) continue;
    const favorite = snapshot.matchup.options.find(opt => !opt.mine && !opt.missing);
    act(game, m.id, { type: 'vote', choices: Array(snapshot.voteLimit).fill(favorite.id) }, now);
  }
}

test('complete games for every player count, including a serialized host recovery', () => {
  for (let count = 3; count <= 8; count++) {
    let game = fillRoom(count);
    host(game, 'start');
    join(game, 'secret-spectator', 'Spectator');
    const seen = new Set();
    for (let round = 1; round <= 3; round++) {
      assert.equal(game.phase, 'write');
      assert.equal(game.round, round);
      assert.deepEqual(view(game, 'secret-spectator').tasks, []);
      const tasks = view(game, 'secret-1').tasks;
      assert.equal(tasks.length, round === 3 ? 1 : 2);
      for (const match of game.matches) {
        assert.equal(seen.has(match.prompt), false);
        seen.add(match.prompt);
        assert.equal(new Set(match.options.map(o => o.seat)).size, round === 3 ? count : 2);
      }
      writeAll(game);
      while (game.phase === 'vote') {
        const snapshot = view(game);
        assert.equal(JSON.stringify(snapshot).includes('secret-'), false);
        assert.equal(snapshot.matchup.options.some(o => 'author' in o || 'votes' in o), false);
        if (round === 3) {
          const player = view(game, 'secret-1');
          assert.equal(player.voteLimit, 3);
          assert.equal(view(game, 'secret-spectator').voteLimit, 1);
          const own = player.matchup.options.find(o => o.mine).id;
          assert.throws(() => act(game, 'secret-1', { type: 'vote', choices: [own, own, own] }, now));
        }
        game = JSON.parse(JSON.stringify(game));
        voteAll(game);
        assert.equal(game.phase, 'reveal');
        assert.ok(view(game).matchup.options.every(o => o.author && Number.isInteger(o.points)));
        host(game, 'next');
      }
      if (round < 3) {
        assert.equal(game.phase, 'scores');
        host(game, 'next');
      }
    }
    assert.equal(game.phase, 'end');
    assert.ok(view(game).players.some(p => p.score > 0));
    assert.equal(tick(game, Infinity), false);
    host(game, 'restart');
    assert.equal(game.phase, 'lobby');
    assert.ok(view(game).players.every(p => p.score === 0));
  }
});

test('seating, disconnection, authenticated turns and immutable submissions', () => {
  const game = fillRoom(9);
  assert.equal(view(game).players.length, 8);
  assert.equal(view(game, 'secret-9').me.role, 'audience');
  setConnected(game, 'secret-2', false);
  assert.equal(view(game, 'secret-9').me.role, 'player');
  setConnected(game, 'secret-2', true);
  assert.equal(view(game, 'secret-2').me.role, 'audience');
  assert.equal(view(game, 'secret-9').me.role, 'player');
  assert.throws(() => join(game, 'x', 'guest 3'));
  host(game, 'start');
  const player = game.members[0];
  assert.throws(() => act(game, player.id, { type: 'next' }, now));
  const otherTask = game.matches.find(m => !m.options.some(o => o.seat === player.seat));
  assert.throws(() => act(game, player.id, { type: 'answer', promptId: otherTask.id, answer: text('oops') }, now));
  const task = view(game, player.id).tasks[0];
  const answer = { type: 'answer', promptId: task.id, answer: text('OK') };
  assert.throws(() => act(game, player.id, { ...answer, answer: text('    ') }, now));
  assert.throws(() => act(game, player.id, answer, game.deadline));
  assert.ok(act(game, player.id, answer, now));
  assert.equal(act(game, player.id, { ...answer, answer: text('duplicate') }, now), false);
  setConnected(game, player.id, false);
  assert.throws(() => act(game, player.id, answer, now));
  join(game, player.id, player.name);
  assert.equal(view(game, player.id).tasks[0].submitted, true);
  assert.equal(view(game, player.id).me.role, 'player');
});

test('walkovers, same answers and empty matchups score once and advance on timers', () => {
  const game = fillRoom(3);
  host(game, 'start');
  for (let i = 0; i < 2; i++) {
    const match = game.matches[i];
    for (const option of match.options.slice(0, i + 1)) {
      const id = game.members.find(member => member.seat === option.seat).id;
      act(game, id, { type: 'answer', promptId: match.id, answer: text('one') }, now);
    }
  }
  assert.equal(tick(game, game.deadline - 1), false);
  tick(game, game.deadline);
  assert.equal(view(game).matchup.outcome, 'walkover');
  assert.equal(view(game).players.reduce((n, p) => n + p.score, 0), 1000);
  tick(game, game.deadline);
  assert.equal(view(game).matchup.outcome, 'jinx');
  tick(game, game.deadline);
  assert.equal(view(game).matchup.outcome, 'empty');
  tick(game, game.deadline);
  assert.equal(game.phase, 'scores');
  assert.equal(view(game).players.reduce((n, p) => n + p.score, 0), 1000);
});

test('duel ballot exclusions, missing votes, majority bonus and audience counting', () => {
  const game = fillRoom(5);
  host(game, 'start');
  join(game, 'extra', 'Ada');
  writeAll(game);
  const snapshot = view(game);
  for (const m of game.members) {
    const player = view(game, m.id);
    if (!player.canVote) {
      assert.throws(() => act(game, m.id, { type: 'vote', choices: [snapshot.matchup.options[0].id] }, now));
      continue;
    }
    const option = snapshot.matchup.options[0];
    act(game, m.id, { type: 'vote', choices: [option.id] }, now);
    if (game.phase === 'vote') {
      assert.equal(act(game, m.id, { type: 'vote', choices: [option.id] }, now), false);
    }
  }
  const result = view(game).matchup;
  assert.equal(result.unanimous, true);
  assert.equal(result.options[0].points, 1250);
  assert.equal(result.options[0].votes, 4);
  assert.equal(result.options[0].audienceVotes, 1);
});

test('local launcher question text and host-only audio IDs, including restored and final rounds', async () => {
  const { parseSteamQuestions, useSteamQuestions, loadSteamQuestions } = await import('../steam-questions.js');
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: String(910000 + i), prompt: 'Synthetic fixture ' + i + ': <i>turn</i> <BLANK>.', includesPlayerName: false,
  }));
  const bank = parseSteamQuestions({ content: [...rows, rows[0],
    { id: '12345', prompt: 'An answer from <ANY PLAYER>' },
    { id: '54321', prompt: 'Reserved', includesPlayerName: true },
    { id: '../bad', prompt: 'Bad path' },
  ] });
  assert.equal(bank.length, 20);
  assert.ok(bank.every(({ prompt }) => prompt.endsWith('turn _____.')));
  assert.deepEqual(await loadSteamQuestions(), []); // off-launcher
  let game = fillRoom(8);
  assert.equal(useSteamQuestions(game, bank.slice(0, 2)), false);
  assert.equal(useSteamQuestions(game, bank), true);
  host(game, 'start');
  join(game, 'audience', 'Voice Fan');
  for (let round = 1; round <= 2; round++) {
    assert.ok(game.matches.every(match => match.localPromptAudioId));
    for (const member of game.members) {
      const s = JSON.stringify(view(game, member.id));
      assert.doesNotMatch(s, /localPromptAudioId|9100\d\d|_steam|steamQuestions/);
    }
    writeAll(game);
    while (game.phase === 'vote') {
      const hostView = view(game);
      assert.ok(bank.some(q => q.id === hostView.localPromptAudioId && q.prompt === hostView.matchup.prompt));
      for (const member of game.members) {
        assert.doesNotMatch(JSON.stringify(view(game, member.id)), /localPromptAudioId|9100\d\d|_steam|steamQuestions/);
      }
      voteAll(game);
      assert.equal('localPromptAudioId' in view(game), false);
      host(game, 'next');
    }
    game = JSON.parse(JSON.stringify(game));
    host(game, 'next');
  }
  assert.equal(game.round, 3);
  assert.ok(!game.matches[0].prompt.startsWith('Synthetic fixture'));
  writeAll(game);
  assert.equal('localPromptAudioId' in view(game), false);
});
