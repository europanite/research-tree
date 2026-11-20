import React,{useMemo,useRef,useState} from 'react';
import {Linking,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,useWindowDimensions,View} from 'react-native';
import TreeView from '../components/TreeView';
import {downloadText,toSvg} from '../lib/export';
import {toNewick,unrootTree} from '../lib/phylogeny';
import {previewTree} from '../lib/preview';
import {parsePapersCsv,type Paper,type PaperResult} from '../lib/papers';
import {FIELD_SURVEY_QUERIES,BASIC_QUERIES,parsePaperQueries} from '../lib/paperQueries';

const API_URL=(process.env.EXPO_PUBLIC_PAPER_API_URL||'http://localhost:8000').replace(/\/$/,'');
const C={text:'#f8fafc',muted:'#b3bad0',panel:'#101527',border:'#302744',highlight:'#aa8ffd'};

function Action({label,onPress,disabled=false,secondary=false,testID}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;testID?:string}){
  return <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button,{backgroundColor:secondary?'#1e2539':'#a58af7',borderColor:secondary?'#4c4271':'#a58af7',opacity:disabled ? .45 : 1}]}>
    <Text style={{color:secondary?'#e1d8ff':'#110c20',fontWeight:'800',fontSize:12}}>{label}</Text>
  </Pressable>;
}

async function post<T>(path:string,payload:unknown):Promise<T>{
  const response=await fetch(`${API_URL}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(!response.ok){
    let message=`HTTP ${response.status}`;
    try{const body=await response.json();message=typeof body.detail==='string'?body.detail:message;}catch{}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export default function PaperScreen(){
  const {width}=useWindowDimensions();
  const wide=width>=1050;
  const [queries,setQueries]=useState(FIELD_SURVEY_QUERIES);
  const [limitInput,setLimitInput]=useState('100');
  const [citationsInput,setCitationsInput]=useState('600');
  const limit=Number(limitInput);
  const citations=Number(citationsInput);
  const [diversify,setDiversify]=useState(true);
  const [papers,setPapers]=useState<Paper[]>([]);
  const [origin,setOrigin]=useState('No papers collected yet.');
  const [omitted,setOmitted]=useState<Array<{id:string;title:string;reason:string}>>([]);
  const [model,setModel]=useState<'minilm'|'tfidf'|'specter2'>('minilm');
  const [linkage,setLinkage]=useState<'average'|'complete'>('average');
  const [treeMode,setTreeMode]=useState<'rooted'|'unrooted'>('rooted');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('Ready. Run with Docker Compose on localhost to use the local API.');
  const [result,setResult]=useState<PaperResult|null>(null);
  const [selected,setSelected]=useState<number|null>(null);
  const [expanded,setExpanded]=useState<number|null>(null);
  const operation=useRef(0);
  const viewTree=useMemo(()=>{
    if(!result)return null;
    const preview=previewTree(result.tree,128);
    return treeMode==='unrooted'?unrootTree(preview):preview;
  },[result,treeMode]);
  const paper=selected===null?null:result?.papers[selected];
  const changePapers=(updated:Paper[],description:string)=>{
    operation.current++;setPapers(updated);setOrigin(description);setResult(null);setSelected(null);setOmitted([]);
  };
  const fetchOpenAlex=async()=>{
    if(busy)return;
    let parsed;
    try{parsed=parsePaperQueries(queries);}catch(error){setStatus(String(error instanceof Error?error.message:error));return;}
    if(!/^[1-9]\d*$/.test(limitInput)||!Number.isSafeInteger(limit)||limit<2||
       !/^(0|[1-9]\d*)$/.test(citationsInput)||!Number.isSafeInteger(citations)){
      setStatus('Enter a valid integer (at least 2 per query; citations >= 0).');return;
    }
    setBusy(true);setResult(null);setStatus('Sampling broad fields and expanding the citation neighborhood…');
    const current=++operation.current;
    try{
      const response=await post<{papers:Paper[];count:number;collection:{search_papers:number;citation_added:number;queries:number;diversified:boolean}}>('/api/papers/search',{
        queries:parsed,limit_per_query:limit,diversify,citation_expansion:citations,
      });
      if(current!==operation.current)return;
      changePapers(response.papers,'OpenAlex search');
      setStatus(`Collected ${response.count} verified works: ${response.collection.search_papers} from broad searches and ${response.collection.citation_added} from their reference graph. This is a sample, not a complete census.`);
    }catch(error){if(current===operation.current)setStatus(`Search error: ${String(error instanceof Error?error.message:error)}`);}
    finally{setBusy(false);}
  };
  const loadCurated=async()=>{
    if(busy)return;
    setBusy(true);setResult(null);setStatus('Fetching genuine paper abstracts from arXiv / OpenAlex…');
    const current=++operation.current;
    try{
      const response=await fetch(`${API_URL}/api/papers/curated`);
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.detail||`HTTP ${response.status}`);}
      const data=await response.json() as {papers:Paper[];count:number;requested:number;omitted:Array<{id:string;title:string;reason:string}>};
      if(current!==operation.current)return;
      changePapers(data.papers,'Verified arXiv/OpenAlex abstracts');
      setStatus(`Original abstracts: ${data.count}/${data.requested}. Excluded ${data.omitted.length} unavailable/unmatched records.`);
      setOmitted(data.omitted);
    }catch(error){if(current===operation.current)setStatus(`Curated data error: ${String(error instanceof Error?error.message:error)}`);}
    finally{setBusy(false);}
  };
  const loadCsv=()=>{
    if(Platform.OS!=='web'||typeof document==='undefined'){
      setStatus('CSV import requires a browser.');return;
    }
    const picker=document.createElement('input');picker.type='file';picker.accept='.csv,text/csv';
    picker.onchange=async()=>{
      const file=picker.files?.[0];if(!file)return;
      try{
        const records=parsePapersCsv(await file.text());
        setBusy(true);setStatus('Verifying identifiers and retrieving original abstracts…');
        const data=await post<{papers:Paper[];count:number;requested:number;omitted:Array<{id:string;title:string;reason:string}>}>('/api/papers/resolve',{papers:records});
        changePapers(data.papers,file.name+' (verified abstracts)');
        setStatus(`Original abstracts: ${data.count}/${data.requested}; excluded ${data.omitted.length} missing/mismatched. CSV abstract text was ignored.`);
        setOmitted(data.omitted);
      }catch(error){setStatus(`CSV error: ${String(error instanceof Error?error.message:error)}`);}
      finally{setBusy(false);}
    };
    picker.click();
  };
  const build=async()=>{
    if(busy||papers.length<2||papers.some(p=>!p.abstract||!p.abstract_source))return;
    setBusy(true);setResult(null);setStatus(`Running ${model} embeddings and ${linkage} clustering locally…`);
    const current=++operation.current;
    try{
      const data=await post<PaperResult>('/api/papers/analyze',{papers,model,linkage});
      if(current!==operation.current)return;
      setResult(data);setSelected(null);setExpanded(null);
      setStatus(`Done: ${data.paper_count} papers, ${data.clusters.length} topic clusters, ${data.bridges.length} cross-field candidates.`);
    }catch(error){if(current===operation.current)setStatus(`Analysis error: ${String(error instanceof Error?error.message:error)}`);}
    finally{setBusy(false);}
  };
  const exportGraph=(type:'svg'|'newick'|'json')=>{
    if(!result)return;
    const exportTree=treeMode==='unrooted'?unrootTree(result.tree):result.tree;
    if(type==='json')downloadText('paper_map.json',JSON.stringify(result,null,2),'application/json');
    if(type==='newick')downloadText(`papers_${result.linkage}_${treeMode}_tree.nwk`,toNewick(exportTree,{unrooted:treeMode==='unrooted'}),'text/plain;charset=utf-8');
    if(type==='svg'&&viewTree)downloadText(`papers_${treeMode}_preview.svg`,toSvg(viewTree,treeMode),'image/svg+xml');
  };
  const openPaper=(value:string|null|undefined)=>{
    if(!value || !/^https:\/\//i.test(value)){setStatus('No safe HTTPS paper link available.');return;}
    void Linking.openURL(value);
  };
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <Text style={styles.hero}>Paper-level research map</Text>
    <Text style={styles.caption}>Cluster publications by title + verified source abstract, inspect topic groups, and find cross-field candidate pairs. Inference stays on your local backend; OpenAlex searches access public metadata.</Text>
    <View style={[styles.columns,{flexDirection:wide?'row':'column'}]}>
      <View style={[styles.left,{width:wide?360:'100%'}]}>
        <View style={styles.card}>
          <Text style={styles.heading}>01 · Collect papers</Text>
          <Text style={styles.caption}>Systematic field sampling: broad research headings only; no preselected papers. Citation expansion discovers papers absent from initial text matches.</Text>
          <View style={styles.options}>
            <Action label="Broad field survey (29 topics)" secondary disabled={busy} onPress={()=>{setQueries(FIELD_SURVEY_QUERIES);setLimitInput('100');setCitationsInput('600');setDiversify(true);}}/>
            <Action label="Basic (2 headings)" secondary disabled={busy} onPress={()=>{setQueries(BASIC_QUERIES);setCitationsInput('0');setDiversify(false);}}/>
          </View>
          <Text style={styles.caption}>One query per line: Group label | OpenAlex search phrase</Text>
          <TextInput multiline value={queries} onChangeText={setQueries} editable={!busy}
            style={styles.textarea} accessibilityLabel="Paper search queries" textAlignVertical="top"/>
          <View style={styles.options}>
            {[30,60,100,150,250,500].map(n=><Pressable key={n} disabled={busy} onPress={()=>setLimitInput(String(n))} style={[styles.option,limit===n&&styles.selected]}><Text style={styles.optionText}>{n} / query</Text></Pressable>)}
          </View>
          <Text style={styles.caption}>Papers per search phrase (no application cap)</Text>
          <TextInput value={limitInput} onChangeText={setLimitInput} editable={!busy} keyboardType="numeric"
            accessibilityLabel="Papers per query" style={styles.numberInput} />
          <Text style={styles.subtitle}>One-hop citation expansion</Text>
          <View style={styles.options}>
            {[0,300,600,900,1200].map(n=><Pressable key={n} disabled={busy} onPress={()=>setCitationsInput(String(n))} style={[styles.option,citations===n&&styles.selected]}><Text style={styles.optionText}>{n} cited works</Text></Pressable>)}
          </View>
          <Text style={styles.caption}>One-hop cited works (no application cap)</Text>
          <TextInput value={citationsInput} onChangeText={setCitationsInput} editable={!busy} keyboardType="numeric"
            accessibilityLabel="Citation expansion count" style={styles.numberInput} />
          <Text style={styles.caption}>Diversified sampling: {diversify?'on (relevance, citations, recent)':'off (relevance only)'} · {queries.split(/\r?\n/).filter(Boolean).length} headings × {limitInput} + {citationsInput} citation slots. No application paper limit; large jobs may exhaust RAM or hit OpenAlex quotas. Source abstracts required.</Text>
          <Action label={busy?'Working…':'Search OpenAlex'} onPress={()=>void fetchOpenAlex()} disabled={busy} testID="paper-search-button"/>
          <Action label="Import bibliography CSV" onPress={loadCsv} disabled={busy} secondary testID="paper-upload-button"/>
          <Action label="Fetch 59 real-paper abstracts" onPress={()=>void loadCurated()} disabled={busy} secondary testID="paper-curated-button"/>
          <Text style={styles.caption}>{papers.length} verified-abstract records · {origin}</Text>
          {omitted.length>0&&<View style={styles.cluster}>
            <Text style={styles.subtitle}>Excluded papers ({omitted.length})</Text>
            {omitted.slice(0,15).map((item,index)=><Text key={`${item.id}-${index}`} style={styles.caption}>{item.title}: {item.reason}</Text>)}
            {omitted.length>15&&<Text style={styles.caption}>Showing 15 of {omitted.length} exclusions. Full list available in /api/papers/curated response.</Text>}
          </View>}
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>02 · Analyze</Text>
          <Text style={styles.subtitle}>Local embedding model</Text>
          <View style={styles.options}>
            {([['minilm','MiniLM'],['specter2','SPECTER2 (optional)'],['tfidf','TF-IDF baseline']] as const).map(([value,label])=><Pressable key={value} disabled={busy} onPress={()=>{setModel(value);setResult(null);}} style={[styles.option,model===value&&styles.selected]}><Text style={styles.optionText}>{label}</Text></Pressable>)}
          </View>
          <Text style={styles.subtitle}>Linkage</Text>
          <View style={styles.options}>
            {(['average','complete'] as const).map(value=><Pressable key={value} disabled={busy} onPress={()=>{setLinkage(value);setResult(null);}} style={[styles.option,linkage===value&&styles.selected]}><Text style={styles.optionText}>{value}</Text></Pressable>)}
          </View>
          <Action label={busy?'Working…':'Build paper tree'} onPress={()=>void build()} disabled={busy||papers.length<2||papers.some(p=>!p.abstract||!p.abstract_source)} testID="paper-analyze-button"/>
          <Text style={styles.caption}>SPECTER2 needs the optional adapter dependencies. CPU model downloads may be large on first run. No external inference API is used.</Text>
          <Text testID="paper-status" style={styles.status}>{status}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <View style={styles.card}>
          <Text style={styles.heading}>03 · Paper dendrogram</Text>
          <View style={styles.options}>
            {(['rooted','unrooted'] as const).map(mode=><Pressable key={mode} accessibilityRole="button" testID={`paper-tree-${mode}`} onPress={()=>setTreeMode(mode)} style={[styles.option,treeMode===mode&&styles.selected]}>
              <Text style={styles.optionText}>{mode==='rooted'?'Rooted':'Unrooted (radial)'}</Text>
            </Pressable>)}
          </View>
          {viewTree?<View style={styles.tree}><TreeView graph={viewTree} mode={treeMode}/></View>:<View style={styles.empty}><Text style={styles.caption}>Collect or import at least two papers, then build the tree.</Text></View>}
          {result&&<Text style={styles.caption}>Leaves are papers. Preview shows at most 128 groups; exported Newick preserves all {result.paper_count} papers. Unrooted view suppresses the artificial clustering root; it is the same linkage topology, not an independently inferred Neighbor Joining tree.</Text>}
          <View style={styles.options}>
            <Action label="SVG preview" secondary disabled={!result} onPress={()=>exportGraph('svg')}/>
            <Action label="Newick (all)" secondary disabled={!result} onPress={()=>exportGraph('newick')}/>
            <Action label="JSON metadata" secondary disabled={!result} onPress={()=>exportGraph('json')}/>
          </View>
        </View>
        {result&&<>
          <View style={styles.card}>
            <Text style={styles.heading}>04 · Shared-field papers ({result.shared_papers.length})</Text>
            <Text style={styles.caption}>Records returned for multiple searches or assigned multiple CSV groups, indicating potentially direct overlap.</Text>
            {result.shared_papers.slice(0,30).map(i=><Pressable key={i} onPress={()=>setSelected(i)}><Text style={styles.link}>{result.papers[i].title} · {result.papers[i].groups.join(' / ')}</Text></Pressable>)}
            {!result.shared_papers.length&&<Text style={styles.caption}>No direct multi-group records in this sample.</Text>}
          </View>
          <View style={styles.card}>
            <Text style={styles.heading}>05 · Topic clusters ({result.clusters.length})</Text>
            <Text style={styles.caption}>Labels are automatically extracted keywords, not verified ontology terms. Click a cluster to inspect its papers.</Text>
            {result.clusters.map(cluster=><View key={cluster.id} style={styles.cluster}>
              <Pressable accessibilityRole="button" onPress={()=>setExpanded(expanded===cluster.id?null:cluster.id)}>
                <Text style={styles.subtitle}>{cluster.label} · {cluster.size} papers {expanded===cluster.id?'−':'+'}</Text>
                <Text style={styles.caption}>{Object.entries(cluster.groups).map(([g,n])=>`${g}: ${n}`).join(' · ')||'Ungrouped'}</Text>
              </Pressable>
              {expanded===cluster.id&&cluster.paper_indices.map(i=><Pressable key={i} onPress={()=>setSelected(i)}><Text style={styles.link}>{result.papers[i].year||'n.d.'} · {result.papers[i].title}</Text></Pressable>)}
            </View>)}
          </View>
          <View style={styles.card}>
            <Text style={styles.heading}>06 · Cross-field candidates ({result.bridges.length})</Text>
            <Text style={styles.caption}>Top cosine-similar pairs belonging to different input query groups. These are not automatically research gaps.</Text>
            {result.bridges.length?result.bridges.slice(0,20).map(bridge=><View key={`${bridge.a}-${bridge.b}`} style={styles.cluster}>
              <Text style={styles.subtitle}>{bridge.similarity.toFixed(3)} · {bridge.group_a} ↔ {bridge.group_b}</Text>
              <Pressable onPress={()=>setSelected(bridge.a)}><Text style={styles.link}>{result.papers[bridge.a].title}</Text></Pressable>
              <Pressable onPress={()=>setSelected(bridge.b)}><Text style={styles.link}>{result.papers[bridge.b].title}</Text></Pressable>
            </View>):<Text style={styles.caption}>Use at least two input group labels to identify cross-group candidates.</Text>}
            <Text style={styles.caption}>Known in-corpus citation edges: {result.citations.length}. Citation direction is recorded in JSON, not used to impose ancestry.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.heading}>07 · Paper details</Text>
            {paper?<>
              <Text style={styles.subtitle}>{paper.title}</Text>
              <Text style={styles.caption}>{paper.year||'n.d.'} · {paper.groups.join(' / ')||'Ungrouped'} · {paper.cited_by_count} citations (metadata)</Text>
              <Text style={styles.caption}>Original abstract source: {paper.abstract_source}</Text>
              <Text style={styles.body}>{paper.abstract}</Text>
              <Action label="Open paper source" secondary onPress={()=>openPaper(paper.doi||paper.url)}/>
            </>:<Text style={styles.caption}>Select a paper in a topic cluster or cross-field candidate pair.</Text>}
          </View>
        </>}
      </View>
    </View>
    <Text style={styles.footer}>LOCAL PAPER EMBEDDINGS · OPENALEX METADATA · EXPLORATORY TAXONOMY</Text>
  </ScrollView>;
}

const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:'#080c17'},content:{paddingHorizontal:20,paddingVertical:26,maxWidth:1510,width:'100%',alignSelf:'center',gap:16},
  hero:{color:C.text,fontSize:28,fontWeight:'900'},caption:{color:C.muted,fontSize:12,lineHeight:19},
  columns:{gap:18,alignItems:'flex-start'},left:{gap:16},right:{flex:1,gap:16,width:'100%',minWidth:0},
  card:{backgroundColor:C.panel,borderColor:C.border,borderWidth:1,borderRadius:16,padding:18,gap:12},
  heading:{fontSize:16,color:C.text,fontWeight:'900'},subtitle:{color:'#e9e1ff',fontSize:13,fontWeight:'800'},
  body:{color:C.text,fontSize:12,lineHeight:20},status:{color:'#f5d991',fontSize:12,lineHeight:19},
  numberInput:{height:42,borderColor:'#41365b',borderWidth:1,borderRadius:9,padding:10,backgroundColor:'#080d1b',color:C.text,fontSize:12},
  textarea:{height:190,borderColor:'#41365b',borderWidth:1,borderRadius:9,padding:10,backgroundColor:'#080d1b',color:C.text,fontSize:12},
  options:{flexDirection:'row',gap:8,flexWrap:'wrap'},option:{backgroundColor:'#1e2539',borderWidth:1,borderColor:'#41365b',paddingHorizontal:10,paddingVertical:9,borderRadius:8},
  selected:{backgroundColor:'#7554b9',borderColor:'#c0a3ff'},optionText:{color:'#fff',fontWeight:'700',fontSize:11},
  button:{borderRadius:9,borderWidth:1,paddingHorizontal:12,paddingVertical:11,alignItems:'center',minHeight:42,justifyContent:'center'},
  tree:{minHeight:400,backgroundColor:'#0b1020',overflow:'hidden',borderRadius:10},empty:{minHeight:250,alignItems:'center',justifyContent:'center'},
  cluster:{gap:7,borderBottomWidth:1,borderColor:'#2e2d41',paddingBottom:10,paddingTop:4},
  link:{color:'#d3bafa',textDecorationLine:'underline',fontSize:12,lineHeight:19},footer:{color:'#8b89a6',fontSize:10,letterSpacing:1.5,textAlign:'center',paddingTop:20},
});
