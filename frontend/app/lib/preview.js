/** Simplify only the on-screen graph. Export uses the untouched full tree. */
export function previewTree(graph,maxLeaves=128){
  const leaves=graph.nodes.filter(n=>n.label!==undefined);
  if(leaves.length<=maxLeaves)return graph;
  if(!graph.root)throw new Error('Root required to build large-tree preview');
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const adjacency=new Map(graph.nodes.map(n=>[n.id,[]]));
  for(const edge of graph.edges){
    adjacency.get(edge.source).push({id:edge.target,length:edge.length});
    adjacency.get(edge.target).push({id:edge.source,length:edge.length});
  }
  const parents=new Map([[graph.root,null]]),order=[graph.root],children=new Map();
  for(let k=0;k<order.length;k++){
    const id=order[k];
    const kids=adjacency.get(id).filter(e=>e.id!==parents.get(id));
    children.set(id,kids);
    for(const c of kids){parents.set(c.id,id);order.push(c.id);}
  }
  const counts=new Map(),firstLabel=new Map(),firstIndex=new Map();
  for(let i=order.length-1;i>=0;i--){
    const id=order[i],node=byId.get(id),kids=children.get(id);
    if(node.label!==undefined){counts.set(id,1);firstLabel.set(id,node.label);firstIndex.set(id,node.index);}
    else {
      counts.set(id,kids.reduce((acc,c)=>acc+counts.get(c.id),0));
      firstLabel.set(id,firstLabel.get(kids[0].id));
      firstIndex.set(id,Math.min(...kids.map(c=>firstIndex.get(c.id))));
    }
  }
  const frontier=new Set([graph.root]);
  while(frontier.size<maxLeaves){
    let candidate=null,size=0;
    for(const id of frontier){
      if(children.get(id).length && counts.get(id)>size && frontier.size+children.get(id).length-1<=maxLeaves){
        candidate=id;size=counts.get(id);
      }
    }
    if(!candidate)break;
    frontier.delete(candidate);
    for(const c of children.get(candidate))frontier.add(c.id);
  }
  const included=new Set([graph.root]);
  for(const id of frontier){
    let current=id;
    while(current!==null && !included.has(current)){
      included.add(current);current=parents.get(current)??null;
    }
  }
  const nodes=[...included].map(id=>{
    const node=byId.get(id);
    if(frontier.has(id) && node.label===undefined){
      return {...node,label:`${firstLabel.get(id)} (+${counts.get(id)-1})`,index:firstIndex.get(id)};
    }
    return {...node};
  });
  const edgeList=graph.edges.filter(e=>included.has(e.source)&&included.has(e.target)).map(e=>({...e}));
  // Compress long unary chains to avoid rendering thousands of invisible junctions.
  const edgeAdj=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of edgeList){edgeAdj.get(e.source).push(e);edgeAdj.get(e.target).push(e);}
  const removed=new Set();
  for(const node of nodes){
    if(node.id===graph.root || node.label!==undefined)continue;
    const links=edgeAdj.get(node.id).filter(e=>!e.deleted);
    if(links.length!==2)continue;
    const a=links[0],b=links[1],left=a.source===node.id?a.target:a.source,right=b.source===node.id?b.target:b.source;
    if(left===right)continue;
    a.deleted=true;b.deleted=true;removed.add(node.id);
    const replacement={source:left,target:right,length:a.length+b.length};
    edgeList.push(replacement);edgeAdj.get(left).push(replacement);edgeAdj.get(right).push(replacement);
  }
  return {
    nodes:nodes.filter(n=>!removed.has(n.id)),
    edges:edgeList.filter(e=>!e.deleted).map(({source,target,length})=>({source,target,length})),
    root:graph.root,clippedBranches:graph.clippedBranches
  };
}
