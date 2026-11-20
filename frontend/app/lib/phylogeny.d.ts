export interface TreeNode { id: string; label?: string; index?: number }
export interface TreeEdge { source: string; target: string; length: number }
export interface TreeGraph { nodes: TreeNode[]; edges: TreeEdge[]; clippedBranches: number; root?: string; diameter?: number }
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number;
export function cosineMatrix(embeddings: ArrayLike<number>[]): number[][];
export function distanceMatrix(similarity: number[][]): number[][];
export function neighborJoining(distances: number[][], names: string[]): TreeGraph;
export function midpointRoot(graph: TreeGraph): TreeGraph;
export function adjacency(graph: TreeGraph): Map<string, Array<{id:string;length:number}>>;
export function toNewick(graph: TreeGraph, options?: {unrooted?: boolean}): string;
export function unrootTree(graph: TreeGraph): TreeGraph;
