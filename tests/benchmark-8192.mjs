import {performance} from 'node:perf_hooks';
import {buildDistances,clusterPacked} from '../frontend/app/public/clustering.js';
import {previewTree} from '../frontend/app/lib/preview.js';
import {toNewick} from '../frontend/app/lib/phylogeny.js';
const n=8192,dim=2, vectors=new Float32Array(n*dim);
for(let i=0;i<n;i++){const a=i*0.027322+Math.sin(i*0.124)*0.0001;vectors[2*i]=Math.cos(a);vectors[2*i+1]=Math.sin(a);}
const start=performance.now();
const {distances,summary}=buildDistances(vectors,n,dim);
const matrixTime=performance.now();
const graph=clusterPacked(distances,Array.from({length:n},(_,i)=>`term-${i}`),'average');
const clusterTime=performance.now();
const small=previewTree(graph,128);
const newick=toNewick(graph);
const end=performance.now();
console.log(JSON.stringify({n,pairs:summary.pairCount,packedMiB:distances.byteLength/1024/1024,nodes:graph.nodes.length,edges:graph.edges.length,previewNodes:small.nodes.length,newickLength:newick.length,matrixMs:Math.round(matrixTime-start),clusterMs:Math.round(clusterTime-matrixTime),totalMs:Math.round(end-start)},null,2));
