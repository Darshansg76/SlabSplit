import test from 'node:test';
import assert from 'node:assert/strict';
import { createOccupantInvitation, verifyOccupantInvitation } from '../lib/invitations.js';

process.env.SESSION_SECRET='invitation-test-secret-not-used-by-the-app';
const occupant={occupant_id:12,email:'Member@example.test'};
test('an invitation is bound to its occupant, email, signature, and expiry',()=>{
  const token=createOccupantInvitation(occupant,{now:1000,ttlMs:1000});
  assert.equal(verifyOccupantInvitation(token,occupant,{now:1500}).id,'12');
  assert.throws(()=>verifyOccupantInvitation(token,{...occupant,occupant_id:13},{now:1500}));
  assert.throws(()=>verifyOccupantInvitation(token,{...occupant,email:'other@example.test'},{now:1500}));
  assert.throws(()=>verifyOccupantInvitation(token,occupant,{now:2000}));
  assert.throws(()=>verifyOccupantInvitation('altered'+token,occupant,{now:1500}));
  assert.throws(()=>verifyOccupantInvitation(token+'.extra',occupant,{now:1500}));
  assert.throws(()=>verifyOccupantInvitation('',occupant));
  const privateSecret=process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET='replace-with-the-public-example-secret';
    assert.throws(()=>createOccupantInvitation(occupant));
  } finally {process.env.SESSION_SECRET=privateSecret;}
});
