import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSlabs, allocateCents, minimizeTransfers } from '../lib/calculation.js';

test('October demo combines three slabs and distributes exactly 1220 rupees',()=>{
  const rates=[
    {unit_from:0,unit_to:100,rate_per_unit:4,fixed_charge:60},
    {unit_from:100,unit_to:200,rate_per_unit:6,fixed_charge:0},
    {unit_from:200,unit_to:null,rate_per_unit:8,fixed_charge:0}
  ];
  const bill=calculateSlabs(220,rates);
  assert.deepEqual(bill.parts.map(x=>x.amount),[40000,60000,16000]);
  assert.equal(bill.total,122000);
  const shares=allocateCents(bill.total,[{name:'Asha',weight:31},{name:'Dev',weight:31},{name:'Mira',weight:16}]);
  assert.deepEqual(shares.map(x=>x.cents),[48487,48487,25026]);
  assert.equal(shares.reduce((s,x)=>s+x.cents,0),bill.total);
});

test('a gap in slab coverage is rejected',()=>{
  assert.throws(()=>calculateSlabs(120,[
    {unit_from:0,unit_to:100,rate_per_unit:4,fixed_charge:0},
    {unit_from:110,unit_to:null,rate_per_unit:6,fixed_charge:0}
  ]),/gap or overlap/);
});

test('settlement search finds fewer transfers than a greedy pairing',()=>{
  const result=minimizeTransfers([
    {id:1,balance:800},{id:2,balance:700},{id:3,balance:600},
    {id:4,balance:-900},{id:5,balance:-700},{id:6,balance:-500}
  ]);
  assert.equal(result.optimal,true);
  assert.equal(result.transfers.length,4);
  const net=new Map();
  for(const t of result.transfers){net.set(t.payer,(net.get(t.payer)||0)+t.cents);net.set(t.payee,(net.get(t.payee)||0)-t.cents);}
  assert.deepEqual([...net].sort((a,b)=>a[0]-b[0]),[[1,800],[2,700],[3,600],[4,-900],[5,-700],[6,-500]]);
});
