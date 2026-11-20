import {parseCsv} from './csv';
import type {TreeGraph} from './phylogeny';

export type Paper = {
  id:string;title:string;abstract:string;abstract_source:string;year:number|null;doi:string|null;url:string|null;
  groups:string[];cited_by_count:number;referenced_works:string[];
};
export type PaperCluster = {id:number;label:string;size:number;paper_indices:number[];groups:Record<string,number>};
export type PaperResult = {
  papers:Paper[];model:string;linkage:string;tree:TreeGraph;clusters:PaperCluster[];
  bridges:Array<{a:number;b:number;similarity:number;group_a:string;group_b:string}>;
  shared_papers:number[];citations:Array<{from:number;to:number}>;paper_count:number;group_labels:string[];
  mean_cosine:number;notes:string;
};

/** Bibliography CSV: abstract text is *ignored*. Backend resolves original source abstracts. */
export function parsePapersCsv(source:string):Paper[] {
  const rows=parseCsv(source);
  if(rows.length<2)throw new Error('The CSV must have a header and at least one paper.');
  const names=rows[0].map((v:string)=>v.trim().toLowerCase());
  const col=(name:string)=>names.indexOf(name);
  if(col('title')<0)throw new Error('A title column is required.');
  const get=(row:string[],name:string)=> (col(name)>=0?row[col(name)]??'':'').trim();
  const papers:Paper[]=rows.slice(1).filter((r:string[])=>get(r,'title')).map((row:string[],i:number)=>{
    const title=get(row,'title');
    const yearValue=get(row,'year');
    const year=yearValue?Number(yearValue):null;
    if(title.length>1000)throw new Error(`Row ${i+2}: title exceeds 1000 characters.`);
    if(year!==null&&(!Number.isInteger(year)||year<1800||year>2200))throw new Error(`Row ${i+2}: invalid year.`);
    const groups=(get(row,'groups')||get(row,'group')).split(/[;|]/).map((v:string)=>v.trim()).filter(Boolean);
    return {id:get(row,'id')||`local-${i}`,title,abstract:'',abstract_source:'',year,
      doi:get(row,'doi')||null,url:get(row,'url')||null,groups,
      cited_by_count:0,referenced_works:[]};
  });
  if(papers.length<2)throw new Error('At least two paper records are needed.');
  return papers;
}
