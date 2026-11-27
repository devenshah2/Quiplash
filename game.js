import { prompts, finalPrompts } from './prompts.js';
import { normalizeAnswer } from './rich.js';

const maxPlayers = 8;
const timers = { write: 90000, finalWrite: 45000, vote: 25000, finalVote: 40000, reveal: 7500, scores: 10000 };

export function createGame() {
  return {
    members: [], phase: 'lobby', round: 0, deadline: null, matches: [], index: 0,
    nextSeat: 1, nextMatch: 1, promptDeck: [], finalDeck: [],
  };
}

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function memberFor(game, id) {
  return game.members.find(member => member.id === id);
}

function contestants(game) {
  return game.members.filter(member => member.role === 'player');
}

function publicMember(member) {
  return { id: member.seat, name: member.name, role: member.role, connected: member.connected, score: member.score };
}

// The first eight connected lobby guests play. Once a game starts their seats are reserved.
function assignLobbySeats(game) {
  if (game.phase !== 'lobby') return;
  for (const member of game.members) {
    if (!member.connected) member.role = 'audience';
  }
  let available = maxPlayers - contestants(game).length;
  for (const member of game.members) {
    if (!available) break;
    if (member.connected && member.role === 'audience') {
      member.role = 'player';
      available--;
    }
  }
}

export function join(game, id, name) {
  if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Reconnect to join this room.');
  const previous = memberFor(game, id);
  if (previous) return setConnected(game, id, true);
  const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/gu, ' ') : '';
  if (!cleanName || Array.from(cleanName).length > 20 || /[\p{Cc}\p{Cf}]/u.test(cleanName.replaceAll('\u200d', ''))) {
    throw new Error('Enter a name between 1 and 20 characters.');
  }
  if (game.members.some(person => person.name.toLowerCase() === cleanName.toLowerCase())) {
    throw new Error('That name is taken. Try another.');
  }
  game.members.push({ id, seat: 'p' + game.nextSeat++, name: cleanName, role: 'audience', score: 0, connected: true });
  assignLobbySeats(game);
  return true;
}

export function setConnected(game, id, connected) {
  const member = memberFor(game, id);
  if (!member || member.connected === connected) return false;
  member.connected = Boolean(connected);
  assignLobbySeats(game);
  return true;
}

function dealPrompts(game, count) {
  const isFinal = game.round === 3;
  const key = isFinal ? 'finalDeck' : 'promptDeck';
  const bank = isFinal ? finalPrompts : prompts;
  const drawn = [];
  while (drawn.length < count) {
    if (!game[key].length) game[key] = shuffled(bank.filter(prompt => !drawn.includes(prompt)));
    drawn.push(game[key].pop());
  }
  return drawn;
}

function beginRound(game, now) {
  game.round++;
  const lineup = shuffled(contestants(game).map(member => member.seat));
  const final = game.round === 3;
  const roundPrompts = dealPrompts(game, final ? 1 : lineup.length);
  game.matches = shuffled(roundPrompts.map((prompt, i) => {
    // A random cycle gives each player two distinct opponents, including with odd player counts.
    const writers = final ? lineup : [lineup[i], lineup[(i + 1) % lineup.length]];
    const id = 'q' + game.nextMatch++;
    return {
      id, prompt,
      options: shuffled(writers).map((seat, n) => ({ id: id + '-' + n, seat, answer: null })),
      ballots: [], result: null,
    };
  }));
  game.index = 0;
  game.phase = 'write';
  game.deadline = now + (final ? timers.finalWrite : timers.write);
}

function ballotLimit(game, match, member) {
  if (!member || !member.connected || !match) return 0;
  if (game.round !== 3 && match.options.some(opt => opt.seat === member.seat)) return 0;
  if (!match.options.some(opt => opt.seat !== member.seat && opt.answer)) return 0;
  return game.round === 3 && member.role === 'player' ? 3 : 1;
}

function progress(game) {
  if (game.phase === 'write') {
    const options = game.matches.flatMap(match => match.options);
    return { done: options.filter(option => option.answer).length, total: options.length };
  }
  if (game.phase === 'vote') {
    const match = game.matches[game.index];
    const voters = game.members.filter(member => ballotLimit(game, match, member) > 0);
    // A ballot still counts if its voter disconnects after sending it.
    const voted = new Set(match.ballots.map(ballot => ballot.seat));
    return { done: voted.size, total: voted.size + voters.filter(member => !voted.has(member.seat)).length };
  }
  return { done: 0, total: 0 };
}

function surfaceAnswer(answer) {
  return JSON.stringify(answer.parts.map(part => part.type === 'image'
    ? ['image', part.src]
    : ['text', part.text.toLocaleLowerCase().trim(), !!part.bold, !!part.italic]));
}

function openVote(game, now) {
  const match = game.matches[game.index];
  const entries = match.options.filter(option => option.answer);
  const jinx = game.round !== 3 && entries.length === 2 &&
    surfaceAnswer(entries[0].answer) === surfaceAnswer(entries[1].answer);
  if (entries.length < 2 || jinx) {
    reveal(game, now, jinx ? 'jinx' : entries.length ? 'walkover' : 'empty');
    return;
  }
  game.phase = 'vote';
  game.deadline = now + (game.round === 3 ? timers.finalVote : timers.vote);
}

function reveal(game, now, outcome = 'vote') {
  const match = game.matches[game.index];
  const voters = new Map(game.members.map(member => [member.seat, member]));
  const counts = new Map(match.options.map(option => [option.id, { votes: 0, audienceVotes: 0 }]));
  let totalVotes = 0;
  let audienceVotes = 0;
  for (const ballot of match.ballots) {
    const audience = voters.get(ballot.seat)?.role === 'audience';
    for (const id of ballot.choices) {
      counts.get(id).votes++;
      totalVotes++;
      if (audience) {
        counts.get(id).audienceVotes++;
        audienceVotes++;
      }
    }
  }
  let unanimous = false;
  const results = match.options.map(option => {
    const count = counts.get(option.id);
    let points = 0;
    let sweep = false;
    if (outcome === 'walkover' && option.answer) {
      points = game.round === 3 ? 3000 : 1000 * game.round;
    } else if (totalVotes) {
      const share = count.votes / totalVotes;
      if (game.round === 3) {
        points = Math.round(share * 3000);
      } else {
        const playerVotes = totalVotes - audienceVotes;
        // A sweep requires three judging players and, when present, an audience majority.
        sweep = playerVotes >= 3 && count.votes - count.audienceVotes === playerVotes &&
          (!audienceVotes || count.audienceVotes > audienceVotes / 2);
        const bonus = sweep ? 250 : share > 0.5 ? 100 : 0;
        points = (Math.round(share * 1000) + bonus) * game.round;
      }
    }
    unanimous ||= sweep;
    voters.get(option.seat).score += points;
    return { ...count, points, sweep };
  });
  match.result = { options: results, unanimous, outcome };
  game.phase = 'reveal';
  game.deadline = now + timers.reveal;
}

function advance(game, now) {
  switch (game.phase) {
    case 'write':
      openVote(game, now);
      break;
    case 'vote':
      reveal(game, now);
      break;
    case 'reveal':
      if (game.index + 1 < game.matches.length) {
        game.index++;
        openVote(game, now);
      } else {
        game.phase = game.round === 3 ? 'end' : 'scores';
        game.deadline = game.phase === 'end' ? null : now + timers.scores;
      }
      break;
    case 'scores':
      beginRound(game, now);
      break;
    default:
      return false;
  }
  return true;
}

export function tick(game, now = Date.now()) {
  return game.deadline !== null && now >= game.deadline ? advance(game, now) : false;
}

export function act(game, id, action, now = Date.now()) {
  const host = id === null;
  if (host) {
    switch (action?.type) {
      case 'start':
        if (game.phase !== 'lobby') return false;
        if (contestants(game).length < 3) throw new Error('Three players need to join before you can start.');
        beginRound(game, now);
        return true;
      case 'next':
        return advance(game, now);
      case 'restart':
        if (game.phase !== 'end') return false;
        game.phase = 'lobby';
        game.round = 0;
        game.index = 0;
        game.deadline = null;
        game.matches = [];
        game.members = game.members.filter(member => member.connected);
        for (const member of game.members) member.score = 0;
        assignLobbySeats(game);
        return true;
      default:
        throw new Error('Choose a host control on this screen.');
    }
  }

  const member = memberFor(game, id);
  if (!member?.connected) throw new Error('Reconnect to the room first.');
  if (game.deadline !== null && now >= game.deadline) throw new Error('Time is up.');
  if (action?.type === 'answer') {
    if (game.phase !== 'write') throw new Error('The writing round has ended.');
    const match = game.matches.find(item => item.id === action.promptId);
    const option = match?.options.find(item => item.seat === member.seat);
    if (!option) throw new Error('That prompt belongs to another player.');
    if (option.answer) return false;
    const answer = normalizeAnswer(action.answer);
    if (!answer) throw new Error('Add a valid answer before submitting.');
    option.answer = answer;
  } else if (action?.type === 'vote') {
    if (game.phase !== 'vote') throw new Error('Voting has ended.');
    const match = game.matches[game.index];
    if (match.ballots.some(ballot => ballot.seat === member.seat)) return false;
    const limit = ballotLimit(game, match, member);
    if (!limit) throw new Error('The other players vote on this matchup.');
    const choices = action.choices;
    if (!Array.isArray(choices) || choices.length !== limit) {
      throw new Error('Choose ' + limit + (limit === 1 ? ' vote.' : ' votes. You can back an answer more than once.'));
    }
    for (const choice of choices) {
      const option = match.options.find(item => item.id === choice);
      if (!option?.answer || option.seat === member.seat) throw new Error('Choose an answer written by another player.');
    }
    match.ballots.push({ seat: member.seat, choices: [...choices] });
  } else {
    throw new Error('That control belongs to the host.');
  }
  const { done, total } = progress(game);
  if (total && done === total) advance(game, now);
  return true;
}

export function view(game, id = null) {
  const member = memberFor(game, id);
  const voting = game.phase === 'vote';
  const revealing = game.phase === 'reveal';
  const match = (voting || revealing) ? game.matches[game.index] : null;
  const limit = voting ? ballotLimit(game, match, member) : 0;
  const voted = Boolean(member && match?.ballots.some(ballot => ballot.seat === member.seat));
  return {
    phase: game.phase, round: game.round, deadline: game.deadline,
    players: contestants(game).map(publicMember),
    audienceCount: game.members.filter(member => member.role === 'audience' && member.connected).length,
    me: member ? publicMember(member) : null,
    tasks: game.phase === 'write' && member ? game.matches.flatMap(match => {
      const opt = match.options.find(option => option.seat === member.seat);
      return opt ? [{ id: match.id, prompt: match.prompt, submitted: Boolean(opt.answer) }] : [];
    }) : [],
    progress: progress(game),
    matchup: match ? {
      id: match.id, prompt: match.prompt, number: game.index + 1, total: game.matches.length,
      options: match.options.map((opt, i) => {
        const result = { id: opt.id, answer: opt.answer, missing: !opt.answer, mine: opt.seat === member?.seat };
        if (revealing) {
          const author = game.members.find(member => member.seat === opt.seat);
          Object.assign(result, match.result.options[i], { author: author.name, authorId: author.seat });
        }
        return result;
      }),
      ...(revealing ? { unanimous: match.result.unanimous, outcome: match.result.outcome } : {}),
    } : null,
    voteLimit: limit, canVote: limit > 0 && !voted, voted,
  };
}
