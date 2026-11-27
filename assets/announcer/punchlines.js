// Structured decoding gives the 135M model the copy desk's vocabulary and
// lets it compose the punchline token by token from the model’s probabilities.
const pools = {
  role: ['Deputy', 'Director', 'Inspector', 'Minister', 'Commissioner', 'Supervisor', 'Head', 'Chancellor', 'Duke', 'Guardian', 'Custodian', 'Ambassador'],
  kind: ['Emergency', 'Unlicensed', 'Decorative', 'Recreational', 'Ceremonial', 'Unpaid', 'Backup', 'Unauthorized', 'Competitive', 'Suspicious', 'Luxury', 'Invisible', 'Strategic', 'Discount', 'Artisanal', 'Accidental', 'Temporary', 'After-Hours'],
  work: ['Applause', 'Confetti', 'Paperwork', 'Snacking', 'Mumbling', 'Jazz Hands', 'Breaks', 'Winks', 'Receipts', 'Fanfare', 'Shrugging', 'Bows', 'Small Talk', 'Loitering', 'Eye Contact', 'Naps', 'Karaoke', 'Pizza Logistics', 'Group Chats', 'Aux Cords'],
  adj: ['emotional', 'promotional', 'decorative', 'emergency', 'unauthorized', 'recreational', 'ceremonial', 'motivational', 'professional', 'excessive', 'unscheduled', 'artisanal', 'premium', 'competitive', 'suspicious', 'unlicensed'],
  fee: ['standing ovations', 'desk naps', 'jazz hands', 'awkward silences', 'finger guns', 'slow claps', 'eyebrow raises', 'dramatic pauses', 'air quotes', 'pep talks', 'rehearsed gasps', 'snack consultations', 'interpretive shrugs', 'microphone checks', 'karaoke encores', 'pizza consultations', 'group-chat apologies'],
  prize: ['a commemorative', 'a mildly haunted', 'a monogrammed', 'a travel-size', 'a secondhand', 'a velvet-lined', 'a hand-painted', 'a gold-plated', 'a signed', 'a limited-edition', 'a tax-deductible', 'a reversible'],
  item: ['staple remover', 'salad spinner', 'parking cone', 'gravy boat', 'sock puppet', 'receipt holder', 'soup ladle', 'butter bell', 'pencil sharpener', 'thumb warmer', 'sandwich press', 'lint roller', 'bath duck', 'tape dispenser', 'coaster', 'spatula'],
  catch: ['batteries sold separately', 'assembly takes a weekend', 'please return it by Tuesday', 'the box is on loan', 'the warranty expired yesterday', 'the certificate costs extra', 'we need to keep the ribbon', 'dry-clean only'],
  order: ['Please register', 'Rehearse', 'Itemize', 'Please autograph', 'Individually wrap', 'Please alphabetize', 'Please insure', 'Please initial', 'Kindly laminate', 'Please notarize', 'Remember to refrigerate', 'Please invoice'],
  what: ['the applause', 'the confetti', 'each microphone', 'all the snacks', 'the spotlights', 'every receipt', 'the cue cards', 'the stage curtains', 'the balloons', 'the spare batteries', 'the souvenir mugs', 'the exit signs', 'the leftover pizza', 'the karaoke mics', 'the aux cords'],
  when: ['before lunch', 'in triplicate', 'by closing time', 'between commercial breaks', 'using your stage name', 'in alphabetical order', 'before the next full moon', 'in tiny handwriting', 'within the snack budget', 'before anyone notices'],
  title1: ['Licensed to', 'Born to', 'Too Polite to', 'Contractually Obliged to', 'Learning to', 'Not Paid to', 'I Used to', 'Afraid to', 'Finally Allowed to'],
  title2: ['Sparkle', 'Blink', 'Take a Bow', 'Smell the Confetti', 'Hold the Clipboard', 'Touch the Thermostat', 'Read the Fine Print', 'Clap on Cue', 'Expense the Nachos', 'Sign the Receipt', 'Split the Check', 'Work the Fog Machine', 'Trust the Tape', 'Keep a Straight Face'],
  title3: ['Confessions of', 'An Interview With', 'My Life as', 'On the Road With', 'In Defense of', 'A Word From', 'The Last Days of'],
  title4: ['a Folding Chair', 'the Spare Extension Cord', 'a Borrowed Tuxedo', 'the Last Nacho', 'the Office Kazoo', 'a Full-Time Elbow', 'the Break-Room Fridge', 'a Misplaced Receipt', 'the Snack Budget', 'the Emergency Crouton', 'the Other Microphone', 'a Missing Aux Cord', 'the Last Pizza Slice', 'the Dorm Fridge'],
};
// Each slot contains possible continuations, never complete alternate lines.
// The decoder samples actual model probabilities at every subword fork.
const forms = {
  job: [[pools.role, ' of ', pools.kind, ' ', pools.work]],
  invoice: [[pools.adj, ' ', pools.fee]],
  prize: [[pools.prize, ' ', pools.item, ', ', pools.catch]],
  memo: [[pools.order, ' ', pools.what, ' ', pools.when]],
  title: [[pools.title1, ' ', pools.title2], [pools.title3, ' ', pools.title4]],
};

const leads = {
  lobby: ["We're on the air.", 'Welcome to the studio.', 'The light is on. We must be live.'],
  write: ['While you write, a staffing update.', 'You write. I’ll handle backstage.', 'Keep writing. The office called.'],
  final: ['One last prompt.', 'Everyone gets the same prompt.', 'The final prompt is out.'],
  vote: ['Ballots are open.', 'The vote is open.', 'Time to pick a favorite.'],
  reveal: ['The votes are in.', 'Those are the votes.', 'The ballots are counted.'],
  picture: ['The picture took it!', 'A win for the picture.', 'That picture won the room.'],
  close: ['One vote in it!', 'A one-vote win.', 'A single ballot settled it.'],
  landslide: ['A runaway vote.', 'That was a decisive win.', 'A comfortable margin.'],
  sweep: ['A sweep bonus!', 'A clean sweep!', 'That earned the sweep bonus.'],
  bonus: ['That earned the sweep bonus.', 'A sweep bonus!', 'A bonus for the sweep.'],
  noballots: ['No ballots came in.', 'An empty ballot box.', 'Nobody cast a vote.'],
  tie: ["It's a tie!", 'Even votes!', 'That vote ended level.'],
  jinx: ['Two writers, the same joke.', 'Matching answers!', 'The jokes are identical.'],
  empty: ['No answers this time.', 'An empty stage.', 'That one came back blank.'],
  walkover: ['Just one answer made it.', 'A solo performance!', 'One answer got the stage.'],
  scores: ['Scores are up.', 'There’s the scoreboard.', 'The standings are in.'],
  lead: ['We have a new leader!', 'The lead changed hands.', 'A new name in first place.'],
  end: ['That’s our show!', 'Good night, folks!', 'Time to roll the credits.'],
};
const subjects = {
  job: ['Invent an absurd job title', 'Director of Emergency Velvet'],
  invoice: ['Invent an absurd fee on a tiny production invoice', 'extracurricular finger-pointing'],
  prize: ['Invent a very cheap game show prize and its disappointing fine print', 'a sequined rubber stamp, glitter costs extra'],
  memo: ['Write a ridiculous but perfectly serious backstage instruction', 'Kindly collect the echo before supper'],
  title: ['Title a deadpan television spinoff or memoir about our stage crew', 'Learning to Fold a Standing Ovation'],
};
const choose = arr => arr[Math.floor(Math.random()*arr.length)];

export function punchlineRequest(scene,show) {
  const menus = {lobby:['job','title'],write:['job','memo','invoice'],final:['memo','invoice','title'],scores:['prize','invoice','memo'],lead:['prize','memo'],end:['title','prize']};
  const menu = (menus[scene] || ['prize','memo','invoice']).filter(type=>type!==show.lastForm && !(type==='job' && show.job));
  const type = choose(menu.length ? menu : ['memo','invoice']);
  const lead = choose(leads[scene]);
  const subject = subjects[type];
  const role = show.job && show.lastForm!=='job' && Math.random()<0.55 ? 'our '+show.job : 'our '+show.official;
  const prop = 'the '+show.prop;
  const templates = {
    job: ['We promoted '+prop+' to ', 'We gave '+prop+' an office. New title? '],
    invoice: [role+' billed us for ', 'I found a charge from '+role+' for '],
    prize: ['Tonight’s prize is ', 'I saved up for '+(scene==='end'?'the wrap gift':'the prize')+': '],
    memo: [role+' left a note: ', 'Fresh from '+role+': '],
    title: [prop+' got a book deal: ', 'I pitched a show about '+prop+'. It’s called '],
  };
  let setup = choose(templates[type]);
  // Follow up the actual previous backstage incident, keeping longer titles
  // out of the spoken lead-in when the original line already introduced them.
  if (type==='memo' && show.bit?.type==='invoice') setup='Accounting disputed the '+show.bit.fragment+'. Their note said, ';
  if (type==='memo' && show.bit?.type==='job') setup='Our new '+show.job+' sent a memo. It says, ';
  if (type==='memo' && show.bit?.type==='title') setup='Our publisher sent edits. The first one says, ';
  if (type==='invoice' && show.bit?.type==='prize') setup='Shipping that prize apparently includes a fee for ';
  if (type==='invoice' && show.bit?.type==='memo') setup='We followed that memo. Now we’re being billed for ';
  if (type==='title' && show.bit?.type==='memo') setup='That memo got a sequel. It’s called ';
  if (type==='prize' && show.bit?.type==='invoice') setup='After paying that invoice, the prize budget covered ';

  const messages = [
    {role:'system',content:'You write short backstage jokes for a comedy game show. Supply only the missing punchline phrase. Make deadpan word choices and refer back to the backstage story.'},
    {role:'user',content:subject[0]+'. An example from another show: '+subject[1]+'. Our prop is '+prop+' and the crew member is '+role+'. Last broadcast: '+(show.history.at(-1) || 'opening night')+'. Complete this new broadcast: '+lead+' '+setup+'___'},
  ];
  return {type, messages, form:choose(forms[type]), render(fragment) {
    const start=setup[0].toUpperCase()+setup.slice(1);
    return lead+' '+start+fragment+'.';
  }};
}
