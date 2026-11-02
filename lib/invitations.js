import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function signature(body) {
  const secret=process.env.SESSION_SECRET;
  if(!secret||secret.length<32||secret.startsWith('replace-')) throw new Error('SESSION_SECRET must be a private value of at least 32 characters');
  return createHmac('sha256',secret).update(`occupant-invitation:${body}`).digest('hex');
}

export function createOccupantInvitation(occupant,{now=Date.now(),ttlMs=86400000}={}) {
  const body=Buffer.from(JSON.stringify({purpose:'occupant-invitation',id:String(occupant.occupant_id),
    email:occupant.email.toLowerCase(),exp:now+ttlMs,nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return `${body}.${signature(body)}`;
}

export function verifyOccupantInvitation(token,occupant,{now=Date.now()}={}) {
  const fail=()=>{throw new Error('A valid, unexpired invitation from your admin is required to link this occupant.');};
  if(typeof token!=='string'||token.length>4096) return fail();
  const parts=token.split('.');
  if(parts.length!==2||!/^[a-f0-9]{64}$/.test(parts[1])) return fail();
  if(!timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signature(parts[0])))) return fail();
  let payload;
  try { payload=JSON.parse(Buffer.from(parts[0],'base64url').toString()); } catch { return fail(); }
  if(payload.purpose!=='occupant-invitation'||payload.id!==String(occupant.occupant_id)||
    payload.email!==occupant.email.toLowerCase()||!Number.isSafeInteger(payload.exp)||payload.exp<=now) return fail();
  return payload;
}
