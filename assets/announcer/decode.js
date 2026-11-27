// Wllama 2.3.7's public samplingAccept() does not advance llama.cpp's GBNF
// state. Decode a small token trie against the model's next-token probabilities
// instead. This still runs the transformer on its context and every new token.
const trees = new WeakMap();
const recentlyUsed = new WeakMap();

async function readTree(model, choices, prefix) {
  let variants = trees.get(choices);
  if (!variants) { variants = new Map(); trees.set(choices, variants); }
  if (variants.has(prefix)) return variants.get(prefix);
  const root = { children:new Map(), labels:[] };
  for (const choice of choices) {
    const tokens=await model.tokenize(prefix+choice, false);
    let node=root;
    for (const token of tokens) {
      if (!node.children.has(token)) node.children.set(token,{children:new Map(), labels:[]});
      node=node.children.get(token);
      node.labels.push(choice);
    }
    node.value=choice;
  }
  variants.set(prefix,root);
  return root;
}

async function chooseToken(model, choices) {
  if (choices.size===1) return choices.keys().next().value;
  const logits=await model.getLogits(-1);
  // Temper the neural probabilities slightly for variety within the grammar.
  const candidates=logits.filter(row=>choices.has(row.token)).map(row=>({token:row.token, mass:row.p**0.7}));
  let draw=Math.random()*candidates.reduce((total,row)=>total+row.mass,0);
  for (const {token,mass} of candidates) if ((draw-=mass)<=0) return token;
  throw new Error('No allowed token was available.');
}

export async function generateFragment(model,messages,form,signal) {
  const formatted=await model.formatChat(messages,true);
  await model.kvClear();
  await model.decode(await model.tokenize(formatted,true),{abortSignal:signal});
  let result='',prefix='';
  const selected=[];
  for (const slot of form) {
    if (typeof slot==='string') { prefix=slot; continue; }
    let node=await readTree(model,slot,prefix);
    while (node.value===undefined) {
      if (signal.aborted) return '';
      const recent=recentlyUsed.get(slot) || [];
      const options=new Map([...node.children].filter(([,child])=>child.labels.some(label=>!recent.includes(label))));
      const token=await chooseToken(model,options);
      const sequence=[token];
      node=node.children.get(token);
      // Decode forced continuations together, until the next point at which
      // the model has a choice. All options in these vocabularies are disjoint.
      while (node.value===undefined && node.children.size===1) {
        const next=node.children.keys().next().value;
        sequence.push(next);
        node=node.children.get(next);
      }
      await model.decode(sequence,{abortSignal:signal});
    }
    selected.push([slot,node.value]);
    result+=prefix+node.value;
    prefix='';
  }
  if (signal.aborted) return '';
  for (const [slot,value] of selected) recentlyUsed.set(slot,[...(recentlyUsed.get(slot)||[]), value].slice(-4));
  return result;
}
