import { lstat, mkdir, rename, readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { privateReceiptDirectory, receiptFilename } from '../lib/receipts.js';

function insideProject(directory) {
  const relative=path.relative(process.cwd(),directory);
  if(relative.startsWith('..')||path.isAbsolute(relative)) throw new Error('Receipt storage must stay inside the project directory.');
}

export async function preserveLegacyReceipts() {
  const legacy=path.resolve('public/uploads'),privateRoot=privateReceiptDirectory();
  insideProject(legacy);insideProject(privateRoot);
  if(privateRoot===legacy||privateRoot.startsWith(legacy+path.sep)) throw new Error('Private receipts cannot be stored under public/uploads.');
  let info;
  try {info=await lstat(legacy);} catch(error) {if(error.code==='ENOENT') return 0;throw error;}
  if(info.isSymbolicLink()||!info.isDirectory()) throw new Error('public/uploads must be a regular directory before its receipts can be protected.');
  await mkdir(privateRoot,{recursive:true});
  // Rename the complete directory before Next.js serves public files. Nothing is
  // deleted or overwritten; nonstandard files remain preserved in this batch.
  const batch=path.join(privateRoot,`legacy-import-${randomUUID()}`);
  insideProject(batch);
  try {await rename(legacy,batch);} catch(error) {if(error.code==='ENOENT') return 0;throw error;}
  let moved=0;
  for(const entry of await readdir(batch,{withFileTypes:true})) {
    if(!entry.isFile()||!receiptFilename('/uploads/'+entry.name)) continue;
    const source=path.join(batch,entry.name),destination=path.join(privateRoot,entry.name);
    try {
      const existing=await readFile(destination);
      if(!existing.equals(await readFile(source))) throw new Error(`Two different receipt files have the same name: ${entry.name}. Both copies are preserved; resolve this before startup.`);
      // Preserve the duplicate in the private import batch as well.
    } catch(error) {
      if(error.code!=='ENOENT') throw error;
      await rename(source,destination);
    }
    moved++;
  }
  return moved;
}
