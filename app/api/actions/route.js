import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../lib/auth';
import { householdAccess, performAction } from '../../../lib/logic';

export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const user=await sessionFromRequest(request);
    if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
    const input=await request.json();
    if(user.role==='member' && input.action==='create_payment') {
      if(!input.household_id || !await householdAccess(user,Number(input.household_id)))
        return NextResponse.json({error:'Household access denied'},{status:403});
    }
    return NextResponse.json({result:await performAction(user,input)});
  } catch(error) {
    const message=error.code==='23505'?'A record with these unique values already exists':
      error.code==='23503'?'This record is referenced by another record':error.message;
    return NextResponse.json({error:message},{status:400});
  }
}
