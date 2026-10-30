import { createHmac, scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { query } from './db';

const COOKIE = 'slabsplit_session';
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}
export function checkPassword(password, stored) {
  const [kind,salt,digest] = (stored || '').split(':');
  if (kind !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest,'hex');
  const actual = scryptSync(password,salt,expected.length);
  return timingSafeEqual(actual,expected);
}
function secret() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  return process.env.SESSION_SECRET;
}
function sign(value) { return createHmac('sha256',secret()).update(value).digest('hex'); }
export function makeSession(user) {
  const body = Buffer.from(JSON.stringify({ id: String(user.user_id), exp: Date.now()+7*86400000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export async function sessionFromRequest(request) {
  const raw = request.cookies.get(COOKIE)?.value;
  if (!raw) return null;
  const [body,signature] = raw.split('.');
  if (!body || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
  if (!timingSafeEqual(Buffer.from(signature),Buffer.from(sign(body)))) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body,'base64url').toString()); } catch { return null; }
  if (payload.exp < Date.now() || typeof payload.id !== 'string' || !/^[1-9]\d{0,18}$/.test(payload.id)) return null;
  const { rows } = await query(`SELECT u.user_id,u.username,u.occupant_id,r.name AS role
    FROM app_user u JOIN role r ON r.role_id=u.role_id WHERE u.user_id=$1 AND u.is_active`, [payload.id]);
  return rows[0] || null;
}
export function sessionCookie(value) {
  return { name: COOKIE, value, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 7*86400 };
}
