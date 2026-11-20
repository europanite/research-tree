import type { TreeGraph } from '../lib/phylogeny';
export const MAX_TERMS:number;
export const NJ_LIMIT:number;
export const MATRIX_PREVIEW:number;
export function packedIndex(a:number,b:number):number;
export function buildDistances(vectors:Float32Array,n:number,dimensions:number,progress?:(done:number,total:number)=>void):{
  distances:Float32Array;
  summary:{pairCount:number;meanCosine:number;topPairs:Array<{i:number;j:number;score:number}>;matrixPreview:number[][]}
};
export function clusterPacked(distances:Float32Array,names:string[],linkage?:'average'|'complete',progress?:(done:number,total:number)=>void):TreeGraph;
