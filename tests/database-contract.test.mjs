import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('original PDF and SQL command content is unchanged (SQL checkout line endings are ignored)',async()=>{
  const manifest=JSON.parse(await readFile(new URL('./fixtures/protected-database-hashes.json',import.meta.url),'utf8'));
  for(const [file,expected] of Object.entries(manifest)) {
    const bytes=await readFile(new URL('../'+file.replaceAll('\\','/'),import.meta.url));
    const content=expected.lfSha256?bytes.toString('utf8').replaceAll('\r\n','\n'):bytes;
    assert.equal(createHash('sha256').update(content).digest('hex'),expected.lfSha256||expected.rawSha256,`${file} is protected by the fixed database requirement`);
  }
});
