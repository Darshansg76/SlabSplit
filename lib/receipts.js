import { readFile, realpath, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const MAX_RECEIPT_BYTES=5*1024*1024;
const filenamePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}\.(pdf|png|jpe?g)$/i;
export function receiptFilename(url) {
  if(typeof url!=='string'||!url.startsWith('/uploads/')) return null;
  const name=url.slice('/uploads/'.length);
  return filenamePattern.test(name)?name:null;
}
export function receiptType(bytes) {
  if(bytes.length>=5&&bytes.subarray(0,5).toString()==='%PDF-') return {extension:'.pdf',mime:'application/pdf'};
  if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {extension:'.png',mime:'image/png'};
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255) return {extension:'.jpg',mime:'image/jpeg'};
  return null;
}
export function privateReceiptDirectory() {
  const root=path.resolve(process.env.SLABSPLIT_RECEIPT_DIR||path.join(process.cwd(),'storage','receipts'));
  const publicRoot=path.resolve('public');
  if(root===publicRoot||root.startsWith(publicRoot+path.sep)) throw new Error('Receipt storage must be outside the public directory.');
  return root;
}
export async function saveReceiptFile(bytes) {
  const type=receiptType(bytes);
  if(!type||!bytes.length||bytes.length>MAX_RECEIPT_BYTES) throw new Error('Use a valid PDF, JPEG, or PNG under 5 MB.');
  const root=privateReceiptDirectory();
  await mkdir(root,{recursive:true});
  const name=randomUUID()+type.extension;
  await writeFile(path.join(root,name),bytes,{flag:'wx'});
  return `/uploads/${name}`;
}
export async function readReceiptFile(name) {
  if(!filenamePattern.test(name)) throw new Error('Receipt file not found.');
  // Startup imports old public files into private storage without changing URLs.
  // There is deliberately no public-directory fallback: encoded URLs must never
  // be able to bypass the authenticated route via Next.js static file serving.
  const roots=[privateReceiptDirectory()];
  for(const root of roots) {
    try {
      const actualRoot=await realpath(root),file=await realpath(path.join(root,name));
      if(!file.startsWith(actualRoot+path.sep)) throw new Error('Receipt path is outside storage.');
      const bytes=await readFile(file);
      const type=receiptType(bytes);
      if(!type) throw new Error('Receipt file has an unsupported format.');
      return {bytes,mime:type.mime};
    } catch(error) {
      if(error.code==='ENOENT') continue;
      throw error;
    }
  }
  throw new Error('Receipt file not found.');
}
