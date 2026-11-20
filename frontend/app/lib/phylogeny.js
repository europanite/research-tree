const EPS = 1e-10;

export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) throw new Error('Embedding dimensions do not match');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw new Error('Invalid embedding value');
    dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];
  }
  if (aa <= 0 || bb <= 0) throw new Error('Zero-length embedding');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

export function cosineMatrix(embeddings) {
  const n = embeddings.length;
  if (n < 2) throw new Error('At least 2 embeddings are required');
  const m = Array.from({length:n}, () => Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) m[i][j] = m[j][i] = cosine(embeddings[i], embeddings[j]);
  }
  return m;
}

export function distanceMatrix(similarity) {
  return similarity.map((row, i) => row.map((s, j) => i === j ? 0 : Math.max(0, Math.min(2, 1 - s))));
}

function validateDistances(distances, names) {
  const n = names.length;
  if (n < 2 || distances.length !== n) throw new Error('Distance matrix dimensions do not match');
  for (let i=0; i<n; i++) {
    if (distances[i].length !== n || Math.abs(distances[i][i]) > 1e-7) throw new Error('Invalid distance matrix diagonal');
    for (let j=0; j<n; j++) {
      const a = distances[i][j];
      if (!Number.isFinite(a) || a < -EPS || Math.abs(a - distances[j][i]) > 1e-7) throw new Error('Invalid symmetric distance matrix');
    }
  }
}

/** Standard Neighbor Joining topology with nonnegative branch length projection.
 * Negative branch lengths can occur with non-additive semantic distances.
 */
export function neighborJoining(distances, names) {
  validateDistances(distances, names);
  const nodes = names.map((label, i) => ({ id:`leaf-${i}`, label, index:i }));
  const edges = [];
  let active = nodes.map(n => n.id), clippedBranches = 0;
  const d = new Map();
  function key(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  function get(a, b) { return a === b ? 0 : d.get(key(a, b)); }
  function set(a, b, v) { d.set(key(a, b), v); }
  function addEdge(source, target, length) {
    if (length < -EPS) clippedBranches++;
    edges.push({source, target, length:Math.max(0, length)});
  }
  for (let i=0;i<active.length;i++) for(let j=i+1;j<active.length;j++) set(active[i],active[j],distances[i][j]);
  let step = 0;
  while (active.length > 2) {
    const n = active.length;
    const r = new Map(active.map(a => [a, active.reduce((sum,b) => sum + get(a,b),0)]));
    let minQ = Infinity, selected = [0,1];
    for (let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
      const q = (n-2)*get(active[i],active[j])-r.get(active[i])-r.get(active[j]);
      if (q < minQ-EPS) { minQ=q; selected=[i,j]; }
    }
    const [i,j] = selected, a=active[i], b=active[j], dab=get(a,b);
    const delta=(r.get(a)-r.get(b))/(n-2);
    const parent=`internal-${step++}`;
    nodes.push({id:parent});
    addEdge(parent,a,(dab+delta)/2);
    addEdge(parent,b,(dab-delta)/2);
    const rest=active.filter((_,k) => k!==i && k!==j);
    for (const k of rest) set(parent,k,Math.max(0,(get(a,k)+get(b,k)-dab)/2));
    active=[...rest,parent];
  }
  addEdge(active[0], active[1], get(active[0],active[1]));
  return {nodes, edges, clippedBranches};
}

export function adjacency(graph) {
  const map=new Map(graph.nodes.map(n => [n.id, []]));
  for (const e of graph.edges) {
    map.get(e.source).push({id:e.target,length:e.length});
    map.get(e.target).push({id:e.source,length:e.length});
  }
  return map;
}

function leafDistancePath(from, to, adj) {
  const stack=[{id:from, parent:null, path:[], distance:0}];
  while(stack.length) {
    const curr=stack.pop();
    if(curr.id===to) return curr;
    for(const e of adj.get(curr.id)) if(e.id!==curr.parent) {
      stack.push({id:e.id,parent:curr.id,path:[...curr.path,{source:curr.id,target:e.id,length:e.length}],distance:curr.distance+e.length});
    }
  }
  throw new Error('Tree is disconnected');
}

/** Root the NJ tree at the midpoint of the weighted leaf-to-leaf diameter. */
export function midpointRoot(graph) {
  const leaves=graph.nodes.filter(n => n.label !== undefined);
  if (leaves.length < 2) throw new Error('Too few tree leaves');
  const adj=adjacency(graph);
  let best=null;
  for(let i=0;i<leaves.length;i++) for(let j=i+1;j<leaves.length;j++) {
    const candidate=leafDistancePath(leaves[i].id, leaves[j].id, adj);
    if(!best || candidate.distance>best.distance+EPS) best=candidate;
  }
  const half=best.distance/2;
  let walked=0, split=best.path[0], before=0;
  for(const e of best.path) {
    split=e; before=walked;
    if (walked+e.length>=half-EPS) break;
    walked+=e.length;
  }
  const left=Math.max(0, Math.min(split.length, half-before));
  const right=Math.max(0, split.length-left);
  const edges=graph.edges.filter(e => !(
    (e.source===split.source && e.target===split.target) ||
    (e.source===split.target && e.target===split.source)
  ));
  edges.push({source:'root',target:split.source,length:left},{source:'root',target:split.target,length:right});
  return {nodes:[...graph.nodes,{id:'root'}],edges,root:'root',diameter:best.distance,clippedBranches:graph.clippedBranches};
}

function quotedNewickLabel(value) {
  if (/[\s:;,()\[\]']/u.test(value) || value==='') return `'${value.replaceAll("'", "''")}'`;
  return value;
}
function fmt(length) { return Number(length.toFixed(8)).toString(); }

/** For unrooted Newick, a central arbitrary node is chosen for serialization. */
export function toNewick(graph, {unrooted=false}={}) {
  if (unrooted && graph.edges.length===1 && graph.nodes.filter(node=>node.label!==undefined).length===2) {
    const e=graph.edges[0];
    const labels=new Map(graph.nodes.map(node=>[node.id,node.label]));
    const half=fmt(e.length/2);
    return `[&U](${quotedNewickLabel(labels.get(e.source))}:${half},${quotedNewickLabel(labels.get(e.target))}:${half});\n`;
  }
  const adj=adjacency(graph);
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const start=unrooted ? (graph.root ?? graph.nodes.find(n=>!n.label)?.id ?? graph.nodes[0].id) : graph.root;
  if(!start) throw new Error('Root is missing');
  // Iterative serialization is required for deep trees with 8K+ leaves;
  // recursive Newick traversal may overflow the JavaScript call stack.
  const parts=[],stack=[{kind:'visit',id:start,parent:null}];
  while(stack.length){
    const item=stack.pop();
    if(item.kind==='text'){parts.push(item.value);continue;}
    const children=adj.get(item.id).filter(n=>n.id!==item.parent);
    if(!children.length){parts.push(quotedNewickLabel(byId.get(item.id).label??''));continue;}
    stack.push({kind:'text',value:')'});
    for(let k=children.length-1;k>=0;k--){
      const child=children[k];
      stack.push({kind:'text',value:`:${fmt(child.length)}`});
      stack.push({kind:'visit',id:child.id,parent:item.id});
      if(k>0)stack.push({kind:'text',value:','});
    }
    stack.push({kind:'text',value:'('});
  }
  return `${unrooted?'[&U]':'[&R]'}${parts.join('')};\n`;
}

/** Suppress the artificial degree-two agglomerative root for an unrooted view.
 * This changes representation, not the inferred topology or clustering method.
 */
export function unrootTree(graph) {
  if (!graph.root) return graph;
  const incident = graph.edges.filter(e => e.source===graph.root || e.target===graph.root);
  if (incident.length !== 2) return graph;
  const [a,b] = incident;
  const left = a.source === graph.root ? a.target : a.source;
  const right = b.source === graph.root ? b.target : b.source;
  return {
    ...graph,
    root: undefined,
    nodes: graph.nodes.filter(n => n.id !== graph.root),
    edges: [...graph.edges.filter(e => !incident.includes(e)),
      {source:left,target:right,length:a.length+b.length}],
  };
}
