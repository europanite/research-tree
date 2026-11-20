import React from 'react';
import {render,screen} from '@testing-library/react-native';
import HomeScreen from '../screens/HomeScreen';
test('home screen has CSV input, analysis controls, and sample data',()=>{
  render(<HomeScreen/>);
  expect(screen.getByTestId('csv-input')).toBeTruthy();
  expect(screen.getByTestId('analyze-button')).toBeTruthy();
  expect(screen.getByTestId('upload-button')).toBeTruthy();
});
