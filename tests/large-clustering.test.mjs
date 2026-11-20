import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistances, clusterPacked,packedIndex, MAX_TERMS, NJ_LIMIT } from '../frontend/app/public/clustering.js';
import { previewTree } from '../frontend/app/lib/preview.js';

function makeDense(d){const n=d.length, packed=new Float32Array(n*(n-1)/2);for(let j=1;j<n;j++)for(let i=0;i<j;i++)packed[packedIndex(i,j)]=d[i][j];return packed;}
function naive(d,kind){
  let clusters=d.map((_,i)=>({members:[i],name:String(i)}));const out=[];
  while(clusters.length>1){
    let best=Infinity,pair=null;
    for(let i=0;i<clusters.length;i++)for(let j=i+1;j<clusters.length;j++){
      const sums=clusters[i].members.flatMap(a=>clusters[j].members.map(b=>d[a][b]));
      const score=kind==='average'?sums.reduce((a,b)=>a+b,0)/sums.length:Math.max(...sums);
      if(score<best){best=score;pair=[i,j];}
    }
    const [i,j]=pair,a=clusters[i],b=clusters[j];
    out.push({set:[...a.members,...b.members].sort((a,b)=>a-b).join(','),height:best/2});
    clusters=clusters.filter((_,k)=>k!==i&&k!==j).concat([{members:[...a.members,...b.members]}]);
  }
  return out;
}
function clustersFromTree(g){
 const children=new Map(g.nodes.map(n=>[n.id,[]]));for(const e of g.edges) children.get(e.source).push(e);
 const byId=new Map(g.nodes.map(n=>[n.id,n]));const result=[];
 function traverse(id,h=0){let kids=children.get(id);if(!kids.length)return [byId.get(id).index];let members=[];for(const c of kids)members.push(...traverse(c.target,h+c.length));result.push(members.sort((a,b)=>a-b).join(','));return members;}
 traverse(g.root);return result;
}
function makeRng(seed){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

test('compact packed storage and exact cosine summaries',()=>{
  const n=4, vec=new Float32Array([1,0, 0,1, 1,0, -1,0]);
  const {distances,summary}=buildDistances(vec,n,2);
  assert.equal(distances.length,6);assert.equal(distances[packedIndex(0,2)],0);assert.equal(distances[packedIndex(0,3)],2);
  assert.equal(summary.pairCount,6);assert.ok(summary.topPairs[0].score===1);
});
test('average/complete agree with naive cluster merges on random data with unambiguous distances',()=>{
  const rng=makeRng(13);
  for(let n=3;n<=13;n++)for(let trial=0;trial<12;trial++){
    const d=Array.from({length:n},()=>Array(n).fill(0));
    for(let j=1;j<n;j++)for(let i=0;i<j;i++)d[i][j]=d[j][i]=0.01+Math.round(rng()*100000)/100000;
    for(const method of ['average','complete']){
      const actual=clusterPacked(makeDense(d),Array.from({length:n},(_,i)=>`w${i}`),method);
      const expected=naive(d,method).map(x=>x.set);
      assert.deepEqual(clustersFromTree(actual).sort(),expected.sort(),`${method} n=${n} trial=${trial}`);
      assert.equal(actual.edges.length,2*(n-1));
    }
  }
});
test('preview retains full tree separately and condenses large trees',()=>{
 const n=600;
 const d=new Float32Array(n*(n-1)/2);
 for(let j=1;j<n;j++)for(let i=0;i<j;i++)d[packedIndex(i,j)]=Math.abs(j-i)+1e-4;
 const full=clusterPacked(d,Array.from({length:n},(_,i)=>`w${i}`),'average');
 const preview=previewTree(full,64);
 assert.equal(full.nodes.length,2*n-1);
 assert.ok(preview.nodes.filter(n=>n.label!==undefined).length<=64);
 assert.ok(preview.nodes.length<full.nodes.length);
 assert.ok(preview.edges.length===preview.nodes.length-1);
});
test('maximum supports at least 8192 words',()=>{
 assert.ok(MAX_TERMS>=8192);assert.ok(NJ_LIMIT<MAX_TERMS);
});

test('two-term average tree supports unrooted Newick serialization',async()=>{
 const {toNewick}=await import('../frontend/app/lib/phylogeny.js');
 const g=clusterPacked(makeDense([[0,.5],[.5,0]]),['A','B'],'average');
 assert.match(toNewick(g,{unrooted:true}),/^\[&U\]/);
 assert.ok(toNewick(g,{unrooted:true}).includes('A'));
 assert.ok(toNewick(g,{unrooted:true}).includes('B'));
});
