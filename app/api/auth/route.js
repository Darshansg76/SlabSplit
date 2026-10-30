import { NextResponse } from 'next/server';
import { query } from '../../../lib/db';
import { checkPassword, makeSession, sessionCookie, sessionFromRequest } from '../../../lib/auth';

export const runtime = 'nodejs';
export async function GET(request) {
  try { return NextResponse.json({ user: await sessionFromRequest(request) }); }
  catch { return NextResponse.json({ error:'Database or session configuration is unavailable' },{ status:503 }); }
}
export async function POST(request) {
  try {
    const { username, password } = await request.json();
    const { rows } = await query(`SELECT u.*,r.name AS role FROM app_user u JOIN role r USING(role_id)
      WHERE u.username=$1 AND u.is_active`,[String(username||'')]);
    const user=rows[0];
    if(!user || !checkPassword(String(password||''),user.password_hash))
      return NextResponse.json({ error:'Invalid username or password' },{ status:401 });
    const response=NextResponse.json({ user:{user_id:user.user_id,username:user.username,role:user.role,occupant_id:user.occupant_id} });
    response.cookies.set(sessionCookie(makeSession(user)));
    return response;
  } catch(error) { return NextResponse.json({ error:error.message },{ status:500 }); }
}
export async function DELETE() {
  const response=NextResponse.json({ ok:true });
  response.cookies.set({ ...sessionCookie(''),maxAge:0 });
  return response;
}
