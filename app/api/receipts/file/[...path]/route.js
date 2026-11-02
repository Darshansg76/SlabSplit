import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../../../lib/auth';
import { query } from '../../../../../lib/db';
import { householdAccess } from '../../../../../lib/logic';
import { readReceiptFile, receiptFilename } from '../../../../../lib/receipts';

export const runtime='nodejs';
export async function GET(request,{params}) {
  const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
  try {
    const user=await sessionFromRequest(request);
    if(!user) return NextResponse.json({error:'Sign in required'},{status:401,headers});
    const segments=(await params).path;
    if(!segments||segments.length!==1) return NextResponse.json({error:'Receipt not found'},{status:404,headers});
    const name=receiptFilename(`/uploads/${segments[0]}`);
    if(!name) return NextResponse.json({error:'Receipt not found'},{status:404,headers});
    const records=(await query(`SELECT e.household_id AS expense_household,c.household_id AS bill_household
      FROM receipt r LEFT JOIN expense e USING(expense_id) LEFT JOIN bill b USING(bill_id)
      LEFT JOIN bill_cycle c ON c.cycle_id=b.cycle_id WHERE r.file_url=$1`,[`/uploads/${name}`])).rows;
    if(!records.length) return NextResponse.json({error:'Receipt not found'},{status:404,headers});
    for(const record of records) {
      const households=[record.expense_household,record.bill_household].filter(Boolean);
      if(!households.length) return NextResponse.json({error:'Receipt not found'},{status:404,headers});
      for(const household of households) if(!await householdAccess(user,Number(household)))
        return NextResponse.json({error:'Household access denied'},{status:403,headers});
    }
    const file=await readReceiptFile(name);
    return new Response(new Uint8Array(file.bytes),{headers:{...headers,'Content-Type':file.mime,'Content-Disposition':`attachment; filename="${name}"`}});
  } catch {
    return NextResponse.json({error:'Receipt unavailable'},{status:404,headers});
  }
}
