import {extractWords,parseCsv,matrixToCsv} from '../lib/csv';
test('handles BOM, multi-line quoted CSV and escaped quotes',()=>{
  expect(parseCsv('\uFEFFword,note\r\n"a,b","say ""hi"""\r\nfoo,"two\nlines"\r\n')).toEqual([
    ['word','note'],['a,b','say "hi"'],['foo','two\nlines']]);
});
test('uses the word column and removes Unicode-normalized duplicates',()=>{
  const r=extractWords('index,word\n1,Deep learning\n2,Ｄｅｅｐ ｌｅａｒｎｉｎｇ\n3,Machine learning\n');
  expect(r.words).toEqual(['Deep learning','Machine learning']);expect(r.duplicates).toBe(1);
});
test('rejects invalid or too many unique entries',()=>{
  expect(()=>extractWords('word\nonly')).toThrow();
  expect(()=>extractWords('one\ntwo\nthree',{maxWords:2})).toThrow();
});
test('exports safe, quoted CSV',()=>{
  expect(matrixToCsv(['=1+2','a,b'],[[1,.3],[.3,1]])).toContain("'\u003d1+2");
});
