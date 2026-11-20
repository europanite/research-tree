import React from 'react';
import {Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {REPO_URL} from '../screens/HomeScreenUtil';

export default function SettingsBar() {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="link" accessibilityLabel="Open Semantic Tree GitHub repository"
          onPress={() => void Linking.openURL(REPO_URL)} style={styles.brand}>
          <Text style={styles.logo}>◈</Text>
          <Text style={styles.title}>SEMANTIC <Text style={styles.highlight}>TREE</Text></Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
const styles=StyleSheet.create({
  safe:{backgroundColor:'#06080f'},
  bar:{minHeight:62,paddingHorizontal:23,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:12,borderBottomWidth:1,borderColor:'#2b2342'},
  brand:{flexDirection:'row',alignItems:'center',gap:10,flexShrink:1},
  logo:{fontSize:26,color:'#fde68a'},title:{fontSize:16,color:'#f9fafb',fontWeight:'900',letterSpacing:1.5},
  highlight:{color:'#b9a1fc'},
});
