import React from 'react';
import {View,Pressable,Text} from 'react-native';
import {useState} from 'react';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {StatusBar} from 'expo-status-bar';
import SettingsBar from './components/SettingsBar';
import HomeScreen from './screens/HomeScreen';
import PaperScreen from './screens/PaperScreen';

const Stack=createNativeStackNavigator();
export default function App(){
  const [workspace,setWorkspace]=useState<'terms'|'papers'>('terms');
  return <SafeAreaProvider>
    <StatusBar style="light" backgroundColor="#06080f" />
    <NavigationContainer>
      <SettingsBar />
      <View style={{backgroundColor:'#0a0e1d',paddingHorizontal:18,paddingVertical:8,flexDirection:'row',gap:10}}>
        {(['terms','papers'] as const).map(value=><Pressable key={value} accessibilityRole="button"
          testID={`tab-${value}`} onPress={()=>setWorkspace(value)}
          style={{backgroundColor:workspace===value?'#7153a9':'#1c2035',borderRadius:8,paddingVertical:9,paddingHorizontal:18}}>
          <Text style={{color:'#f8f5ff',fontSize:12,fontWeight:'800'}}>{value==='terms'?'Word tree (browser only)':'Paper tree (local backend)'}</Text>
        </Pressable>)}
      </View>
      <View style={{flex:1}}>
        <Stack.Navigator screenOptions={{headerShown:false}}>
          <Stack.Screen name="Home" children={()=>workspace==='terms'?<HomeScreen/>:<PaperScreen/>}/>
        </Stack.Navigator>
      </View>
    </NavigationContainer>
  </SafeAreaProvider>;
}
