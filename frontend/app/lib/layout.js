import { adjacency } from './phylogeny.js';

/** The rooted phylogram uses exact horizontal branch distances. */
export function rootedLayout(graph) {
  const adj=adjacency(graph), byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const coords=new Map(), parent=new Map(), children=new Map();
  function visit(id,previous,depth) {
    parent.set(id,previous);
    coords.set(id,{distance:depth});
    const next=adj.get(id).filter(e=>e.id!==previous).sort((a,b)=>minLeafIndex(a.id,id)-minLeafIndex(b.id,id));
    children.set(id,next);
    for(const e of next) visit(e.id,id,depth+e.length);
  }
  function minLeafIndex(id,previous) {
    const node=byId.get(id);
    if(node.index!==undefined) return node.index;
    let least=Infinity;
    for(const next of adj.get(id)) if(next.id!==previous) least=Math.min(least,minLeafIndex(next.id,id));
    return least;
  }
  visit(graph.root,null,0);
  let y=46;
  function assignY(id) {
    const links=children.get(id);
    if (!links.length) { coords.get(id).y=y; y+=40; return coords.get(id).y; }
    const ys=links.map(e=>assignY(e.id));
    coords.get(id).y=(ys[0]+ys[ys.length-1])/2;
    return coords.get(id).y;
  }
  assignY(graph.root);
  const maxDistance=Math.max(...[...coords.values()].map(p=>p.distance),1e-6);
  for (const p of coords.values()) p.x=40+p.distance/maxDistance*710;
  return {coords,viewBox:`0 0 1080 ${Math.max(400,y+24)}`,width:1080,height:Math.max(400,y+24)};
}

/** A deterministic radial layout for unrooted trees.
 * Offset is added for visibility; geometry is not an exact distance scale.
 */
export function unrootedLayout(graph) {
  const adj=adjacency(graph), byId=new Map(graph.nodes.map(n=>[n.id,n]));
  // For an unrooted dendrogram, pick a topological centroid (not the
  // arbitrary first merge). This balances radial sectors for large previews.
  function centroid() {
    const start=graph.nodes.find(n=>n.label===undefined)?.id ?? graph.nodes[0].id;
    const parent=new Map([[start,null]]),order=[start];
    for(let i=0;i<order.length;i++)for(const next of adj.get(order[i])){
      if(next.id!==parent.get(order[i])){parent.set(next.id,order[i]);order.push(next.id);}
    }
    const total=graph.nodes.filter(n=>n.label!==undefined).length;
    const leafCounts=new Map();
    for(let i=order.length-1;i>=0;i--){
      const id=order[i], node=byId.get(id);
      let count=node.label!==undefined?1:0;
      for(const child of adj.get(id))if(parent.get(child.id)===id)count+=leafCounts.get(child.id);
      leafCounts.set(id,count);
    }
    let best=start,balance=Infinity;
    for(const id of order){
      if(byId.get(id).label!==undefined&&total>2)continue;
      let largest=total-leafCounts.get(id);
      for(const child of adj.get(id))if(parent.get(child.id)===id)
        largest=Math.max(largest,leafCounts.get(child.id));
      if(largest<balance){best=id;balance=largest;}
    }
    return best;
  }
  const center=graph.root ?? centroid();
  const counts=new Map();
  function countLeaves(id,parent) {
    const node=byId.get(id);
    if(node.label!==undefined) return 1;
    const total=adj.get(id).filter(e=>e.id!==parent).reduce((s,e)=>s+countLeaves(e.id,id),0);
    counts.set(`${parent ?? 'start'}|${id}`,total);
    return total;
  }
  const total=countLeaves(center,null),coords=new Map([[center,{x:0,y:0}]]);
  const maxLen=Math.max(0.001,...graph.edges.map(e=>e.length));
  function position(id,parent,begin,end) {
    const next=adj.get(id).filter(e=>e.id!==parent);
    const subtotal=next.reduce((s,e)=>s+(byId.get(e.id).label!==undefined ? 1 : counts.get(`${id}|${e.id}`)),0);
    let angle=begin;
    for(const e of next) {
      const leaves=byId.get(e.id).label!==undefined ? 1 : counts.get(`${id}|${e.id}`);
      const width=(end-begin)*leaves/subtotal;
      const mid=angle+width/2;
      const dist=34+130*e.length/maxLen;
      const here=coords.get(id);
      coords.set(e.id,{x:here.x+Math.cos(mid)*dist,y:here.y+Math.sin(mid)*dist});
      position(e.id,id,angle,angle+width);
      angle+=width;
    }
  }
  position(center,null,-Math.PI/2,-Math.PI/2+Math.PI*2);
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of coords.values()) {
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);
    minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
  }
  const marginX=170,marginY=75;
  const w=Math.max(760,maxX-minX+2*marginX),h=Math.max(520,maxY-minY+2*marginY);
  const ox=(w-(maxX-minX))/2-minX,oy=(h-(maxY-minY))/2-minY;
  for(const p of coords.values()) { p.x+=ox; p.y+=oy; }
  return {coords,viewBox:`0 0 ${w} ${h}`,width:w,height:h};
}
