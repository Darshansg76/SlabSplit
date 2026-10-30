import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../lib/auth';
import { snapshot } from '../../../lib/logic';

export const runtime = 'nodejs';
export async function GET(request) {
  try {
    const user=await sessionFromRequest(request);
    if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
    const url=new URL(request.url);
    return NextResponse.json(await snapshot(user,url.searchParams.get('household_id'),url.searchParams.get('cycle_id')));
  } catch(error) { return NextResponse.json({error:error.message},{status:400}); }
}
