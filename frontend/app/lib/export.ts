import type { TreeGraph } from './phylogeny';
import { rootedLayout, unrootedLayout } from './layout';

export type TreeMode = 'rooted' | 'unrooted';
export function getLayout(graph: TreeGraph, mode: TreeMode) {
  return mode === 'rooted' ? rootedLayout(graph) : unrootedLayout(graph);
}
function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
export function toSvg(graph: TreeGraph, mode: TreeMode): string {
  const layout = getLayout(graph, mode);
  const elements: string[] = [
    `<rect width="${layout.width}" height="${layout.height}" fill="#0b1020"/>`
  ];
  for (const edge of graph.edges) {
    const a = layout.coords.get(edge.source), b = layout.coords.get(edge.target);
    if (!a || !b) continue;
    if (mode === 'rooted') {
      const [parent, child] = a.x <= b.x ? [a, b] : [b, a];
      elements.push(`<path d="M ${parent.x} ${parent.y} V ${child.y} H ${child.x}" fill="none" stroke="#a78bfa" stroke-width="2"/>`);
    } else {
      elements.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#a78bfa" stroke-width="2"/>`);
    }
  }
  for (const node of graph.nodes) {
    const point = layout.coords.get(node.id);
    if (!point) continue;
    if (node.label !== undefined) {
      const onLeft = mode === 'unrooted' && point.x < layout.width / 2;
      elements.push(`<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#fde68a"/>`);
      elements.push(`<text x="${point.x + (onLeft ? -11 : 11)}" y="${point.y + 5}" fill="#f8fafc" font-family="Arial,sans-serif" font-size="14" text-anchor="${onLeft ? 'end' : 'start'}">${xmlEscape(node.label)}</text>`);
    } else {
      elements.push(`<circle cx="${point.x}" cy="${point.y}" r="2.5" fill="${node.id === graph.root ? '#fde68a' : '#9b8acb'}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="${layout.viewBox}">${elements.join('')}</svg>\n`;
}

export function downloadText(filename: string, contents: string, mime: string): void {
  if (typeof document === 'undefined') throw new Error('Downloads require a web browser.');
  const blob = new Blob(mime.startsWith('text/csv') ? ['\uFEFF', contents] : [contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
