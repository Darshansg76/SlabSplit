import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../lib/auth';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const runtime = 'nodejs';
export async function POST(request) {
  const user=await sessionFromRequest(request);
  if(!user || user.role!=='admin') return NextResponse.json({error:'Admin role required'},{status:403});
  const form=await request.formData();
  const file=form.get('file');
  if(!file || typeof file.arrayBuffer!=='function') return NextResponse.json({error:'Choose a file'},{status:400});
  const types={'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png'};
  const ext=types[file.type];
  if(!ext||file.size>5*1024*1024) return NextResponse.json({error:'Use a PDF, JPEG, or PNG under 5 MB'},{status:400});
  const dir=path.join(process.cwd(),'public','uploads');
  await mkdir(dir,{recursive:true});
  const name=randomUUID()+ext;
  await writeFile(path.join(dir,name),Buffer.from(await file.arrayBuffer()),{flag:'wx'});
  return NextResponse.json({file_url:`/uploads/${name}`});
}
