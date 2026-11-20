import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,extractWords,matrixToCsv} from '../frontend/app/lib/csv.js';

test('parses BOM, CRLF, escaped quotes, commas and newlines', () => {
  const input='\uFEFFword,comment\r\n"hello, world","a""b"\r\n"two\nlines",third\r\n';
  assert.deepEqual(parseCsv(input),[['word','comment'],['hello, world','a"b'],['two\nlines','third']]);
});
test('extracts named word column, removes normalization duplicates', () => {
  assert.deepEqual(extractWords('id,word\n1,機械学習\n2,ニューラルネットワーク\n3,機械学習\n4,深層学習').words,
    ['機械学習','ニューラルネットワーク','深層学習']);
  assert.equal(extractWords('WORD\nＡＩ\nai\nML').duplicates,1);
});
test('rejects wrong and excess data', () => {
  assert.throws(()=>parseCsv('word\n"bad'),/Unclosed/);
  assert.throws(()=>extractWords('word\nfoo'),/2件/);
  assert.throws(()=>extractWords('word\na\nb\nc',{maxWords:2}),/最大2/);
});
test('exports formula-safe CSV with escaped column names', () => {
  const csv=matrixToCsv(['=CMD','hello,world'],[[1,0.1],[0.1,1]]);
  assert.match(csv,/"'=CMD"/);
  assert.match(csv,/"hello,world"/);
  assert.equal(parseCsv(csv).length,3);
  assert.equal(parseCsv(matrixToCsv(['A','B'],[[1,-0.3],[-0.3,1]]))[1][2],'-0.3');
});
