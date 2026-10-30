import { NextResponse } from 'next/server';
import { hashPassword, makeSession, sessionCookie } from '../../../lib/auth';
import { transaction } from '../../../lib/db';

export const runtime = 'nodejs';

const USERNAME=/^[A-Za-z0-9_]{3,60}$/;
const EMAIL=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request) {
  try {
    const body=await request.json();
    const name=String(body.name||'').trim();
    const username=String(body.username||'').trim();
    const email=String(body.email||'').trim().toLowerCase();
    const password=String(body.password||'');
    if(name.length<2||name.length>120) throw new Error('Enter your full name');
    if(!USERNAME.test(username)) throw new Error('Username must be 3-60 letters, numbers or underscores');
    if(!EMAIL.test(email)||email.length>160) throw new Error('Enter a valid email address');
    if(password.length<8) throw new Error('Password must be at least 8 characters');

    const created=await transaction(null,async client=>{
      // Self-registration is always a member. The role is never taken from the
      // request body, so nobody can sign themselves up as an admin.
      const role=(await client.query("SELECT role_id FROM role WHERE name='member'")).rows[0];
      if(!role) throw new Error('Member role is missing. Load database/schema.sql first.');
      // If an admin already added this person as an occupant, claim that row instead
      // of creating a duplicate; otherwise register them as a new occupant.
      let occupant=(await client.query(`SELECT o.occupant_id FROM occupant o
        LEFT JOIN app_user u ON u.occupant_id=o.occupant_id
        WHERE lower(o.email)=$1 AND u.user_id IS NULL`,[email])).rows[0];
      if(!occupant) occupant=(await client.query(
        'INSERT INTO occupant(name,email) VALUES($1,$2) RETURNING occupant_id',[name,email])).rows[0];
      return (await client.query(`INSERT INTO app_user(occupant_id,role_id,username,email,password_hash)
        VALUES($1,$2,$3,$4,$5) RETURNING user_id,username,occupant_id`,
        [occupant.occupant_id,role.role_id,username,email,hashPassword(password)])).rows[0];
    });

    const response=NextResponse.json({user:{...created,role:'member'}});
    response.cookies.set(sessionCookie(makeSession(created)));
    return response;
  } catch(error) {
    const message=error.code==='23505'
      ? 'That username or email is already registered'
      : error.message;
    return NextResponse.json({error:message},{status:400});
  }
}
