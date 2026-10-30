export const toCents = value => Math.round(Number(value)*100);
export const fromCents = cents => (cents/100).toFixed(2);

export function allocateCents(totalCents, members) {
  const totalWeight=members.reduce((sum,member)=>sum+Number(member.weight),0);
  if(!Number.isFinite(totalWeight)||totalWeight<=0) throw new Error('No occupants overlap the relevant dates');
  let remaining=totalCents;
  return members.map((member,index)=>{
    const cents=index===members.length-1?remaining:Math.round(totalCents*Number(member.weight)/totalWeight);
    remaining-=cents;
    return {...member,cents};
  });
}

export function calculateSlabs(units,rates) {
  if(!rates.length||Number(rates[0].unit_from)!==0) throw new Error('Add slab rates beginning at 0, valid for the entire cycle');
  let covered=0,energy=0;
  const parts=[];
  for(const rate of rates){
    const from=Number(rate.unit_from);
    if(from!==covered&&covered<units) throw new Error('Slab rates have a gap or overlap');
    const upper=rate.unit_to==null?Infinity:Number(rate.unit_to);
    const used=Math.max(0,Math.min(units,upper)-from);
    if(used>0){const amount=toCents(used*Number(rate.rate_per_unit));energy+=amount;parts.push({rate,used,amount});}
    covered=upper;
    if(covered>=units) break;
  }
  if(covered<units) throw new Error('Slab rates do not cover all consumed units');
  const fixed=toCents(rates[0].fixed_charge);
  return {parts,energy,fixed,total:energy+fixed};
}

// Exact for ordinary shared flats; the larger-household fallback keeps response time bounded.
export function minimizeTransfers(rows) {
  const entries=rows.map(r=>({id:r.id,balance:r.balance})).filter(r=>r.balance!==0);
  if(entries.reduce((sum,r)=>sum+r.balance,0)!==0) throw new Error('Cycle balances do not net to zero');
  const greedy=()=>{
    const debtors=entries.filter(r=>r.balance>0).map(r=>({...r,remaining:r.balance}));
    const creditors=entries.filter(r=>r.balance<0).map(r=>({...r,remaining:-r.balance}));
    const path=[];let i=0,j=0;
    while(i<debtors.length&&j<creditors.length){
      const cents=Math.min(debtors[i].remaining,creditors[j].remaining);
      path.push({payer:debtors[i].id,payee:creditors[j].id,cents});
      debtors[i].remaining-=cents;creditors[j].remaining-=cents;
      if(!debtors[i].remaining)i++;if(!creditors[j].remaining)j++;
    }
    return path;
  };
  let best=greedy();
  if(entries.length>12) return {transfers:best,optimal:false};
  const balances=entries.map(r=>r.balance);
  const lowerBound=Math.max(entries.filter(r=>r.balance>0).length,entries.filter(r=>r.balance<0).length);
  function search(start,path){
    while(start<balances.length&&balances[start]===0)start++;
    if(start===balances.length){if(path.length<best.length)best=path.slice();return;}
    if(path.length>=best.length||best.length===lowerBound)return;
    const seen=new Set();
    for(let j=start+1;j<balances.length;j++){
      if(balances[start]*balances[j]>=0||seen.has(balances[j]))continue;
      seen.add(balances[j]);
      const a=balances[start],b=balances[j],cents=Math.min(Math.abs(a),Math.abs(b));
      balances[start]=a-Math.sign(a)*cents;
      balances[j]=b+Math.sign(a)*cents;
      path.push({payer:a>0?entries[start].id:entries[j].id,payee:a<0?entries[start].id:entries[j].id,cents});
      search(start,path);
      path.pop();balances[start]=a;balances[j]=b;
    }
  }
  search(0,[]);
  return {transfers:best,optimal:true};
}
