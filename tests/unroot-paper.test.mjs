import assert from 'node:assert/strict';
import test from 'node:test';
import {unrootTree, toNewick, adjacency} from '../frontend/app/lib/phylogeny.js';
import {unrootedLayout} from '../frontend/app/lib/layout.js';

const rooted={
  root:'r',clippedBranches:0,
  nodes:[{id:'r'},{id:'a'},{id:'b'},{id:'c',label:'Paper C',index:2},{id:'x',label:'Paper A',index:0},{id:'y',label:'Paper B',index:1}],
  edges:[{source:'r',target:'a',length:1},{source:'r',target:'b',length:2},
         {source:'a',target:'c',length:2},{source:'a',target:'x',length:1},
         {source:'b',target:'y',length:1}],
};

test('removes artificial degree-two clustering root without changing path distances',()=>{
  const unrooted=unrootTree(rooted);
  assert.equal(unrooted.root,undefined);
  assert.equal(unrooted.nodes.length,5);
  assert.equal(unrooted.edges.length,4);
  assert.equal(unrooted.edges.find(e=>new Set([e.source,e.target]).has('a') && new Set([e.source,e.target]).has('b')).length,3);
  const nw=toNewick(unrooted,{unrooted:true});
  assert.ok(nw.startsWith('[&U]'));
  assert.ok(nw.includes('Paper A') && nw.includes('Paper B') && nw.includes('Paper C'));
  const lay=unrootedLayout(unrooted);
  assert.equal(lay.coords.size,5);
  assert.ok(lay.width>=760);
  assert.deepEqual(rooted.edges.length,5); // source object remains unchanged
});

test('2-paper clustering converts to a single unrooted edge',()=>{
  const g={root:'root',nodes:[{id:'root'},{id:'l',label:'One'},{id:'r',label:'Two'}],
   edges:[{source:'root',target:'l',length:0.5},{source:'root',target:'r',length:1.2}],clippedBranches:0};
  const u=unrootTree(g);
  assert.equal(u.edges.length,1);
  assert.ok(Math.abs(u.edges[0].length-1.7)<1e-9);
  assert.ok(toNewick(u,{unrooted:true}).includes('[&U]'));
});
