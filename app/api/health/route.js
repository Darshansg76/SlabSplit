import { createHash } from 'node:crypto';
import { query } from '../../../lib/db';

export const runtime='nodejs';
export async function GET() {
  const instance=createHash('sha256').update(process.cwd().toLowerCase()).digest('hex').slice(0,16);
  try {
    await query('SELECT 1');
    return Response.json({application:'SlabSplit',instance,status:'ready'},{headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({application:'SlabSplit',instance,status:'database unavailable'},{status:503});
  }
}
