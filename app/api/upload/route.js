import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../lib/auth';
import { saveReceiptFile, MAX_RECEIPT_BYTES } from '../../../lib/receipts';

export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const user=await sessionFromRequest(request);
    if(!user || user.role!=='admin') return NextResponse.json({error:'Admin role required'},{status:403});
    const form=await request.formData();
    const file=form.get('file');
    if(!file || typeof file.arrayBuffer!=='function') return NextResponse.json({error:'Choose a file'},{status:400});
    if(file.size>MAX_RECEIPT_BYTES) return NextResponse.json({error:'Use a PDF, JPEG, or PNG under 5 MB'},{status:400});
    const file_url=await saveReceiptFile(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({file_url});
  } catch {
    // A malformed multipart body or an unwritable uploads folder must still answer
    // JSON: the browser form only knows how to read {error}, not an HTML 500 page.
    return NextResponse.json({error:'Upload failed. Check the file and try again.'},{status:400});
  }
}
