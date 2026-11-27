import { punchlineRequest } from './assets/announcer/punchlines.js';
import { newShow, pocketLine } from './assets/announcer/pocket.js';
import { studioModelState, studioLine, warmLocalStudio } from './assets/announcer/studio.js';
export { studioModelState, enableStudioModel, disableStudioModel } from './assets/announcer/studio.js';

const directions = {
  lobby: 'Introductions at a low-budget comedy game show.',
  write: 'The players are writing jokes on their phones.',
  final: 'Everyone is writing a joke about the same final prompt.',
  vote: 'The audience is choosing its favorite joke.',
  reveal: 'The votes are in. The anonymous writers have just been revealed.',
  scores: 'The scores have appeared on the board.',
  sweep: 'One joke won every ballot and earned the sweep bonus.',
  bonus: 'A joke earned the sweep bonus by taking every player vote and the audience majority.',
  noballots: 'The matchup closed without a single ballot.',
  jinx: 'Two writers submitted identical jokes by coincidence.',
  tie: 'The vote has ended in a tie.',
  picture: 'An answer with an embedded picture or GIF just won this matchup.',
  close: 'The winning answer just won by a single vote.',
  landslide: 'The top answer won by a wide margin.',
  walkover: 'Only one answer arrived for this matchup.',
  lead: 'The lead has changed hands since the last scoreboard.',
  empty: 'Time expired and nobody submitted an answer.',
  end: 'The party game has finished. Give a curtain-call line.',
};

function sceneFor(v,show) {
  if (v.phase === 'write' && v.round === 3) return 'final';
  if (v.phase === 'reveal') {
    const m=v.matchup;
    if (['jinx','empty','walkover'].includes(m?.outcome)) return m.outcome;
    const votes=m?.options?.filter(option=>!option.missing).map(option=>option.votes) || [];
    const high=Math.max(0,...votes);
    if (m?.unanimous) return votes.filter(n=>n>0).length===1 ? 'sweep' : 'bonus';
    if (m?.outcome === 'vote' && !high) return 'noballots';
    if (high && votes.filter(n=>n===high).length > 1) return 'tie';
    const top = m?.options?.find(o=>o.votes===high);
    if (high && top?.answer?.parts?.some(part=>part.type==='image')) return 'picture';
    const sorted = votes.sort((a,b)=>b-a);
    if (high && sorted.length > 1 && high-sorted[1]===1) return 'close';
    if (high >= 3 && sorted.length > 1 && high>=3*sorted[1]) return 'landslide';
  }
  if (v.phase === 'scores') {
    const scores = [...(v.players || [])].sort((a,b)=>b.score-a.score);
    const tied = scores.length > 1 && scores[0].score===scores[1].score;
    const lead = tied ? null : scores[0]?.id;
    const changed = lead && show.leader && lead !== show.leader;
    show.leader = lead;
    if (changed) return 'lead';
  }
  return Object.hasOwn(directions,v.phase) ? v.phase : null;
}

function cleanLine(raw, history) {
  if (typeof raw !== 'string') return '';
  const first = raw.trim().split(/\n/)[0].trim();
  let line = first.replace(/^(?:host|announcer|mc)\s*:\s*/i,'');
  if (/^["“][^"“”]+["”]$/.test(line)) line=line.slice(1,-1).trim();
  if (/["“”<>\[\]{}#*]|\(.*\)|https?:|\b(?:as an ai|my (?:new )?(?:joke|quip)|joke goes|here(?:'s| is) (?:a|my)|previous line|sample joke|system prompt|stage direction|said (?:the|our|my)|nod(?:ding|ded)|scribbl(?:ed|ing)|said (?:he|she)|punchline:|sure thing|certainly|hate speech)\b/i.test(line)) return '';
  if (/^(?:Well done|That sounds great|Aw,? shucks|Okay|Sure|Absolutely|Of course|Thank you)[.!]$/i.test(line)) return '';
  if (line.length < 15 || line.length > 150 || !/[.!?]$/.test(line) || line.split(/\s+/).length > 27) return '';
  if (history.some(old=>old.toLowerCase()===line.toLowerCase())) return '';
  return line;
}

function messagesFor(scene,v,show,draft) {
  const prior = show.history.at(-1);
  const last = prior ? ' Previous host line: “'+prior+'”' : '';
  return [
    { role:'system', content:'You are the quick-witted host of a friendly late-night party game. Reply with only a short, original spoken quip. Joke about the backstage crew and props. Keep it under 20 words. No insults or stage directions.' },
    { role:'user', content: directions[scene]+' The backstage prop is a '+show.prop+' and the crew member is our '+show.official+'.'+last+' Invent a funny new line. A sketch idea: '+draft },
  ];
}

const languageOptions = {expectedInputs:[{type:'text',languages:['en']}],expectedOutputs:[{type:'text',languages:['en']}]};

export function createBanter({ localLauncher = false } = {}) {
  let show = newShow(), version=0;
  let nativeAvailable;
  async function nativeLine(messages, parentSignal) {
    const api=globalThis.LanguageModel;
    if (!api || nativeAvailable === false || parentSignal?.aborted) return '';
    const controller=new AbortController();
    const cancel=()=>controller.abort();
    parentSignal?.addEventListener('abort',cancel,{once:true});
    const timeout=setTimeout(cancel,4000);
    let session;
    const stopped=new Promise(resolve=>controller.signal.addEventListener('abort',()=>resolve(''),{once:true}));
    const generate=async()=>{
      try {
        if (nativeAvailable === undefined) {
          // Only use an already installed native model. Downloads belong to the
          // explicit host control, where their size is visible.
          nativeAvailable=await api.availability(languageOptions) === 'available';
        }
        if (!nativeAvailable || controller.signal.aborted) return '';
        session=await api.create({...languageOptions,signal:controller.signal});
        if (controller.signal.aborted) return '';
        return await session.prompt(messages.map(x=>x.content).join('\n'),{signal:controller.signal});
      } catch { return ''; }
      finally { session?.destroy(); }
    };
    try { return await Promise.race([generate(),stopped]); }
    finally { clearTimeout(timeout); parentSignal?.removeEventListener('abort',cancel); }
  }
  return {
    reset() {
      version++;
      show=newShow();
      nativeAvailable=undefined;
    },
    async line(view, {signal} = {}) {
      const scene=sceneFor(view,show);
      if (!scene || signal?.aborted || view.me) return null;
      if (localLauncher) warmLocalStudio();
      const generation=version, currentShow=show;
      const draft=pocketLine(scene,view,currentShow);
      const messages=messagesFor(scene,view,currentShow,draft);
      let source='Punchline word model', text='';
      if (['ready','saved'].includes(studioModelState())) {
        const request=punchlineRequest(scene,currentShow);
        const fragment=(await studioLine(request.messages,signal,request.form)).trim();
        if (fragment && !currentShow.history.some(old=>old.includes(fragment))) {
          text=request.render(fragment);
          source='SmolLM2 · on device';
          if (generation===version && !signal?.aborted) {
            currentShow.lastForm=request.type;
            currentShow.bit={type:request.type,fragment};
            if (request.type==='job') currentShow.job=fragment;
          }
        }
      }
      if (!text && !signal?.aborted && globalThis.LanguageModel) {
        text=cleanLine(await nativeLine(messages,signal),currentShow.history);
        if (text) source='Browser language model';
      }
      if (signal?.aborted || generation !== version) return null;
      if (!text) { text=draft; currentShow.bit=null; }
      if (!text) return null;
      currentShow.history.push(text);
      currentShow.history=currentShow.history.slice(-6);
      return {text,source};
    },
  };
}
