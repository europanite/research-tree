export type WorkerReply =
  | { type:'status'; jobId:number; phase:'loading'|'embedding'|'distance'|'cluster'; text:string; done?:number; total?:number }
  | { type:'model-progress'; jobId:number; progress:number; file?:string }
  | { type:'result'; jobId:number; linkage:'average'|'complete'|'nj'; summary: {pairCount:number;meanCosine:number;topPairs:Array<{i:number;j:number;score:number}>;matrixPreview:number[][]}; graph?: import('./phylogeny').TreeGraph; embeddings?:number[][] }
  | { type:'error'; jobId:number; message:string };

// Web-only application: use Expo's copied public/ assets to avoid bundler-specific
// Worker code and to maintain correct paths for GitHub Pages subdirectory hosting.
export function createEmbeddingWorker(): Worker {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('A browser with Web Worker support is required.');
  }
  // A variable prevents Expo Metro from trying to bundle public/embed-worker.js.
  const publicWorkerPath = 'embed-worker.js';
  return new Worker(new URL(publicWorkerPath, document.baseURI), {type:'module'});
}
