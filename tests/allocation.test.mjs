import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCents } from '../lib/calculation.js';
import { inputPaise } from '../lib/financial-state.js';

test('three paise shared by six people never creates a negative remainder',()=>{
  const result=allocateCents(3,Array.from({length:6},(_,i)=>({id:i+1,weight:1})));
  assert.deepEqual(result.map(x=>x.cents),[1,1,1,0,0,0]);
});
test('largest remainders and identity tie-breaks are stable under reordering',()=>{
  const members=[{id:3,weight:'0.25'},{id:1,weight:'0.25'},{id:2,weight:'0.5'},{id:4,weight:0}];
  const mapping=rows=>Object.fromEntries(rows.map(row=>[row.id,row.cents]));
  assert.deepEqual(mapping(allocateCents(3,members)),{1:1,2:1,3:1,4:0});
  for(let total=0;total<100;total++)
    assert.deepEqual(mapping(allocateCents(total,members)),mapping(allocateCents(total,members.toReversed())));
});
test('allocation conserves every amount across varied group sizes and decimal weights',()=>{
  for(let count=1;count<=12;count++) for(let total=0;total<150;total++) {
    const members=Array.from({length:count},(_,i)=>({id:i+1,weight:((i+1)*0.125).toFixed(3)}));
    const result=allocateCents(total,members);
    assert.equal(result.reduce((sum,row)=>sum+row.cents,0),total);
    assert.ok(result.every(row=>Number.isSafeInteger(row.cents)&&row.cents>=0));
  }
});
test('allocation rejects invalid totals and weights',()=>{
  for(const total of [-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>allocateCents(total,[{weight:1}]));
  for(const weight of [-1,'NaN','Infinity',undefined,'0.0000001']) assert.throws(()=>allocateCents(3,[{weight}]));
  assert.throws(()=>allocateCents(3,[{weight:0}]));
});
test('money input uses exact paise and rejects unsupported precision and nonpositive payments',()=>{
  assert.equal(inputPaise('0.29','Amount'),29);
  assert.equal(inputPaise('9999999999.99','Amount'),999999999999);
  assert.equal(inputPaise('0','Reading',{allowZero:true}),0);
  for(const value of ['1.001','-1','1e3','NaN','',0,'10000000000.00']) assert.throws(()=>inputPaise(value,'Amount'));
});
