import test from 'node:test';
import assert from 'node:assert/strict';
import {cosine,cosineMatrix,distanceMatrix,neighborJoining,midpointRoot,adjacency,toNewick} from '../frontend/app/lib/phylogeny.js';
import {rootedLayout,unrootedLayout} from '../frontend/app/lib/layout.js';

const close=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('cosine is normalized, symmetric, bounded, and 1-sim is distance',()=>{
  close(cosine([1,0],[0,1]),0);
  close(cosine([1,0],[-1,0]),-1);
  close(cosine([3,4],[3,4]),1);
  const m=cosineMatrix([[1,0],[0,1],[-1,0]]);
  assert.deepEqual(m,[[1,0,-1],[0,1,0],[-1,0,1]]);
  assert.deepEqual(distanceMatrix(m),[[0,1,2],[1,0,1],[2,1,0]]);
  assert.throws(()=>cosine([0,0],[1,2]),/Zero/);
});

test('neighbor joining preserves a simple additive four-leaf tree',()=>{
  const names=['A','B','C','D'];
  const d=[[0,2,6,6],[2,0,6,6],[6,6,0,2],[6,6,2,0]];
  const tree=neighborJoining(d,names);
  assert.equal(tree.nodes.length,6);
  assert.equal(tree.edges.length,5);
  const adj=adjacency(tree);
  const a=adj.get('leaf-0')[0].id,b=adj.get('leaf-1')[0].id;
  assert.equal(a,b);
  const c=adj.get('leaf-2')[0].id,dd=adj.get('leaf-3')[0].id;
  assert.equal(c,dd);
  assert.notEqual(a,c);
  close(adj.get('leaf-0')[0].length,1);
  close(adj.get('leaf-2')[0].length,1);
  assert.equal(tree.clippedBranches,0);
});

test('midpoint rooting splits diameter in two equal halves',()=>{
  const tree=neighborJoining([[0,2,6,6],[2,0,6,6],[6,6,0,2],[6,6,2,0]],['A','B','C','D']);
  const rooted=midpointRoot(tree);
  assert.equal(rooted.root,'root');
  assert.equal(rooted.edges.length,tree.edges.length+1);
  const adj=adjacency(rooted);
  const rootEdges=adj.get('root');
  assert.equal(rootEdges.length,2);
  const distances=rootedLayout(rooted);
  assert.equal(distances.coords.size,rooted.nodes.length);
  close(rootEdges[0].length+rootEdges[1].length,4);
  assert.ok(rooted.diameter>0);
});

test('works with two words and identical distances',()=>{
  const pair=neighborJoining([[0,0],[0,0]],['equal A','equal B']);
  assert.equal(pair.edges.length,1);
  assert.match(toNewick(pair,{unrooted:true}), /\[&U\]\(.*:0,.*:0\);/);
  const r=midpointRoot(pair);
  assert.equal(r.edges.length,2);
  assert.ok(rootedLayout(r).width>0);
  assert.ok(unrootedLayout(pair).height>0);
});

test('Newick exports quote special words and mark unrooted or rooted',()=>{
  const tree=neighborJoining([[0,0.5,1],[0.5,0,1],[1,1,0]],['rock, paper','O\'Brien','tree']);
  assert.match(toNewick(tree,{unrooted:true}),/^\[&U\]/);
  const text=toNewick(midpointRoot(tree));
  assert.match(text,/^\[&R\]/);
  assert.match(text,/'rock, paper'/);
  assert.match(text,/'O''Brien'/);
  assert.match(text,/;\n$/);
});

test('rejects malformed distance matrices',()=>{
  assert.throws(()=>neighborJoining([[0,2],[1,0]],['a','b']),/symmetric/);
  assert.throws(()=>neighborJoining([[0]],['a']),/dimensions/);
});
