import test from 'node:test';
import assert from 'node:assert/strict';
import {searchGifSnap} from '../assets/gifs/gifsnap.js';
import {normalizeAnswer} from '../rich.js';

test('GIF search keeps a sendable full animation and identity when preview variants differ', async t => {
  const gif = {
    id:'clip-42', content_id:'same-animation', title:'Nope', source:'studio',
    url:'https://media.example.com/full.webp', preview_url:'https://media.example.com/still.webp',
    animated_preview:{url:'https://media.example.com/small.gif', animated:true, mime_type:'image/gif'}
  };
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.pathname, '/api/v1/gifs/search');
    assert.equal(url.searchParams.get('q'), 'Michael Scott');
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(options.signal, controller.signal);
    return Response.json({
      data:[gif, {...gif,id:'different-encoding'}, {...gif,id:'bad',content_id:'bad',url:'file:///bad'}],
      pagination:{has_next:true,next_page:3}
    });
  });
  const {items,nextPage} = await searchGifSnap('Michael Scott',2,controller.signal);
  assert.equal(nextPage,3);
  assert.equal(items.length,1);
  assert.equal(items[0].src,gif.url);
  assert.equal(items[0].preview,gif.animated_preview.url);
  assert.equal(items[0].id,gif.id);
  const selected = {type:'image', src:items[0].src, alt:items[0].name,
    gifSnap:{id:items[0].id,source:items[0].source}};
  assert.deepEqual(normalizeAnswer({parts:[selected]}),{parts:[selected]});
});
