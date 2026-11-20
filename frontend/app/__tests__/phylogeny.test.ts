import {cosine,cosineMatrix,distanceMatrix,neighborJoining,midpointRoot,adjacency,toNewick} from '../lib/phylogeny';
import {getLayout,toSvg} from '../lib/export';
test('cosine and distances',()=>{
  expect(cosine([1,0],[0,1])).toBeCloseTo(0);
  expect(cosine([1,0],[-1,0])).toBeCloseTo(-1);
  expect(()=>cosine([0,0],[1,0])).toThrow();
  expect(distanceMatrix(cosineMatrix([[1,0],[0,1]]))).toEqual([[0,1],[1,0]]);
});
test('Neighbor Joining finds two well-separated clades',()=>{
  const d=[[0,2,6,6],[2,0,6,6],[6,6,0,2],[6,6,2,0]];
  const t=neighborJoining(d,['A','B','C','D']);
  expect(adjacency(t).get('leaf-0')?.[0].id).toEqual(adjacency(t).get('leaf-1')?.[0].id);
  expect(adjacency(t).get('leaf-2')?.[0].id).toEqual(adjacency(t).get('leaf-3')?.[0].id);
  expect(t.clippedBranches).toBe(0);
  expect(t.edges).toHaveLength(5);
});
test('midpoint root and Newick with escaped labels',()=>{
  const t=neighborJoining([[0,2,4],[2,0,4],[4,4,0]],["A,B","O'Brien",'C']);
  const r=midpointRoot(t);
  expect(r.root).toBe('root');expect(r.edges).toHaveLength(t.edges.length+1);
  expect(toNewick(t,{unrooted:true})).toMatch(/^\[&U\]/);
  expect(toNewick(r)).toContain("'O''Brien'");
});
test('SVG escapes labels and supports rooted/unrooted layouts',()=>{
  const t=neighborJoining([[0,.3],[.3,0]],['<test>','other']);
  expect(toSvg(t,'unrooted')).toContain('&lt;test&gt;');
  expect(toSvg(midpointRoot(t),'rooted')).toContain('<path');
  expect(getLayout(t,'unrooted').width).toBeGreaterThan(0);
});
test('distance matrix validation',()=>{
  expect(()=>neighborJoining([[0,2],[1,0]],['A','B'])).toThrow();
});
