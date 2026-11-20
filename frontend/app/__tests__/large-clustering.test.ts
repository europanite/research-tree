import {buildDistances,clusterPacked,packedIndex,MAX_TERMS} from '../public/clustering';
import {previewTree} from '../lib/preview';
import {toNewick} from '../lib/phylogeny';

test('exact packed pair distances and cosine summary',()=>{
  const embeddings=new Float32Array([1,0, 0,1, 1,0, -1,0]);
  const {distances,summary}=buildDistances(embeddings,4,2);
  expect(distances[packedIndex(0,2)]).toBeCloseTo(0);
  expect(distances[packedIndex(0,3)]).toBeCloseTo(2);
  expect(summary.pairCount).toBe(6);
  expect(MAX_TERMS).toBeGreaterThanOrEqual(8192);
});
test('average linkage groups semantic neighbors and supports full Newick with condensed preview',()=>{
  const n=300,d=new Float32Array(n*(n-1)/2);
  for(let j=1;j<n;j++)for(let i=0;i<j;i++)d[packedIndex(i,j)]=Math.abs(i-j)/100+0.01;
  const tree=clusterPacked(d,Array.from({length:n},(_,i)=>`term${i}`));
  expect(tree.nodes).toHaveLength(2*n-1);
  expect(tree.edges).toHaveLength(2*n-2);
  expect(toNewick(tree)).toContain('term299');
  expect(previewTree(tree,64).nodes.filter(n=>n.label!==undefined).length).toBeLessThanOrEqual(64);
});
