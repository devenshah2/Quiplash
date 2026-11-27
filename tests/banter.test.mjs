import test from 'node:test';
import assert from 'node:assert/strict';
import {createBanter} from '../banter.js';

test('host can generate commentary without a model download, and canceled or private turns stay silent',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw new Error('Unexpected network request');});
  const hostView = {phase:'write',round:1,players:[{id:'p1',score:50},{id:'p2',score:0}]};
  const mc = createBanter();
  const line = await mc.line(hostView);
  assert.equal(typeof line?.text,'string');
  assert.ok(line.text.length>8);
  assert.ok(line.source);
  assert.doesNotMatch(line.text,/\{\w+\}/);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await mc.line(hostView,{signal:aborted.signal}),null);
  assert.equal(await mc.line({...hostView,me:{id:'p1'}}),null);
  mc.reset();
  assert.ok((await mc.line({...hostView,phase:'end'})).text);
});

test('announcer distinguishes a split sweep bonus from unanimous and empty ballots', async t => {
  const prompts = [];
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'LanguageModel');
  Object.defineProperty(globalThis, 'LanguageModel', {
    configurable: true,
    value: {
      async availability() { return 'available'; },
      async create() {
        return {
          async prompt(context) { prompts.push(context); return 'The stage crew kept the receipt.'; },
          destroy() {},
        };
      },
    },
  });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, 'LanguageModel', prior);
    else delete globalThis.LanguageModel;
  });

  for (const [votes, hasBonus, expected] of [
    [[5, 1], true, /audience majority/i],
    [[6, 0], true, /won every ballot/i],
    [[0, 0], false, /without a single ballot/i],
  ]) {
    const mc = createBanter();
    await mc.line({
      phase: 'reveal',
      round: 1,
      matchup: { outcome: 'vote', unanimous: hasBonus, options: votes.map(n => ({ votes:n })) },
    });
    assert.match(prompts.at(-1), expected);
  }
});
