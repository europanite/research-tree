import {parsePapersCsv} from '../lib/papers';

test('reads multi-line abstracts, groups, years and titles',()=>{
  const papers=parsePapersCsv('title,abstract,year,group\n"Paper A","Hello,\nworld",2024,Security;XAI\nPaper B,Another abstract,2025,XAI\n');
  expect(papers).toHaveLength(2);
  expect(papers[0].abstract).toBe('');
  expect(papers[0].abstract_source).toBe('');
  expect(papers[0].groups).toEqual(['Security','XAI']);
  expect(papers[1].year).toBe(2025);
});

test('rejects missing headers and invalid years',()=>{
  expect(()=>parsePapersCsv('text\nOne\nTwo')).toThrow('title');
  expect(()=>parsePapersCsv('title,year\nOne,202X\nTwo,2024')).toThrow('invalid year');
});

test('parses more than 3000 papers without a fixed application cap',()=>{
  const csv='title\n'+Array.from({length:3001},(_,i)=>`P${i}`).join('\n');
  expect(parsePapersCsv(csv)).toHaveLength(3001);
});
