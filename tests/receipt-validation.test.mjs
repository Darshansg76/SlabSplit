import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptFilename, receiptType } from '../lib/receipts.js';

test('receipt paths reject traversal, external URLs, and extra path segments',()=>{
  assert.equal(receiptFilename('/uploads/example-file.png'),'example-file.png');
  for(const value of ['/uploads/../secret.pdf','/uploads/%2e%2e.pdf','/uploads/nested/file.pdf','https://host/uploads/a.pdf','/uploads/a.html','/uploads/a.pdf?b=1']) assert.equal(receiptFilename(value),null);
});
test('receipt format is detected from bytes rather than the browser MIME label',()=>{
  assert.equal(receiptType(Buffer.from('%PDF-1.7')).mime,'application/pdf');
  assert.equal(receiptType(Buffer.from([137,80,78,71,13,10,26,10])).mime,'image/png');
  assert.equal(receiptType(Buffer.from([255,216,255,224])).mime,'image/jpeg');
  assert.equal(receiptType(Buffer.from('<script>not a PDF</script>')),null);
});
