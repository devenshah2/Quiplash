import { icon, escapeText as e, badge, button } from './ui.js';

const swatches = ['#ff987e','#c09af3','#e0f88b','#9dddd7','#ffc877','#ffb9d7','#aac8ff','#f7ea9f'];
function avatar(player) {
  const n = Number(String(player.id).slice(1)) || 1;
  return `<span aria-hidden="true" class="avatar" style="--tint:${swatches[(n - 1) % swatches.length]}">${e(Array.from(player.name)[0]?.toUpperCase())}</span>`;
}
function playerToken(p) {
  return `<span class="player-token${p.connected ? '' : ' away'}">${avatar(p)}${e(p.name)}${p.connected ? '' : ' · away'}</span>`;
}
function roster(v) {
  return `<div class="roster">${v.players.map(playerToken).join('')}</div>${v.audienceCount ? `<p class="muted">${v.audienceCount} in the audience</p>` : ''}`;
}
function landing() {
  return `<section class="hero" aria-label="Punchline comedy party game">
    <img class="hero-art" src="./assets/emcee.webp" alt="A grinning, bow-tied microphone stepping into the spotlight">
    <div class="hero-copy"><div class="hero-kicker">${icon('bolt')} COMEDY PARTY GAME</div><br>
    <h1 class="hero-type">PUNCH<span>LINE!</span></h1>
    <p>Answer with words, GIFs, or pictures. Win the room with the funniest one.</p></div></section>
    <div class="meta"><span>${icon('players')}3–8 players</span><i></i><span>${icon('cards')}3 rounds</span><i></i><span>${icon('clock')}About 15 min</span></div>
    <div class="entry-grid"><section class="entry-card"><div class="card-heading"><span class="stamp">${icon('screen')}</span><h2>Host a game</h2></div>
    <p>Open the host screen and invite friends with a four-letter room code.</p><div class="card-foot">${button('Create a room','host','primary','play')}</div></section>
    <section class="entry-card"><div class="card-heading"><span class="stamp alt">${icon('phone')}</span><h2>Join a game</h2></div>
    <p>Grab the code from your host and use this device as your controller.</p>
    <form class="card-foot form-row" id="code-form"><input required maxlength="4" minlength="4" pattern="[A-Za-z]{4}" name="code" class="field room-field" autocapitalize="characters" spellcheck="false" placeholder="Room code" aria-label="Four-letter room code"><button class="btn secondary" type="submit">${icon('ticket')}Join room</button></form></section></div>`;
}
function fieldJoin(code, message='') {
  return `<span class="stamp alt">${icon('phone')}</span><h2 id="modal-title">Join the room</h2>
    <form id="join-form"><label for="join-code">Room code</label><input id="join-code" class="field room-field" name="code" required maxlength="4" minlength="4" pattern="[A-Za-z]{4}" autocapitalize="characters" spellcheck="false" value="${e(code)}">
    <label for="player-name">Player name</label><input name="name" id="player-name" class="field" autocomplete="nickname" required maxlength="20" placeholder="Your name" autofocus>
    <div role="alert" class="error">${e(message)}</div><button class="btn secondary" type="submit">${icon('ticket')}Join room</button></form>`;
}
function rules() {
  return `<span class="stamp">${icon('mic')}</span><h2 id="modal-title">How to play</h2><ol class="help-list">
  <li><strong>Gather the room.</strong> Open the host screen on a computer or TV. Each of the 3–8 players joins on a phone. Extra guests can vote from the audience.</li>
  <li><strong>Write two answers.</strong> You and a rival get the same prompt. Use text, bold, italics, a GIF, or a picture to land the joke.</li>
  <li><strong>Pick a favorite.</strong> Everyone else votes before the authors are revealed. Round two doubles the points.</li>
  <li><strong>Take the final round.</strong> Everyone answers one prompt. Players get three votes to stack or split. The highest total wins.</li></ol>`;
}
function roomTicket(code, invite, qr) {
  return `<section class="panel room-ticket"><div class="ticket-details"><div><strong>Room code</strong><div data-testid="room-code" class="big-code">${e(code)}</div></div>
  <div class="qr" role="img" aria-label="QR code to join this room">${qr}</div></div><p>Scan to join, or enter the code at<br><span class="room-url">${e(new URL(invite).host + new URL(invite).pathname)}</span></p>
  <div class="share-actions"><button class="small-action" data-act="copy">${icon('link')}Copy invite link</button></div></section>`;
}
function lobby(v, host, code, invite, qr) {
  const count=v.players.filter(p=>p.connected).length;
  if (!host) return `<section class="panel solo-panel"><span class="stamp alt">${icon(v.me?.role==='audience'?'clap':'check')}</span><h1>${v.me?.role==='audience'?'You’re in the audience!':'You’re in!'}</h1>
    <p class="muted">Playing as <strong>${e(v.me?.name)}</strong>. The host will start the game when everyone’s here.</p><h3>In the room</h3>${roster(v)}</section>`;
  return `<div class="game-top"><div><h1>The green room</h1><div class="round-meta">${badge('Host screen','purple','screen')}<span class="muted">Keep this tab open during the game.</span></div></div></div>
    <div class="lobby-grid">${roomTicket(code,invite,qr)}
    <section class="panel"><div class="game-top"><h2>Players</h2>${badge(count+' / 8','lime','players')}</div>${roster(v)}
    ${count<3?`<p class="muted">Waiting for ${3-count} more player${count===2?'':'s'} to start.</p>`:''}
    ${button('Start game','start','primary','play',count<3)}</section></div>`;
}
function phaseHead(v, host) {
  let title={write:'Writing time',vote:'Cast your vote',reveal:'The reveal',scores:'Scoreboard',end:'Final scores'}[v.phase]||'On stage';
  return `<div class="game-top"><div><div class="round-meta">${badge(v.round===3?'Final round':'Round '+v.round,'purple','cards')}${v.me?.role==='audience'?badge('Audience','lime','clap'):''}</div>
  <h1 style="margin-top:8px">${title}</h1></div>${v.deadline?`<span class="timer">${icon('clock')}<span data-clock></span></span>`:''}</div>`;
}
function writing(v, host) {
  const task=v.tasks.find(t=>!t.submitted);
  if (task) return `<section class="panel phase-panel"><div class="phase-label">Your prompt ${v.tasks.findIndex(t=>t.id===task.id)+1} of ${v.tasks.length}</div>
  <h2 class="prompt">${e(task.prompt)}</h2><div id="editor"></div><div class="host-controls">${button('Submit answer','submit-answer','secondary','check',true)}</div></section>`;
  const label = host ? 'Eyes on your phones!' : v.me?.role==='audience' ? 'The players are writing.' : 'Answers are in!';
  const info = host ? 'Players are writing their answers. The matchups begin when everyone submits or time runs out.' : 'Voting starts when the writing round ends.';
  return `<section class="panel phase-panel waiting-stage">${host?'<img class="stage-mascot" src="./assets/emcee.webp" alt="">':''}<div class="waiting-copy"><h2>${label}</h2><p class="muted">${info}</p>
  <div class="progressbar" aria-hidden="true"><span data-progress-bar></span></div><p class="progresscopy" data-progress></p></div></section>`;
}
function showMatch(v, host, choices) {
  const m=v.matchup;
  const reveal=v.phase==='reveal';
  const topVotes=reveal?Math.max(...m.options.map(o=>o.votes)):0;
  const reason={jinx:'Jinx! Both writers gave the same answer.',walkover:'Only one answer came in.',empty:'Time ran out on this prompt.'}[m.outcome];
  const untilVote = v.voted ? 'Vote locked in.' : v.canVote ? (v.voteLimit===3 ? 'Give out three votes. You can stack them on a favorite.' : 'Choose the answer that made you laugh.') : 'The other players are voting on your matchup.';
  return `<section class="panel phase-panel"><span class="phase-label">${v.round===3?'One prompt for everyone':'Matchup '+m.number+' of '+m.total}</span><h2 class="prompt">${e(m.prompt)}</h2>
    ${reason?`<p class="vote-nudge">${reason}</p>`:''}${!reveal&&!host?`<p class="muted">${untilVote}</p>`:''}
    <div class="options">${m.options.map((o,i)=>`<article class="option${reveal&&topVotes>0&&o.votes===topVotes?' top-answer':''}"><div class="choice-meta"><span class="letter">${String.fromCharCode(65+i)}</span>${o.mine?'Your answer':''}${o.sweep?badge('Clean sweep','lime','bolt'):''}</div>
    <div class="answer-body" data-answer="${i}">${o.missing?'No answer in time':''}</div>
    ${reveal?`<p class="breakdown"><strong>${e(o.author)}</strong><br>${o.votes} ${o.votes===1?'vote':'votes'} · +${o.points.toLocaleString()} pts</p>`:''}
    ${!reveal&&v.canVote&&!o.mine&&!o.missing?`<button class="btn neutral" data-vote="${e(o.id)}" aria-label="Vote for answer ${String.fromCharCode(65+i)}">${v.voteLimit===1?'Choose '+String.fromCharCode(65+i):'Add vote'}${choices.includes(o.id)?` (${choices.filter(id=>id===o.id).length})`:''}</button>`:''}</article>`).join('')}</div>
    ${!reveal&&v.canVote?`<div class="vote-tools"><span>${choices.length} of ${v.voteLimit} selected</span><div class="share-actions">${choices.length?button('Clear','clear','ghost'):''}${button('Lock in vote','cast','secondary','check',choices.length!==v.voteLimit)}</div></div>`:''}
    ${!reveal&&(host||v.voted)?'<p class="progresscopy" data-progress></p>':''}</section>`;
}
function scores(v) {
  const sorted=[...v.players].sort((a,b)=>b.score-a.score);
  const leaders=sorted.filter(p=>p.score===sorted[0]?.score);
  const title=v.phase==='end'?(leaders.length===1?leaders[0].name+' wins!':leaders.map(p=>p.name).join(' & ')+' tie!'):'Standings after round '+v.round;
  return `<section class="panel phase-panel">${badge(v.phase==='end'?'Winner’s circle':'Standings','lime','crown')}<h2 class="prompt">${e(title)}</h2>
    <ol class="board">${sorted.map((p,i)=>`<li><span class="rank">#${1+sorted.findIndex(a=>a.score===p.score)}</span>${avatar(p)}<span class="name">${e(p.name)}</span><strong>${p.score.toLocaleString()} pts</strong></li>`).join('')}</ol></section>`;
}
function stage(v, host, code, invite, qr, choices) {
  let header=`<div class="game-nav"><div class="room-strip">${icon('ticket')}Room ${e(code)}<span class="presence" data-connection></span></div><button class="small-action" data-act="leave">${icon('exit')}${host?'End room':'Leave room'}</button></div>`;
  if(v.phase==='lobby') return header+lobby(v,host,code,invite,qr);
  let body=v.phase==='write'?writing(v,host):v.matchup?showMatch(v,host,choices):scores(v);
  let controls='';
  if(host) {
    const labels={write:'End writing early',vote:'Close voting early',reveal:'Continue',scores:'Next round',end:'Play again'};
    controls=`<div class="host-controls">${button(labels[v.phase],v.phase==='end'?'restart':'next',v.phase==='end'?'primary':'ghost',v.phase==='end'?'play':'')}</div>`;
  }
  return header+phaseHead(v,host)+body+controls;
}

export {landing,fieldJoin,rules,stage};
