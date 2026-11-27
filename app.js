import { hostRoom, joinRoom } from './network.js';
import { createGame, join, setConnected, act, tick, view } from './game.js';
import { createEditor } from './editor.js';
import { renderAnswer } from './rich.js';
import { loadSteamQuestions, useSteamQuestions } from './steam-questions.js';
import { sound, steamCueIds } from './audio.js';
import { icon, escapeText as e, button } from './ui.js';
import { landing, fieldJoin, rules, stage } from './screens.js';

const $=s=>document.querySelector(s);
const main=$('#screen'), modal=$('#modal');
const params=new URLSearchParams(location.search);
const loopback=['localhost','127.0.0.1'].includes(location.hostname);
const localSteam=loopback&&params.has('steam');
const localLauncher=localSteam||(loopback&&params.has('launcher'));
const publicBase='https://devenshah.com/Quiplash/';
const tabKey='punchline.session.v1';
const saved = (k) => {try {return JSON.parse(sessionStorage.getItem(k));} catch {return null;}};
const save = (k,v) => {try {if(v===null)sessionStorage.removeItem(k);else sessionStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
let room='',role='',net=null,game=null,snapshot=null,conn='',revision=0,renderKey='',editor=null,taskKey='',timeSkew=0;
let choices=[],selectionKey='',qr='',invite='',joinName='',toastTimer,pending=false,muted=false,sessionWarning=false;
const sentMatch=new Map();
try {muted=localStorage.getItem('punchline.muted')==='yes';}catch{}
sound.setMuted(muted);
function notify(text) {
  const toast=$('#toast');toast.textContent=text;toast.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),4000);
}
function glyphs() {
  document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
  $('.sound-open').innerHTML=icon(muted?'muted':'speaker');
}
function openDialog(html) {
  $('#modal-body').innerHTML=html;
  if(!modal.open)modal.showModal();
}
function closeDialog() {if(modal.open)modal.close();}
function showJoin(code,msg='') {
  openDialog(fieldJoin(code,msg));
  $('#player-name').value=joinName;
  $('#player-name').focus();
}
function urlFor(mode,code) {
  const url=new URL(location.pathname,location.origin);
  if(mode&&code)url.searchParams.set(mode,code);
  if(localLauncher && mode!=='room')url.searchParams.set(localSteam?'steam':'launcher','1');
  history.replaceState(null,'',url);
}
function setRoom(code) {
  room=code;
  const u=localLauncher?new URL(publicBase):new URL(location.pathname,location.origin);
  u.searchParams.set('room',code);invite=u.href;
  qr='';
  if(role==='host'&&window.qrcode) {
    const generator=window.qrcode(0,'M');generator.addData(invite);generator.make();
    qr=generator.createSvgTag({cellSize:4,margin:12,scalable:true});
  }
}
function updateSmall() {
  if(!snapshot)return;
  const progress=$('[data-progress]');
  const {done,total}=snapshot.progress;
  if(progress)progress.textContent=`${done} of ${total} ${snapshot.phase==='write'?'answers in':'ballots in'}`;
  const bar=$('[data-progress-bar]');
  if(bar)bar.style.width=(total?100*done/total:0)+'%';
  const status=$('[data-connection]');
  if(status)status.textContent=conn==='reconnecting'?' · Reconnecting…':conn==='closed'?' · Disconnected':'';
  const clock=$('[data-clock]');
  if(clock) {
    const sec=Math.max(0,Math.ceil((snapshot.deadline-Date.now()-timeSkew)/1000));
    clock.textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
    clock.parentElement.classList.toggle('urgent',sec<=10);
  }
}
function releaseEditor(){editor?.destroy();editor=null;}
function show(v, force=false) {
  snapshot=v;
  if(role==='host')sound.update(v);
  const active=v.tasks.find(t=>!t.submitted);
  const key=[role,room,v.phase,v.round,v.matchup?.id,active?.id,v.voted,v.me?.role,v.canVote].join('|');
  if(v.phase==='lobby'||v.phase==='scores'||v.phase==='end')force=true;
  if(selectionKey!==v.matchup?.id){selectionKey=v.matchup?.id;choices=[];}
  if(!force&&renderKey===key){updateSmall();return;}
  renderKey=key;
  releaseEditor();
  main.dataset.phase=v.phase;main.dataset.role=role;
  main.innerHTML=stage(v,role==='host',room,invite,qr,choices);
  if(v.matchup)main.querySelectorAll('[data-answer]').forEach(el=>{
    const a=v.matchup.options[Number(el.dataset.answer)].answer;
    if(a)renderAnswer(el,a);
  });
  if($('#editor')&&active) {
    taskKey='punchline.draft.'+room+'.'+active.id;
    const submit=$('[data-act="submit-answer"]');
    editor=createEditor($('#editor'),{initial:saved(taskKey),onChange:value=>{
      save(taskKey,value);
      submit.disabled=!value||pending;
    }});
    submit.disabled=!editor.getValue()||pending;
  }
  updateSmall();
}
function persistHost() {
  if(!save(tabKey,{role:'host',room,game})&&!sessionWarning){
    sessionWarning=true;notify('Browser storage is full. Keep the host tab open to keep this game.');
  }
}
function transmit(id,full=false) {
  const v=view(game,id);
  if(!v.me)return;
  const key=v.phase==='vote'?v.matchup?.id:null;
  const unchanged=key&&!full&&sentMatch.get(id)===key;
  const packet={kind:'view',value:v,at:Date.now()};
  if(unchanged){packet.matchId=key;delete v.matchup;}
  if(net?.send(id,packet))sentMatch.set(id,key);
}
function broadcast() {
  if(!game||!net)return;
  persistHost();
  show(view(game));
  for(const id of net.peers())transmit(id);
}
function changeStatus(status) {
  conn=status;
  updateSmall();
}
function reset(forget=true) {
  revision++;
  const old=net;net=null;role='';game=null;snapshot=null;room='';renderKey='';taskKey='';
  releaseEditor();old?.close();sound.stop();sentMatch.clear();
  choices=[];selectionKey='';pending=false;timeSkew=0;
  if(forget){save(tabKey,null);urlFor('',null);}
  main.dataset.phase='home';main.innerHTML=landing();closeDialog();
}
function loadScreen(label) {
  main.dataset.phase='connecting';
  main.innerHTML=`<section class="panel solo-panel"><span class="stamp">${icon('screen')}</span><h1>${e(label)}</h1><p class="muted">Connecting to the room service…</p>${button('Back','cancel','ghost')}</section>`;
}
async function startHost(stored=null) {
  if(role)return;
  const attempt=++revision;role='host';game=stored?.game||createGame();
  if(stored)for(const p of game.members)setConnected(game,p.id,false);
  loadScreen(stored?'Restoring room':'Opening the room');
  try {
    if(localSteam&&!stored){
      const pack=await loadSteamQuestions();
      if(attempt!==revision)return;
      useSteamQuestions(game,pack);
    }
    const handle=await hostRoom({code:stored?.room,onStatus:status=>{if(revision===attempt)changeStatus(status);},
      onJoin(id,name) {
        if(revision!==attempt)return;
        try {join(game,id,name);sentMatch.delete(id);broadcast();}
        catch(err){net?.send(id,{kind:'rejected',message:err.message});}
      },
      onLeave(id){if(revision!==attempt)return;sentMatch.delete(id);if(setConnected(game,id,false))broadcast();},
      onMessage(id,packet){
        if(revision!==attempt||!packet||packet.kind!=='action')return;
        try{if(act(game,id,packet.action))broadcast();else transmit(id,true);}
        catch(err){net?.send(id,{kind:'error',message:err.message});transmit(id,true);}
      }
    });
    if(attempt!==revision){handle.close();return;}
    net=handle;setRoom(net.code);urlFor('host',room);broadcast();
  } catch(err){
    if(attempt!==revision)return;
    reset(!stored);
    if(stored){
      openDialog(`<h2 id="modal-title">Restore your room</h2><p>${e(err.message)}</p>${button('Retry room '+stored.room,'restore','primary')}${button('Return to home','cancel','ghost')}`);
    }else notify(err.message);
  }
}
async function connectPlayer(code,name) {
  const attempt=++revision;
  closeDialog();joinName=name;role='player';setRoom(code);loadScreen('Joining '+room);
  let accepted=false;
  try{
    const handle=await joinRoom({code,name,onStatus:status=>{
      if(attempt!==revision)return;
      changeStatus(status);
      if(status==='closed'&&accepted){reset();showJoin(code,'Your connection closed. You can rejoin this room.');}
    },onMessage(packet){
      if(attempt!==revision||!packet)return;
      if(packet.kind==='view'){
        const v=packet.value;
        if(!v||!v.me||!Array.isArray(v.players))return;
        if(packet.matchId){if(snapshot?.matchup?.id!==packet.matchId)return;v.matchup=snapshot.matchup;}
        accepted=true;pending=false;
        timeSkew=Number.isFinite(packet.at)?packet.at-Date.now():0;
        if(taskKey&&!v.tasks.some(t=>!t.submitted&&('punchline.draft.'+room+'.'+t.id)===taskKey))save(taskKey,null);
        save(tabKey,{role:'player',room:code,name});urlFor('room',code);show(v);
      }else if(packet.kind==='rejected'){reset();showJoin(code,String(packet.message));}
      else if(packet.kind==='ended'){reset();notify('The host ended the room.');}
      else if(packet.kind==='error'){pending=false;notify(packet.message);if(snapshot)show(snapshot,true);}
    }});
    if(attempt!==revision){handle.close();return;}
    net=handle;
  }catch(err){
    if(attempt!==revision)return;
    reset();showJoin(code,err.message);
  }
}
function dispatch(action) {
  if(role==='host'){try{if(act(game,null,action))broadcast();}catch(err){notify(err.message);}return;}
  if(!net?.send({kind:'action',action})){notify('Reconnecting to the host. Try again in a moment.');return;}
  pending=true;
  const control=$('[data-act="'+(action.type==='answer'?'submit-answer':'cast')+'"]');
  if(control)control.disabled=true;
}
function soundDialog(note='') {
  openDialog(`<span class="stamp">${icon('speaker')}</span><h2 id="modal-title">Sound booth</h2>
  <p>Music and narration play on the host screen.</p>${button(muted?'Turn host sound on':'Mute host sound','mute','lavender',muted?'muted':'speaker')}
  <hr class="soft-sep"><h3>Host sound pack</h3><p class="modal-status" style="margin-top:8px">${sound.packName?'Using your Quiplash 2 recordings'+(sound.sessionOnly?' for this session.': ' on this browser.'):'Using the house band and browser announcer.'}</p>
  <p class="sound-note">To use your Quiplash 2 recordings, choose the game’s <b>TalkshowExport/project/media</b> folder. The audio stays on your device.</p>
  <input type="file" id="audio-folder" webkitdirectory multiple hidden><button data-act="import" class="small-action">Choose audio folder</button><div class="error" role="status">${e(note)}</div>`);
}
function askLeave() {
  const host=role==='host';
  openDialog(`<h2 id="modal-title">${host?'End this room?':'Leave this room?'}</h2><p>${host?'The game will close for everyone in the room.':'You can return using the same device and room code.'}</p>
  ${button(host?'End room':'Leave room','confirm-leave','primary')}${button('Keep playing','dismiss','ghost')}`);
}
async function copyInvite(){
  try {await navigator.clipboard.writeText(invite);notify('Invite link copied.');}
  catch{openDialog(`<h2 id="modal-title">Invite friends</h2><label for="invite">Room link</label><input class="field" id="invite" readonly value="${e(invite)}">`);$('#invite').select();}
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button');
  if(!target)return;
  if(role==='host'&&!muted)sound.unlock();
  if(target.classList.contains('rules-open')){openDialog(rules());return;}
  if(target.classList.contains('sound-open')){soundDialog();return;}
  if(target.classList.contains('close-modal')){closeDialog();return;}
  const vote=target.dataset.vote;
  if(vote&&snapshot?.canVote){
    if(snapshot.voteLimit===1)choices=[vote];
    else if(choices.length<snapshot.voteLimit)choices.push(vote);
    else {notify('All three votes are assigned. Clear them to choose again.');return;}
    show(snapshot,true);return;
  }
  switch(target.dataset.act){
    case 'host':sound.unlock();startHost();break;
    case 'restore':closeDialog();sound.unlock();startHost(saved(tabKey));break;
    case 'cancel':reset();break;
    case 'start':sound.unlock();dispatch({type:'start'});break;
    case 'next':sound.unlock();dispatch({type:'next'});break;
    case 'restart':dispatch({type:'restart'});break;
    case 'clear':choices=[];show(snapshot,true);break;
    case 'cast':if(!pending)dispatch({type:'vote',choices:[...choices]});break;
    case 'submit-answer':{
      const a=editor?.getValue(),task=snapshot?.tasks.find(t=>!t.submitted);
      if(a&&task&&!pending)dispatch({type:'answer',promptId:task.id,answer:a});
      break;
    }
    case 'copy':copyInvite();break;
    case 'leave':askLeave();break;
    case 'confirm-leave':
      if(role==='host')for(const id of net?.peers()||[])net.send(id,{kind:'ended'});
      reset();break;
    case 'dismiss':closeDialog();break;
    case 'mute':
      muted=!muted;try{localStorage.setItem('punchline.muted',muted?'yes':'no');}catch{}
      sound.unlock();sound.setMuted(muted);glyphs();soundDialog();break;
    case 'import':$('#audio-folder').click();break;
  }
});
document.addEventListener('input',event=>{
  if(event.target.matches('.room-field'))event.target.value=event.target.value.replace(/[^a-z]/gi,'').toUpperCase();
});
document.addEventListener('submit',event=>{
  if(event.target.id==='code-form'){
    event.preventDefault();showJoin(event.target.elements.code.value.trim().toUpperCase());
  }else if(event.target.id==='join-form'){
    event.preventDefault();
    const name=event.target.elements.name.value.trim();
    if(!name){event.target.querySelector('.error').textContent='Enter your player name.';return;}
    connectPlayer(event.target.elements.code.value.trim().toUpperCase(),name);
  }
});
document.addEventListener('change',async event=>{
  if(event.target.id!=='audio-folder')return;
  const f=event.target.files;
  if(!f.length)return;
  try{const n=await sound.importFiles(f);soundDialog(`${n} local audio cues loaded.`);}
  catch(err){soundDialog(err.message);}
});
modal.addEventListener('click',event=>{if(event.target===modal)closeDialog();});
setInterval(()=>{if(role==='host'&&net&&game&&tick(game))broadcast();updateSmall();},250);
async function loadSound() {
  await sound.restore();
  if(!localSteam)return;
  try{
    const files=[];
    for(let i=0;i<steamCueIds.length;i+=8){
      const batch=await Promise.all(steamCueIds.slice(i,i+8).map(async id=>{
        const res=await fetch('./_steam/'+id+'.ogg');
        if(!res.ok)return null;
        return new File([await res.blob()],id+'.ogg',{type:'audio/ogg'});
      }));
      files.push(...batch.filter(Boolean));
    }
    if(files.length)await sound.importFiles(files,{persist:false});
    else notify('Steam audio is unavailable. Using the house band.');
  }catch{notify('Could not load the Steam audio. The house band is ready.');}
}
glyphs();main.innerHTML=landing();main.dataset.phase='home';
loadSound();
const stored=saved(tabKey);
const invited=params.get('room')?.trim().toUpperCase();
if(invited&&/^[A-Z]{4}$/.test(invited)){
  if(stored?.role==='player'&&stored.room===invited)connectPlayer(invited,stored.name);
  else{joinName=(params.get('name')||'').slice(0,20);showJoin(invited);}
}else if(params.has('host')&&stored?.role==='host'&&stored.room===params.get('host')&&stored.game?.members){
  startHost(stored);
}
