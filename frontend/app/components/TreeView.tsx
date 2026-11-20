import React, {useMemo} from 'react';
import {ScrollView, Text, View} from 'react-native';
import Svg, {Circle, Line, Path, Rect, Text as SvgText} from 'react-native-svg';
import type {TreeGraph} from '../lib/phylogeny';
import {getLayout, type TreeMode} from '../lib/export';

export default function TreeView({graph,mode}:{graph:TreeGraph;mode:TreeMode}) {
  const layout=useMemo(()=>getLayout(graph,mode),[graph,mode]);
  return <ScrollView horizontal showsHorizontalScrollIndicator>
    <View style={{minHeight:layout.height}}>
      <Svg width={layout.width} height={layout.height} viewBox={layout.viewBox} accessibilityLabel={`${mode} semantic tree`}>
        <Rect x={0} y={0} width={layout.width} height={layout.height} fill="#0b1020" />
        {graph.edges.map((edge,index)=>{
          const a=layout.coords.get(edge.source),b=layout.coords.get(edge.target);
          if (!a||!b)return null;
          if(mode==='rooted'){
            const [parent,child]=a.x<=b.x?[a,b]:[b,a];
            return <Path key={index} d={`M ${parent.x} ${parent.y} V ${child.y} H ${child.x}`} fill="none" stroke="#a78bfa" strokeWidth={2}/>;
          }
          return <Line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#a78bfa" strokeWidth={2}/>;
        })}
        {graph.nodes.map(node=>{
          const p=layout.coords.get(node.id);
          if(!p)return null;
          if(node.label!==undefined){
            const left=mode==='unrooted'&&p.x<layout.width/2;
            return <React.Fragment key={node.id}>
              <Circle cx={p.x} cy={p.y} r={4.5} fill="#fde68a" />
              <SvgText x={p.x+(left?-11:11)} y={p.y+5} textAnchor={left?'end':'start'} fill="#f8fafc" fontSize={14}>
                {node.label}
              </SvgText>
            </React.Fragment>;
          }
          return <Circle key={node.id} cx={p.x} cy={p.y} r={2.5} fill={node.id===graph.root?'#fde68a':'#9b8acb'}/>;
        })}
      </Svg>
      {mode==='unrooted'&&<Text style={{fontSize:10,color:'#a3a7b8',paddingLeft:16,paddingBottom:8}}>Radial layout is schematic; branch geometry is not drawn to scale.</Text>}
    </View>
  </ScrollView>;
}
