// Static module worker; model inference, pairwise distances, and large-tree
// clustering stay in the browser. No application backend or inference API.
import {buildDistances,clusterPacked,MAX_TERMS,NJ_LIMIT} from './clustering.js';

const MODELS = {
  e5: 'Xenova/multilingual-e5-small',
  minilm: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
};
const LIBRARY_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const extractorPromises = new Map();
let busy = false;

function getExtractor(model,jobId){
  if(!extractorPromises.has(model)){
    const promise = (async()=>{
      const {pipeline,env}=await import(LIBRARY_URL);
      env.allowLocalModels=false;
      env.useBrowserCache=true;
      return pipeline('feature-extraction',MODELS[model],{
        device:'wasm',dtype:'q8',
        progress_callback:({status,file,progress})=>{
          if(status==='progress'&&Number.isFinite(progress)){
            self.postMessage({type:'model-progress',jobId,file,progress});
          }
        },
      });
    })().catch(error=>{extractorPromises.delete(model);throw error;});
    extractorPromises.set(model,promise);
  }
  return extractorPromises.get(model);
}

self.onmessage=async({data})=>{
  if(data?.type!=='embed'||!Number.isInteger(data.jobId)||!Array.isArray(data.words)||busy)return;
  const {jobId,words}=data;
  const model=data.model==='minilm'?'minilm':'e5';
  const linkage=['average','complete','nj'].includes(data.linkage)?data.linkage:'average';
  try{
    if(words.length<2||words.length>MAX_TERMS)throw new Error(`Supported list size: 2–${MAX_TERMS.toLocaleString('en-US')} terms.`);
    if(linkage==='nj'&&words.length>NJ_LIMIT)throw new Error(`Neighbor Joining is limited to ${NJ_LIMIT} terms.`);
    busy=true;
    self.postMessage({type:'status',jobId,phase:'loading',text:`Loading ${MODELS[model]} (q8)…`});
    const extractor=await getExtractor(model,jobId);
    const BATCH_SIZE=8;
    let packed=null,dimension=0;
    for(let begin=0;begin<words.length;begin+=BATCH_SIZE){
      const batch=words.slice(begin,begin+BATCH_SIZE).map(w=>model==='e5'?`query: ${w}`:w);
      const tensor=await extractor(batch,{pooling:'mean',normalize:true});
      const dataArray=tensor.data;
      if(!dimension){
        dimension=dataArray.length/batch.length;
        if(!Number.isInteger(dimension)||dimension<1)throw new Error('Unexpected embedding dimensions');
        packed=new Float32Array(words.length*dimension);
      }
      if(dataArray.length!==batch.length*dimension)throw new Error('Inconsistent embedding dimensions');
      packed.set(dataArray,begin*dimension);
      self.postMessage({type:'status',jobId,phase:'embedding',text:`Embedding ${Math.min(words.length,begin+batch.length)} / ${words.length}`,done:Math.min(words.length,begin+batch.length),total:words.length});
    }
    self.postMessage({type:'status',jobId,phase:'distance',text:'Computing exact pairwise cosine distances…',done:0,total:words.length});
    const {distances,summary}=buildDistances(packed,words.length,dimension,(done,total)=>{
      self.postMessage({type:'status',jobId,phase:'distance',text:`Computing distances ${done} / ${total}`,done,total});
    });
    if(linkage==='nj'){
      const embeddings=Array.from({length:words.length},(_,i)=>Array.from(packed.subarray(i*dimension,(i+1)*dimension)));
      self.postMessage({type:'result',jobId,linkage,embeddings,summary});
    } else {
      packed=null; // release embedding memory before clustering
      self.postMessage({type:'status',jobId,phase:'cluster',text:`Building ${linkage} linkage tree…`,done:0,total:words.length-1});
      const graph=clusterPacked(distances,words,linkage,(done,total)=>{
        self.postMessage({type:'status',jobId,phase:'cluster',text:`Merging clusters ${done} / ${total}`,done,total});
      });
      self.postMessage({type:'result',jobId,linkage,graph,summary});
    }
  } catch(error){
    self.postMessage({type:'error',jobId,message:error?.message||String(error)});
  } finally {busy=false;}
};
