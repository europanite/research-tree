import React, {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {
  Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View
} from 'react-native';
import TreeView from '../components/TreeView';
import {extractWords, matrixToCsv, csvEscape} from '../lib/csv';
import {cosineMatrix, distanceMatrix, midpointRoot, neighborJoining, toNewick, type TreeGraph} from '../lib/phylogeny';
import {downloadText, toSvg, type TreeMode} from '../lib/export';
import {createEmbeddingWorker, type WorkerReply} from '../lib/worker';
import {SAMPLE_CSV} from './HomeScreenUtil';
import {previewTree} from '../lib/preview';
import {MAX_TERMS,NJ_LIMIT,MATRIX_PREVIEW} from '../public/clustering';

type Analysis = {words:string[]; duplicates:number; unrooted:TreeGraph; rooted:TreeGraph; method:'average'|'complete'|'nj'; summary:{pairCount:number;meanCosine:number;topPairs:Array<{i:number;j:number;score:number}>;matrixPreview:number[][]}};
type ModelChoice = 'e5'|'minilm';
type LinkageChoice = 'average'|'complete'|'nj';
const MAX_CSV_BYTES=8*1024*1024;
const colors={border:'#302744',text:'#f8fafc',muted:'#aab0c3',panel:'#101527',accent:'#aa8ffd'};

function Action({label,onPress,disabled=false,secondary=false,testID}:{label:string;onPress:()=>void;disabled?:boolean;secondary?:boolean;testID?:string}){
  return <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button,secondary?styles.secondary:styles.primary,disabled&&{opacity:.45}]}>
    <Text style={[styles.buttonText,secondary&&{color:'#ddd2ff'}]}>{label}</Text>
  </Pressable>;
}

export default function HomeScreen(){
  const {width}=useWindowDimensions();
  const wide=width>=1050;
  const [csv,setCsv]=useState(SAMPLE_CSV);
  const [fileName,setFileName]=useState('Example: AI research topics');
  const [result,setResult]=useState<Analysis|null>(null);
  const [mode,setMode]=useState<TreeMode>('rooted');
  const [model,setModel]=useState<ModelChoice>('e5');
  const [linkage,setLinkage]=useState<LinkageChoice>('average');
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('Ready. Load a CSV or use the sample dataset.');
  const [percent,setPercent]=useState(0);
  const workerRef=useRef<Worker|null>(null);
  const jobRef=useRef(0);
  const wordsRef=useRef<{words:string[];duplicates:number}|null>(null);

  const stop=useCallback(()=>{
    jobRef.current+=1;
    workerRef.current?.terminate();
    workerRef.current=null;
    setBusy(false);
    setPercent(0);
  },[]);
  useEffect(()=>()=>{
    workerRef.current?.terminate();
    workerRef.current=null;
  },[]);

  const setInput=(value:string)=>{
    setCsv(value);setResult(null);setStatus('Input updated. Run analysis to rebuild the tree.');
  };
  const loadFile=async()=>{
    if(Platform.OS!=='web' || typeof document==='undefined'){
      setStatus('CSV file import is currently supported in browsers.');return;
    }
    const picker=document.createElement('input');
    picker.type='file';picker.accept='.csv,text/csv,text/plain';
    picker.onchange=async()=>{
      const file=picker.files?.[0];if(!file)return;
      try{
        if(file.size>MAX_CSV_BYTES)throw new Error('CSV exceeds 1 MB.');
        const bytes=await file.arrayBuffer();
        let value:string;
        try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
        catch{value=new TextDecoder('shift_jis',{fatal:true}).decode(bytes);}
        setInput(value);setFileName(file.name);setStatus(`Loaded ${file.name}`);
      }catch(error){setStatus(error instanceof Error?error.message:String(error));}
    };
    picker.click();
  };
  const analyze=()=>{
    if(busy)return;
    let parsed:ReturnType<typeof extractWords>;
    try{parsed=extractWords(csv,{maxWords:MAX_TERMS});
      if(linkage==='nj'&&parsed.words.length>NJ_LIMIT)throw new Error(`Neighbor Joining supports at most ${NJ_LIMIT} terms. Select Average or Complete for larger sets.`);
    }
    catch(error){setStatus(error instanceof Error?error.message:String(error));return;}
    jobRef.current += 1;
    setResult(null);setPercent(0);setBusy(true);setStatus('Loading the multilingual embedding model…');
    wordsRef.current=parsed;
    const jobId=jobRef.current;
    try{
      const worker=workerRef.current ?? createEmbeddingWorker();workerRef.current=worker;
      worker.onmessage=(event:MessageEvent<WorkerReply>)=>{
        const data=event.data;
        if(data.jobId!==jobRef.current)return;
        if(data.type==='model-progress'){
          setPercent(Math.min(10,Math.max(0,data.progress*.1)));
          setStatus(`Downloading model assets: ${data.file||'model'} (${Math.round(data.progress)}%)`);
        } else if(data.type==='status'){
          setStatus(data.text);
          const ratio=data.total?(data.done||0)/data.total:0;
          const ranges={loading:[0,10],embedding:[10,75],distance:[75,90],cluster:[90,100]};
          const [start,end]=ranges[data.phase];
          setPercent(start+(end-start)*ratio);
        } else if(data.type==='error'){
          setStatus(`Error: ${data.message}`);setBusy(false);
        } else if(data.type==='result'){
          try{
            const wordInfo=wordsRef.current;
            if(!wordInfo)throw new Error('Missing word list');
            let unrooted:TreeGraph, rooted:TreeGraph;
            if(data.linkage==='nj'){
              if(!data.embeddings || data.embeddings.length!==wordInfo.words.length)throw new Error('Invalid NJ embedding count');
              const smallMatrix=cosineMatrix(data.embeddings);
              unrooted=neighborJoining(distanceMatrix(smallMatrix),wordInfo.words);
              rooted=midpointRoot(unrooted);
            } else {
              if(!data.graph || data.graph.nodes.length!==2*wordInfo.words.length-1)throw new Error('Unexpected tree result');
              rooted=data.graph;
              unrooted=data.graph; // Radial view of the same linkage hierarchy; not an NJ tree.
            }
            setResult({words:wordInfo.words,duplicates:wordInfo.duplicates,unrooted,rooted,
              method:data.linkage,summary:data.summary});
            setMode(data.linkage==='nj'?'unrooted':'rooted');
            setStatus(`Completed: ${wordInfo.words.length.toLocaleString()} terms · ${data.summary.pairCount.toLocaleString()} comparisons.`);
            setPercent(100);
          }catch(error){setStatus(`Analysis error: ${error instanceof Error?error.message:String(error)}`);}
          finally{setBusy(false);}
        }
      };
      worker.onerror=()=>{setStatus('Worker failed: check network connectivity, browser support and console.');setBusy(false);worker.terminate();workerRef.current=null;};
      worker.postMessage({type:'embed',jobId,words:parsed.words,model,linkage});
    }catch(error){setBusy(false);setStatus(`Unable to start browser worker: ${error instanceof Error?error.message:String(error)}`);}
  };
  const pairs=result?.summary.topPairs??[];
  const fullGraph=result?(mode==='rooted'?result.rooted:result.unrooted):null;
  const visibleGraph=useMemo(()=>fullGraph?previewTree(fullGraph,128):null,[fullGraph]);
  const exportFile=(kind:'svg'|'newick'|'csv'|'pairs')=>{
    if(!result || !fullGraph)return;
    try{
      if(kind==='csv')downloadText('cosine_matrix_preview.csv',
        matrixToCsv(result.words.slice(0,MATRIX_PREVIEW),result.summary.matrixPreview),'text/csv;charset=utf-8');
      if(kind==='pairs'){
        const body=['word_a,word_b,cosine_similarity',...pairs.map(p=>
          [csvEscape(result.words[p.i]),csvEscape(result.words[p.j]),p.score.toFixed(8)].join(','))].join('\r\n')+'\r\n';
        downloadText('top_30_similar_pairs.csv',body,'text/csv;charset=utf-8');
      }
      if(kind==='newick')downloadText(`${mode}_${result.method}_tree.nwk`,
        toNewick(fullGraph,{unrooted:mode==='unrooted'}),'text/plain;charset=utf-8');
      if(kind==='svg'&&visibleGraph)downloadText(`${mode}_${result.method}_preview.svg`,
        toSvg(visibleGraph,mode),'image/svg+xml;charset=utf-8');
    }catch(error){setStatus(error instanceof Error?error.message:String(error));}
  };
  return <ScrollView style={styles.page} contentContainerStyle={styles.content}>
    <View style={styles.hero}>
      <Text style={styles.heroText}>Import word lists, compute cosine similarities locally in the browser, and compare rooted and unrooted Neighbor Joining trees.</Text>
    </View>
    <View style={[styles.columns,wide?{flexDirection:'row'}:{flexDirection:'column'}]}>
      <View style={[styles.left,wide?{width:360}:{width:'100%'}]}>
        <View style={styles.card}>
          <Text style={styles.panelTitle}><Text style={styles.number}>01  </Text>Word list</Text>
          <Text style={styles.caption}>CSV · word column or first column · 2–16,384 terms</Text>
          <Action label="↑  Choose a CSV file" secondary onPress={()=>void loadFile()} disabled={busy} testID="upload-button"/>
          <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
          <TextInput testID="csv-input" multiline editable={!busy} autoCapitalize="none" autoCorrect={false}
            value={csv} onChangeText={setInput} style={styles.csvInput} textAlignVertical="top"
            placeholder="word\nArtificial intelligence\nMachine learning" placeholderTextColor="#7f8497"/>
          <View style={styles.inline}>
            <Pressable disabled={busy} onPress={()=>{setInput(SAMPLE_CSV);setFileName('Example: AI research topics');}}>
              <Text style={styles.link}>↺  Load sample</Text>
            </Pressable>
            <Text style={styles.caption}>{csv.trim().split(/\r?\n/).length} CSV rows</Text>
          </View>
          <Text style={styles.subheading}>Embedding model</Text>
          <View style={styles.choiceRow}>
            {(['e5','minilm'] as const).map(value=><Pressable key={value} disabled={busy}
              onPress={()=>{setModel(value);setResult(null);}} style={[styles.choice,model===value&&styles.choiceSelected]}>
              <Text style={styles.choiceText}>{value==='e5'?'E5 multilingual (q8)':'MiniLM (q8)'}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.subheading}>Tree construction</Text>
          <View style={styles.choiceRow}>
            {(['average','complete','nj'] as const).map(value=><Pressable key={value} disabled={busy}
              onPress={()=>{setLinkage(value);setResult(null);}} style={[styles.choice,linkage===value&&styles.choiceSelected]}>
              <Text style={styles.choiceText}>{value==='average'?'Average':value==='complete'?'Complete':`NJ (≤${NJ_LIMIT})`}</Text>
            </Pressable>)}
          </View>
          <Action label={busy?'Analyzing…':'▶  Build semantic tree'} onPress={analyze} disabled={busy} testID="analyze-button"/>
          {busy&&<Action label="Cancel analysis" onPress={()=>{stop();setStatus('Analysis cancelled.');}} secondary/>}
          {busy&&<View style={styles.track}><View style={[styles.fill,{width:`${percent}%` as `${number}%`}]}/></View>}
          <Text testID="status-text" accessibilityRole="text" style={styles.status}>{busy?'◉':'●'}  {status}</Text>
        </View>
      </View>
      <View style={styles.right}>
        <View style={styles.card}>
          <View style={styles.between}>
            <Text style={styles.panelTitle}><Text style={styles.number}>02  </Text>Semantic tree</Text>
            <Text style={styles.caption}>{result?.method==='nj'?(mode==='rooted'?'MIDPOINT-ROOTED':'NEIGHBOR JOINING'):(result?`${result.method.toUpperCase()} LINKAGE`:'AVERAGE LINKAGE')}</Text>
          </View>
          <View style={styles.inline}>
            <Action label="Unrooted" secondary={mode!=='unrooted'} disabled={!result} onPress={()=>setMode('unrooted')}/>
            <Action label="Rooted" secondary={mode!=='rooted'} disabled={!result} onPress={()=>setMode('rooted')}/>
          </View>
          <View style={styles.treeArea}>
            {visibleGraph?<TreeView graph={visibleGraph} mode={mode}/>:<View style={styles.placeholder}>
              <Text style={styles.placeholderMark}>◇ ── ◇</Text>
              <Text style={styles.placeholderTitle}>Your semantic tree appears here</Text>
              <Text style={styles.caption}>Run an analysis to display a rooted or unrooted tree.</Text>
            </View>}
          </View>
          {!!result&&result.words.length>128&&<Text style={styles.caption}>Preview capped at 128 visible groups. Newick contains all {result.words.length.toLocaleString()} terms; SVG exports this preview.</Text>}
          <View style={styles.inline}>
            <Action label="↓ SVG preview" secondary disabled={!result} onPress={()=>exportFile('svg')}/>
            <Action label="↓ Newick" secondary disabled={!result} onPress={()=>exportFile('newick')}/>
            <Action label="↓ Matrix sample CSV" secondary disabled={!result} onPress={()=>exportFile('csv')}/>
            <Action label="↓ Top pairs CSV" secondary disabled={!result} onPress={()=>exportFile('pairs')}/>
          </View>
          {!!result?.duplicates&&<Text style={styles.warning}>Excluded {result.duplicates} duplicate word(s).</Text>}
          {!!result?.unrooted.clippedBranches&&<Text style={styles.warning}>Clamped {result.unrooted.clippedBranches} negative NJ branch length(s) to zero.</Text>}
        </View>
        <View style={styles.card}>
          <Text style={styles.panelTitle}><Text style={styles.number}>03  </Text>Cosine similarity</Text>
          {!result?<Text style={styles.caption}>Similarity scores and nearest neighbors appear after analysis.</Text>:<>
            <View style={styles.stats}>
              <View><Text style={styles.bigMetric}>{result.words.length.toLocaleString()}</Text><Text style={styles.caption}>TERMS</Text></View>
              <View><Text style={styles.bigMetric}>{result.summary.pairCount.toLocaleString()}</Text><Text style={styles.caption}>PAIRS</Text></View>
              <View><Text style={styles.bigMetric}>{result.summary.meanCosine.toFixed(3)}</Text><Text style={styles.caption}>MEAN COSINE</Text></View>
            </View>
            <Text style={styles.subheading}>Top 5 closest pairs</Text>
            {pairs.slice(0,5).map(pair=><View key={`${pair.i}-${pair.j}`} style={styles.pair}>
              <Text style={styles.pairName} numberOfLines={1}>{result.words[pair.i]} / {result.words[pair.j]}</Text>
              <Text style={styles.pairScore}>{pair.score.toFixed(4)}</Text>
            </View>)}
            <Text style={[styles.subheading,{marginTop:20}]}>Similarity matrix (first 24 terms, or all if fewer)</Text>
            <ScrollView horizontal>
              <View>
                <View style={styles.matrixRow}><Text style={styles.matrixHeader}>TERM</Text>{result.words.slice(0,MATRIX_PREVIEW).map((w,j)=><Text key={j} numberOfLines={1} style={styles.matrixHeader}>{w}</Text>)}</View>
                {result.words.slice(0,MATRIX_PREVIEW).map((w,i)=><View key={i} style={styles.matrixRow}>
                  <Text style={styles.matrixHeader} numberOfLines={1}>{w}</Text>
                  {result.summary.matrixPreview[i].map((v,j)=><Text key={j} style={[styles.matrixCell,{backgroundColor:i===j?'#30224b':'#1c233b'}]}>{v.toFixed(3)}</Text>)}
                </View>)}
              </View>
            </ScrollView>
          </>}
        </View>
      </View>
    </View>
    <Text style={styles.footer}>LOCAL INFERENCE • NO BACKEND • APACHE-2.0 • EXPO / REACT NATIVE WEB</Text>
  </ScrollView>;
}
const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:'#080c17'},content:{paddingHorizontal:20,paddingBottom:45,maxWidth:1510,width:'100%',alignSelf:'center'},
  hero:{paddingTop:44,paddingBottom:30,gap:9},kicker:{color:'#c2a5ff',letterSpacing:2,fontSize:11,fontWeight:'800'},
  heroTitle:{color:'#f9fafb',fontSize:35,fontWeight:'900',letterSpacing:-.8},heroText:{color:'#b0b6c9',maxWidth:760,fontSize:15,lineHeight:24},
  columns:{gap:18,alignItems:'flex-start'},left:{gap:18},right:{flex:1,minWidth:0,gap:18,width:'100%'},
  card:{backgroundColor:colors.panel,borderColor:colors.border,borderWidth:1,borderRadius:16,padding:19,gap:12},
  panelTitle:{fontSize:17,fontWeight:'900',color:colors.text},number:{color:'#c4a5ff',fontSize:12,fontWeight:'900'},caption:{color:colors.muted,fontSize:12,lineHeight:18},
  button:{borderRadius:10,paddingVertical:13,paddingHorizontal:15,alignItems:'center',justifyContent:'center',minHeight:44},
  primary:{backgroundColor:'#9d7af5'},secondary:{backgroundColor:'#1b2035',borderColor:'#4a3d6d',borderWidth:1},buttonText:{color:'#100a22',fontSize:13,fontWeight:'900'},
  fileName:{color:'#bcb3d1',fontSize:11},csvInput:{minHeight:255,backgroundColor:'#080d1b',borderColor:'#352d4b',borderWidth:1,borderRadius:10,
    color:'#f0ecff',padding:15,fontFamily:Platform.OS==='web'?'monospace':undefined,fontSize:13,lineHeight:21},
  inline:{flexDirection:'row',gap:10,alignItems:'center',flexWrap:'wrap',justifyContent:'space-between'},
  choiceRow:{flexDirection:'row',flexWrap:'wrap',gap:7},choice:{paddingHorizontal:10,paddingVertical:9,backgroundColor:'#20243b',borderRadius:8,borderWidth:1,borderColor:'#403453'},
  choiceSelected:{backgroundColor:'#7554b9',borderColor:'#c0a3ff'},choiceText:{color:'#f7f1ff',fontWeight:'700',fontSize:11},
  link:{color:'#ddcbff',textDecorationLine:'underline',fontWeight:'700',fontSize:12},status:{fontSize:12,color:'#c2c6d3',lineHeight:19},
  track:{height:5,backgroundColor:'#2c2a42',borderRadius:10,overflow:'hidden'},fill:{backgroundColor:'#f7d97e',height:'100%'},
  note:{padding:18,backgroundColor:'#15182a',borderWidth:1,borderColor:'#353049',borderRadius:16,gap:10},noteTitle:{fontSize:13,fontWeight:'900',color:'#f9e7ab'},
  noteText:{color:'#b1b3c2',fontSize:12,lineHeight:20},between:{flexDirection:'row',justifyContent:'space-between',gap:10,flexWrap:'wrap',alignItems:'center'},
  treeArea:{backgroundColor:'#0b1020',borderWidth:1,borderColor:'#292843',borderRadius:12,overflow:'hidden',minHeight:400},
  placeholder:{minHeight:400,justifyContent:'center',alignItems:'center',gap:14,padding:18},placeholderMark:{fontSize:44,color:'#9077cb'},
  placeholderTitle:{color:'#f1eafc',fontSize:17,fontWeight:'800',textAlign:'center'},warning:{color:'#fbd38d',fontSize:12},
  stats:{flexDirection:'row',gap:36,flexWrap:'wrap',paddingVertical:8},bigMetric:{fontSize:28,color:'#e7d8ff',fontWeight:'900'},
  subheading:{color:'#e8e8f3',fontSize:13,fontWeight:'800'},pair:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,borderBottomWidth:1,borderColor:'#28273a',paddingVertical:7},
  pairName:{fontSize:12,color:'#d6d8e3',flexShrink:1},pairScore:{color:'#f6d886',fontSize:12,fontWeight:'800'},
  matrixRow:{flexDirection:'row'},matrixHeader:{width:132,padding:10,color:'#ece9f5',fontSize:11,fontWeight:'700',borderBottomWidth:1,borderRightWidth:1,borderColor:'#272c43'},
  matrixCell:{width:132,padding:10,fontSize:12,textAlign:'center',color:'#f1edfa',borderWidth:.5,borderColor:'#31304d'},
  footer:{textAlign:'center',color:'#86859a',fontSize:10,letterSpacing:1.5,paddingTop:30},
});
