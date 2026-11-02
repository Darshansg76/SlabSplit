// Application checks only: the PDF-defined schema and existing database objects
// stay unchanged. lib/db.js serializes app mutations with a transaction lock.
export function inputPaise(value, name, {allowZero=false}={}) {
  const text=String(value??'').trim();
  if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(text))
    throw new Error(`${name} must have at most two decimal places`);
  const [whole,fraction='']=text.split('.');
  const paise=Number(BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0')));
  if(!Number.isSafeInteger(paise)||paise<0||(!allowZero&&paise===0))
    throw new Error(`${name} must be ${allowZero?'nonnegative':'positive'}`);
  return paise;
}

export async function mutableCycles(client, ids) {
  const unique=[...new Set(ids.map(Number))].filter(Boolean).sort((a,b)=>a-b);
  if(!unique.length) return;
  const cycles=(await client.query('SELECT cycle_id,status FROM bill_cycle WHERE cycle_id=ANY($1::BIGINT[]) ORDER BY cycle_id FOR UPDATE',[unique])).rows;
  if(cycles.some(cycle=>cycle.status==='closed')) throw new Error('Cycle is closed. Reopen it before changing financial records.');
  const completed=await client.query("SELECT 1 FROM settlement WHERE cycle_id=ANY($1::BIGINT[]) AND status='settled' LIMIT 1",[unique]);
  if(completed.rowCount) throw new Error('This cycle has completed settlements. Its financial records and allocation inputs are locked.');
}

export async function invalidatePending(client, ids) {
  const unique=[...new Set(ids.map(Number))].filter(Boolean);
  if(unique.length) await client.query("UPDATE settlement SET status='cancelled',updated_at=now() WHERE cycle_id=ANY($1::BIGINT[]) AND status='pending'",[unique]);
}

export async function prepareFinancialChange(client, ids) {
  await mutableCycles(client,ids);
  await invalidatePending(client,ids);
}

function days(cycle, occupancy) {
  if(!occupancy) return 0;
  const start=cycle.cycle_start>occupancy.move_in_date?cycle.cycle_start:occupancy.move_in_date;
  const end=occupancy.move_out_date&&occupancy.move_out_date<cycle.cycle_end?occupancy.move_out_date:cycle.cycle_end;
  return Math.max(0,(Date.parse(end)-Date.parse(start))/86400000+1);
}

export async function checkOccupancyChange(client, household, before, after) {
  const cycles=(await client.query('SELECT * FROM bill_cycle WHERE household_id=$1',[household])).rows;
  const affected=cycles.filter(cycle=>days(cycle,before)!==days(cycle,after)||
    (days(cycle,after)>0&&Number(before?.rent_weight??1)!==Number(after.rent_weight)));
  const ids=affected.map(cycle=>cycle.cycle_id);
  await mutableCycles(client,ids);
  if(ids.length) {
    const financial=await client.query(`SELECT 1 FROM bill WHERE cycle_id=ANY($1::BIGINT[])
      UNION ALL SELECT 1 FROM expense WHERE cycle_id=ANY($1::BIGINT[]) LIMIT 1`,[ids]);
    if(financial.rowCount) throw new Error('These occupancy dates or rent weights affect existing bills or expenses. Preserve their saved shares; use a future period or remove the affected unpaid records first.');
  }
  // The PDF overlap trigger alone cannot serialize simultaneous inserts. All app
  // writes hold the same advisory lock, so this check also covers app concurrency.
  const overlap=await client.query(`SELECT 1 FROM occupancy WHERE household_id=$1 AND occupant_id=$2
    AND occupancy_id<>$3 AND move_in_date<=COALESCE($5::DATE,'infinity'::DATE)
    AND COALESCE(move_out_date,'infinity'::DATE)>=$4::DATE LIMIT 1`,
    [household,after.occupant_id,before?.occupancy_id??0,after.move_in_date,after.move_out_date]);
  if(overlap.rowCount) throw new Error('Occupancy periods overlap for this occupant.');
  await invalidatePending(client,ids);
}

export async function checkSlabChange(client, slab, deleting=false) {
  const cycles=(await client.query(`SELECT cycle_id FROM bill_cycle WHERE household_id=$1
    AND cycle_start<=COALESCE($3::DATE,'infinity'::DATE) AND cycle_end>=$2::DATE`,
    [slab.household_id,slab.effective_from,slab.effective_to])).rows.map(c=>c.cycle_id);
  await mutableCycles(client,cycles);
  if(deleting) {
    const saved=await client.query(`SELECT 1 FROM bill WHERE cycle_id=ANY($1::BIGINT[]) AND utility_type=$2 LIMIT 1`,[cycles,slab.utility_type]);
    if(saved.rowCount) throw new Error('This tariff belongs to a period with saved bills. Preserve the tariff used for those bills.');
  } else {
    const overlap=await client.query(`SELECT 1 FROM slab_rate WHERE household_id=$1 AND utility_type=$2
      AND effective_from<=COALESCE($4::DATE,'infinity'::DATE) AND COALESCE(effective_to,'infinity'::DATE)>=$3::DATE
      AND unit_from<COALESCE($6::NUMERIC,'Infinity'::NUMERIC) AND COALESCE(unit_to,'Infinity'::NUMERIC)>$5::NUMERIC LIMIT 1`,
      [slab.household_id,slab.utility_type,slab.effective_from,slab.effective_to,slab.unit_from,slab.unit_to]);
    if(overlap.rowCount) throw new Error('This tariff overlaps an existing unit band and effective period.');
  }
  await invalidatePending(client,cycles);
}
