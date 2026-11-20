/** Exact average/complete linkage using a nearest-neighbor chain and a
 * packed Float32 triangular distance table. O(n²) storage; no n×n JS arrays.
 * The input vectors must be unit-normalized row-major Float32 values.
 * This file is served as a static ES module and imported by embed-worker.js.
 */
export const MAX_TERMS = 16384;
export const NJ_LIMIT = 128;
export const MATRIX_PREVIEW = 24;

export function packedIndex(a, b) {
  if (a > b) [a, b] = [b, a];
  return b * (b - 1) / 2 + a;
}

// Min-heap of best scoring pairs, kept tiny to avoid storing O(n²) objects.
function offerTop(heap, limit, i, j, score) {
  if (heap.length === limit && score <= heap[0].score) return;
  if (heap.length < limit) {
    heap.push({ i, j, score });
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p].score <= heap[k].score) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
    return;
  }
  heap[0] = { i, j, score };
  let k = 0;
  while (2*k + 1 < heap.length) {
    let child = 2*k + 1;
    if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
    if (heap[k].score <= heap[child].score) break;
    [heap[k], heap[child]] = [heap[child], heap[k]];
    k = child;
  }
}

export function buildDistances(vectors, n, dimensions, progress = () => {}) {
  if (!Number.isInteger(n) || n < 2 || n > MAX_TERMS || !Number.isInteger(dimensions) || dimensions < 1 ||
      vectors.length !== n * dimensions) throw new Error('Invalid vector matrix dimensions');
  const count = n * (n - 1) / 2;
  const distances = new Float32Array(count);
  const previewSize = Math.min(MATRIX_PREVIEW, n);
  const preview = Array.from({ length: previewSize }, (_,i) => Array.from({ length: previewSize }, (_,j) => i === j ? 1 : 0));
  const top = [];
  let sum = 0;
  for (let j = 1; j < n; j++) {
    const row = j * dimensions;
    const offset = j*(j-1)/2;
    for (let i = 0; i < j; i++) {
      const row2 = i * dimensions;
      let dot = 0;
      for (let d = 0; d < dimensions; d++) dot += vectors[row+d] * vectors[row2+d];
      const score = Math.max(-1, Math.min(1, dot));
      distances[offset+i] = 1 - score;
      sum += score;
      offerTop(top, 30, i, j, score);
      if (j < previewSize) preview[i][j] = preview[j][i] = score;
    }
    if ((j & 31) === 0 || j === n-1) progress(j+1,n);
  }
  top.sort((a,b) => b.score-a.score || a.i-b.i || a.j-b.j);
  return { distances, summary: { meanCosine:sum/count, pairCount:count, topPairs:top, matrixPreview:preview } };
}

/** Nearest-neighbor-chain for reducible linkages (average and complete).
 * Uses cluster representatives 0..n-1, reusing the retired representative.
 * Numerical ties have deterministic ID-order resolution.
 */
export function clusterPacked(distances, names, linkage = 'average', progress = () => {}) {
  const n = names.length;
  if (linkage !== 'average' && linkage !== 'complete') throw new Error('Unsupported linkage');
  if (n < 2 || n > MAX_TERMS || distances.length !== n*(n-1)/2) throw new Error('Invalid packed distance matrix');
  const active = new Uint8Array(n).fill(1);
  const sizes = new Uint32Array(n).fill(1);
  const heights = new Float64Array(n);
  const clusterIds = names.map((_,i) => `leaf-${i}`);
  const nodes = names.map((label,i) => ({ id:`leaf-${i}`,label,index:i }));
  const edges = [];
  const chain = [];
  const get = (a,b) => distances[packedIndex(a,b)];
  const set = (a,b,v) => { distances[packedIndex(a,b)] = v; };
  let remaining = n, step = 0, merges = 0;

  while (remaining > 1) {
    if (!chain.length) {
      for (let i=0;i<n;i++) if(active[i]) { chain.push(i); break; }
    }
    const a = chain[chain.length-1];
    if (!active[a]) { chain.pop(); continue; }
    let b=-1, best=Infinity;
    for(let i=0;i<n;i++) {
      if(!active[i] || i===a) continue;
      const d = get(a,i);
      if (!Number.isFinite(d) || d < -1e-5) throw new Error('Invalid clustering distance');
      if(d < best || (d === best && i < b)) { best=d; b=i; }
    }
    if (b<0) throw new Error('Unable to find neighboring cluster');
    if (chain.length >= 2 && chain[chain.length-2] === b) {
      chain.pop();chain.pop();
      const keep = Math.min(a,b), drop = Math.max(a,b);
      const oldKeep = sizes[keep], oldDrop = sizes[drop];
      const height = Math.max(best/2, heights[keep], heights[drop]);
      const id=`internal-${step++}`;
      nodes.push({id});
      edges.push({source:id,target:clusterIds[keep],length:Math.max(0,height-heights[keep])});
      edges.push({source:id,target:clusterIds[drop],length:Math.max(0,height-heights[drop])});
      for (let i=0;i<n;i++) {
        if(!active[i] || i === keep || i === drop) continue;
        const da=get(keep,i),db=get(drop,i);
        set(keep,i,linkage==='average' ? (oldKeep*da+oldDrop*db)/(oldKeep+oldDrop) : Math.max(da,db));
      }
      sizes[keep] += oldDrop;
      heights[keep] = height;
      clusterIds[keep] = id;
      active[drop] = 0;
      remaining--;merges++;
      // A previous chain may mention the retired representative.
      for(let c=chain.length-1;c>=0;c--) if(chain[c]===drop || chain[c]===keep) chain.splice(c,1);
      if ((merges & 63)===0 || remaining===1) progress(merges,n-1);
    } else if (chain.includes(b)) {
      // Stable reset handles equal-distance cycles without falsely merging.
      chain.length=0;chain.push(b);
    } else {
      chain.push(b);
    }
  }
  const root=clusterIds[active.findIndex(v=>v===1)];
  return {nodes,edges,root,clippedBranches:0};
}
