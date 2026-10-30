import { NextResponse } from 'next/server';
import { sessionFromRequest } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { householdAccess } from '../../../lib/logic';

export const runtime = 'nodejs';
async function embed(text) {
  const base=process.env.EMBEDDING_SERVICE_URL;
  if(!base) throw new Error('EMBEDDING_SERVICE_URL is not configured');
  const response=await fetch(`${base}/embed`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text}),signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error('Embedding service unavailable');
  const data=await response.json();
  if(!Array.isArray(data.embedding)||data.embedding.length!==384) throw new Error('Embedding service returned an invalid vector');
  return `[${data.embedding.join(',')}]`;
}
export async function POST(request) {
  try {
    const user=await sessionFromRequest(request);
    if(!user) return NextResponse.json({error:'Sign in required'},{status:401});
    const { action,source_type,source_id,household_id,text }=await request.json();
    const h=Number(household_id);
    if(!await householdAccess(user,h)) return NextResponse.json({error:'Household access denied'},{status:403});
    if(action==='index') {
      if(user.role!=='admin') return NextResponse.json({error:'Admin role required'},{status:403});
      if(!['expense','receipt'].includes(source_type)) throw new Error('Unsupported document type');
      let source;
      if(source_type==='expense') source=(await query('SELECT description AS content FROM expense WHERE expense_id=$1 AND household_id=$2',[source_id,h])).rows[0];
      else source=(await query(`SELECT COALESCE(r.ocr_text,'') AS content FROM receipt r LEFT JOIN expense e ON e.expense_id=r.expense_id
        LEFT JOIN bill b ON b.bill_id=r.bill_id LEFT JOIN bill_cycle c ON c.cycle_id=b.cycle_id
        WHERE r.receipt_id=$1 AND (e.household_id=$2 OR c.household_id=$2)`,[source_id,h])).rows[0];
      if(!source?.content?.trim()) throw new Error('Document has no text to index');
      const vector=await embed(source.content);
      await query(`INSERT INTO doc_embedding(source_type,source_id,content,embedding)
        VALUES($1,$2,$3,$4::vector) ON CONFLICT(source_type,source_id) DO UPDATE
        SET content=EXCLUDED.content,embedding=EXCLUDED.embedding,created_on=now()`,[source_type,source_id,source.content,vector]);
      return NextResponse.json({indexed:true});
    }
    const q=String(text||'').trim();
    if(!q||q.length>500) throw new Error('Enter a search query up to 500 characters');
    if(action==='semantic') {
      const vector=await embed(q);
      const result=await query(`SELECT d.source_type,d.source_id,d.content,ROUND((1-(d.embedding <=> $1::vector))::NUMERIC,3) AS similarity
        FROM doc_embedding d WHERE
        (d.source_type='expense' AND EXISTS(SELECT 1 FROM expense e WHERE e.expense_id=d.source_id AND e.household_id=$2)) OR
        (d.source_type='receipt' AND EXISTS(SELECT 1 FROM receipt r LEFT JOIN expense e ON e.expense_id=r.expense_id LEFT JOIN bill b ON b.bill_id=r.bill_id LEFT JOIN bill_cycle c ON c.cycle_id=b.cycle_id WHERE r.receipt_id=d.source_id AND (e.household_id=$2 OR c.household_id=$2)))
        ORDER BY d.embedding <=> $1::vector LIMIT 10`,[vector,h]);
      return NextResponse.json({results:result.rows});
    }
    if(action==='text') {
      const result=await query(`SELECT expense_id AS source_id,'expense' AS source_type,description AS content,
        ts_rank(description_tsv,plainto_tsquery('english',$1)) AS rank
        FROM expense WHERE household_id=$2 AND description_tsv @@ plainto_tsquery('english',$1)
        ORDER BY rank DESC LIMIT 10`,[q,h]);
      return NextResponse.json({results:result.rows});
    }
    throw new Error('Unknown search action');
  } catch(error) { return NextResponse.json({error:error.message},{status:400}); }
}
