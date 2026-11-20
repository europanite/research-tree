import type { TreeGraph } from './phylogeny';
export interface Point { x: number; y: number; distance?: number }
export interface TreeLayout { coords: Map<string, Point>; viewBox: string; width: number; height: number }
export function rootedLayout(graph: TreeGraph): TreeLayout;
export function unrootedLayout(graph: TreeGraph): TreeLayout;
