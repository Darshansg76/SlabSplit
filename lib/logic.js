import { query, transaction } from './db';
import { toCents as money, fromCents as decimal, allocateCents as allocate, calculateSlabs, minimizeTransfers } from './calculation';

const required = (x,name) => { if (x === undefined || x === null || String(x).trim()==='') throw new Error(`${name} is required`); return x; };
const positive = (x,name) => { const n=Number(required(x,name)); if (!Number.isFinite(n)||n<=0) throw new Error(`${name} must be positive`); return n; };
const id = (x,name) => { const n=Number(required(x,name)); if (!Number.isSafeInteger(n)||n<=0) throw new Error(`${name} must be a valid ID`); return n; };
const date = (x,name) => { required(x,name); if (!/^\d{4}-\d{2}-\d{2}$/.test(x)||Number.isNaN(Date.parse(x))) throw new Error(`${name} must be YYYY-MM-DD`); return x; };
const short = (x,name,max=255) => { const s=String(required(x,name)).trim(); if(s.length>max) throw new Error(`${name} is too long`); return s; };

export async function householdAccess(session, householdId) {
  if (session.role === 'admin') return true;
  const { rowCount } = await query('SELECT 1 FROM occupancy WHERE household_id=$1 AND occupant_id=$2 LIMIT 1',[householdId,session.occupant_id]);
  return rowCount>0;
}

export async function snapshot(session, householdId, cycleId) {
  const households = (await query(session.role==='admin'
    ? 'SELECT * FROM household ORDER BY household_id'
    : 'SELECT DISTINCT h.* FROM household h JOIN occupancy o USING(household_id) WHERE o.occupant_id=$1 ORDER BY h.household_id',
    session.role==='admin'?[]:[session.occupant_id])).rows;
  const h = Number(householdId) || Number(households[0]?.household_id);
  if (!h || !households.some(x=>Number(x.household_id)===h)) return { households, selectedHousehold:null };
  const cycles=(await query('SELECT * FROM bill_cycle WHERE household_id=$1 ORDER BY cycle_start DESC',[h])).rows;
  const c=Number(cycleId) || Number(cycles[0]?.cycle_id);
  if(c && !cycles.some(x=>Number(x.cycle_id)===c)) throw new Error('Cycle is outside selected household');
  const [occupants,occupancies,slabs,bills,expenses,payments,settlements,receipts,balances,audit,categoryTotals,occupancyReport,aboveAverage] = await Promise.all([
    session.role==='admin'
      ? query('SELECT * FROM occupant ORDER BY name')
      : query('SELECT DISTINCT o.* FROM occupant o JOIN occupancy oc USING(occupant_id) WHERE oc.household_id=$1 ORDER BY o.name',[h]),
    query('SELECT oc.*,o.name AS occupant_name FROM occupancy oc JOIN occupant o USING(occupant_id) WHERE oc.household_id=$1 ORDER BY oc.move_in_date DESC',[h]),
    query('SELECT * FROM slab_rate WHERE household_id=$1 ORDER BY utility_type,effective_from DESC,unit_from',[h]),
    query('SELECT b.*,v.amount_paid,v.amount_due FROM bill b JOIN bill_cycle c USING(cycle_id) JOIN v_bill_summary v USING(bill_id) WHERE c.household_id=$1 AND ($2::BIGINT IS NULL OR c.cycle_id=$2) ORDER BY b.bill_id DESC',[h,c||null]),
    query('SELECT e.*,o.name AS paid_by FROM expense e JOIN occupant o ON o.occupant_id=e.paid_by_occupant_id WHERE e.household_id=$1 AND ($2::BIGINT IS NULL OR e.cycle_id=$2) ORDER BY e.expense_date DESC',[h,c||null]),
    query('SELECT p.*,o.name AS occupant_name FROM payment p JOIN occupant o USING(occupant_id) LEFT JOIN bill b ON b.bill_id=p.bill_id LEFT JOIN expense e ON e.expense_id=p.expense_id LEFT JOIN bill_cycle c ON c.cycle_id=b.cycle_id WHERE (c.household_id=$1 OR e.household_id=$1) AND ($2::BIGINT IS NULL OR c.cycle_id=$2 OR e.cycle_id=$2) ORDER BY p.payment_id DESC',[h,c||null]),
    query('SELECT s.*,p.name AS payer_name,q.name AS payee_name FROM settlement s JOIN occupant p ON p.occupant_id=s.payer_occupant_id JOIN occupant q ON q.occupant_id=s.payee_occupant_id JOIN bill_cycle c USING(cycle_id) WHERE c.household_id=$1 AND ($2::BIGINT IS NULL OR c.cycle_id=$2) ORDER BY s.settlement_id DESC',[h,c||null]),
    query('SELECT r.* FROM receipt r LEFT JOIN bill b ON b.bill_id=r.bill_id LEFT JOIN bill_cycle c ON c.cycle_id=b.cycle_id LEFT JOIN expense e ON e.expense_id=r.expense_id WHERE c.household_id=$1 OR e.household_id=$1 ORDER BY r.receipt_id DESC',[h]),
    query('SELECT * FROM v_cycle_member_balance WHERE cycle_id=$1 ORDER BY name',[c||0]),
    query("SELECT a.* FROM audit_log a WHERE (a.entity_name='bill' AND a.entity_id IN (SELECT b.bill_id FROM bill b JOIN bill_cycle c USING(cycle_id) WHERE c.household_id=$1)) OR (a.entity_name='expense' AND a.entity_id IN (SELECT expense_id FROM expense WHERE household_id=$1)) ORDER BY changed_at DESC LIMIT 20",[h]),
    query(`SELECT e.category,COUNT(*)::INT AS expense_count,SUM(e.amount) AS total_amount,
      ROUND(AVG(e.amount),2) AS average_amount FROM expense e
      WHERE e.household_id=$1 AND ($2::BIGINT IS NULL OR e.cycle_id=$2)
      GROUP BY e.category HAVING SUM(e.amount)>0 ORDER BY total_amount DESC`,[h,c||null]),
    query(`SELECT o.name,SUM(occupancy_days(oc,bc.cycle_start,bc.cycle_end))::INT AS occupied_days
      FROM bill_cycle bc JOIN occupancy oc ON oc.household_id=bc.household_id
      JOIN occupant o ON o.occupant_id=oc.occupant_id WHERE bc.cycle_id=$1
      GROUP BY o.occupant_id,o.name
      HAVING SUM(occupancy_days(oc,bc.cycle_start,bc.cycle_end))>0
      ORDER BY occupied_days DESC,o.name`,[c||0]),
    query(`SELECT e.expense_id,e.description,e.amount,e.expense_date FROM expense e
      WHERE e.household_id=$1 AND ($2::BIGINT IS NULL OR e.cycle_id=$2)
      AND e.amount>(SELECT AVG(x.amount) FROM expense x
        WHERE x.household_id=e.household_id AND ($2::BIGINT IS NULL OR x.cycle_id=$2))
      ORDER BY e.amount DESC`,[h,c||null])
  ]);
  let billShares=[],expenseShares=[],breakdown=[];
  if(c){
    [billShares,expenseShares,breakdown]=await Promise.all([
      query('SELECT bs.*,o.name AS occupant_name FROM bill_share bs JOIN bill b USING(bill_id) JOIN occupant o USING(occupant_id) WHERE b.cycle_id=$1 ORDER BY bs.bill_id,o.name',[c]),
      query('SELECT es.*,o.name AS occupant_name FROM expense_share es JOIN expense e USING(expense_id) JOIN occupant o USING(occupant_id) WHERE e.cycle_id=$1 ORDER BY es.expense_id,o.name',[c]),
      query('SELECT x.*,s.unit_from,s.unit_to,s.rate_per_unit FROM bill_slab_breakdown x JOIN bill b USING(bill_id) JOIN slab_rate s USING(slab_rate_id) WHERE b.cycle_id=$1 ORDER BY x.bill_id,s.unit_from',[c])
    ]);
  }
  return { households, selectedHousehold:h, cycles, selectedCycle:c||null,
    occupants:occupants.rows,occupancies:occupancies.rows,slabs:slabs.rows,bills:bills.rows,
    expenses:expenses.rows,payments:payments.rows,settlements:settlements.rows,receipts:receipts.rows,
    balances:balances.rows,audit:audit.rows,billShares:billShares.rows||[],expenseShares:expenseShares.rows||[],breakdown:breakdown.rows||[],
    reports:{categoryTotals:categoryTotals.rows,occupancy:occupancyReport.rows,aboveAverage:aboveAverage.rows} };
}

async function assertCycle(client, cycleId, householdId) {
  const {rows}=await client.query('SELECT *,cycle_start::text AS start_date,cycle_end::text AS end_date FROM bill_cycle WHERE cycle_id=$1 AND household_id=$2 FOR UPDATE',[cycleId,householdId]);
  if(!rows[0]) throw new Error('Cycle does not belong to this household');
  return rows[0];
}
async function assertMember(client, householdId, occupantId, onDate) {
  const {rowCount}=await client.query('SELECT 1 FROM occupancy WHERE household_id=$1 AND occupant_id=$2 AND move_in_date<=$3 AND COALESCE(move_out_date,$3)>=$3',[householdId,occupantId,onDate]);
  if(!rowCount) throw new Error('Occupant is not active in this household on that date');
}
export async function performAction(session, input) {
  const action=short(input.action,'action',40);
  if(session.role!=='admin' && action!=='create_payment' && action!=='settle_own') throw new Error('Admin role required');
  return transaction(session.user_id,async client=>{
    let result;
    switch(action){
      case 'create_household': result=await client.query('INSERT INTO household(name,address,city,total_rooms) VALUES($1,$2,$3,$4) RETURNING *',[short(input.name,'name',120),short(input.address,'address'),short(input.city,'city',80),positive(input.total_rooms||1,'rooms')]); break;
      case 'create_occupant': result=await client.query('INSERT INTO occupant(name,email,phone,upi_id) VALUES($1,$2,$3,$4) RETURNING *',[short(input.name,'name',120),input.email||null,input.phone||null,input.upi_id||null]); break;
      case 'create_occupancy': result=await client.query('INSERT INTO occupancy(household_id,occupant_id,move_in_date,move_out_date,rent_weight,room_no) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[id(input.household_id,'household'),id(input.occupant_id,'occupant'),date(input.move_in_date,'move in'),input.move_out_date?date(input.move_out_date,'move out'):null,positive(input.rent_weight||1,'rent weight'),input.room_no||null]); break;
      case 'update_occupancy': result=await client.query('UPDATE occupancy SET move_out_date=$2,rent_weight=$3,room_no=$4 WHERE occupancy_id=$1 RETURNING *',[id(input.occupancy_id,'occupancy'),input.move_out_date?date(input.move_out_date,'move out'):null,positive(input.rent_weight||1,'rent weight'),input.room_no||null]); break;
      case 'create_cycle': result=await client.query('INSERT INTO bill_cycle(household_id,cycle_start,cycle_end,due_date) VALUES($1,$2,$3,$4) RETURNING *',[id(input.household_id,'household'),date(input.cycle_start,'cycle start'),date(input.cycle_end,'cycle end'),input.due_date?date(input.due_date,'due date'):null]); break;
      case 'update_cycle': result=await client.query('UPDATE bill_cycle SET status=$2,due_date=$3,updated_at=now() WHERE cycle_id=$1 RETURNING *',[id(input.cycle_id,'cycle'),short(input.status,'status',20),input.due_date?date(input.due_date,'due date'):null]); break;
      case 'create_slab': result=await client.query('INSERT INTO slab_rate(household_id,utility_type,unit_from,unit_to,rate_per_unit,fixed_charge,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[id(input.household_id,'household'),short(input.utility_type,'utility',30),Number(input.unit_from),input.unit_to===''||input.unit_to==null?null:Number(input.unit_to),Number(input.rate_per_unit),Number(input.fixed_charge||0),date(input.effective_from,'effective from'),input.effective_to?date(input.effective_to,'effective to'):null]); break;
      case 'delete_slab': result=await client.query('DELETE FROM slab_rate WHERE slab_rate_id=$1 RETURNING *',[id(input.slab_rate_id,'slab')]); break;
      case 'generate_bill': return generateBill(client,input);
      case 'create_expense': return createExpense(client,input);
      case 'delete_expense': result=await client.query('DELETE FROM expense WHERE expense_id=$1 RETURNING *',[id(input.expense_id,'expense')]); break;
      case 'create_payment': return createPayment(client,session,input);
      case 'delete_payment': result=await client.query('DELETE FROM payment WHERE payment_id=$1 RETURNING *',[id(input.payment_id,'payment')]); break;
      case 'create_receipt': result=await client.query('INSERT INTO receipt(expense_id,bill_id,uploaded_by,file_url,ocr_text) VALUES($1,$2,$3,$4,$5) RETURNING *',[input.expense_id? id(input.expense_id,'expense'):null,input.bill_id?id(input.bill_id,'bill'):null,session.user_id,short(input.file_url,'file URL',500),input.ocr_text||null]); break;
      case 'generate_settlements': return generateSettlements(client,input);
      case 'update_settlement': case 'settle_own': {
        const sid=id(input.settlement_id,'settlement');
        if(action==='settle_own') {
          const check=await client.query('SELECT 1 FROM settlement WHERE settlement_id=$1 AND payer_occupant_id=$2',[sid,session.occupant_id]);
          if(!check.rowCount) throw new Error('Only the payer may mark this settlement');
        }
        result=await client.query("UPDATE settlement SET status=$2,settled_on=CASE WHEN $2='settled' THEN CURRENT_DATE ELSE NULL END,updated_at=now() WHERE settlement_id=$1 RETURNING *",[sid,action==='settle_own'?'settled':short(input.status,'status',20)]); break;
      }
      default: throw new Error('Unknown action');
    }
    if(!result.rowCount) throw new Error('Record not found');
    return result.rows[0];
  });
}

async function generateBill(client,input) {
  const cycle=await assertCycle(client,id(input.cycle_id,'cycle'),id(input.household_id,'household'));
  if(cycle.status==='closed') throw new Error('Cycle is closed');
  const utility=short(input.utility_type,'utility',30);
  const prev=Number(input.prev_reading),curr=Number(input.curr_reading);
  if(!Number.isFinite(prev)||!Number.isFinite(curr)||prev<0||curr<prev) throw new Error('Current reading must be at least the previous reading');
  const units=Math.round((curr-prev)*100)/100;
  const rates=(await client.query(`SELECT * FROM slab_rate WHERE household_id=$1 AND utility_type=$2
    AND effective_from<=$3 AND (effective_to IS NULL OR effective_to>=$4)
    ORDER BY unit_from`,[cycle.household_id,utility,cycle.cycle_start,cycle.cycle_end])).rows;
  const {parts,energy,fixed,total}=calculateSlabs(units,rates);
  const members=(await client.query(`SELECT o.occupant_id, SUM(occupancy_days(oc,$2,$3))::INT AS days,
    SUM(occupancy_days(oc,$2,$3))::NUMERIC AS weight FROM occupancy oc JOIN occupant o USING(occupant_id)
    WHERE oc.household_id=$1 AND occupancy_days(oc,$2,$3)>0 GROUP BY o.occupant_id ORDER BY o.occupant_id`,[cycle.household_id,cycle.cycle_start,cycle.cycle_end])).rows;
  const shares=allocate(total,members);
  const bill=(await client.query(`INSERT INTO bill(cycle_id,utility_type,prev_reading,curr_reading,energy_charge,fixed_charge,total_amount)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[cycle.cycle_id,utility,prev,curr,decimal(energy),decimal(fixed),decimal(total)])).rows[0];
  for(const part of parts) await client.query('INSERT INTO bill_slab_breakdown(bill_id,slab_rate_id,units_in_slab,amount) VALUES($1,$2,$3,$4)',[bill.bill_id,part.rate.slab_rate_id,part.used,decimal(part.amount)]);
  for(const share of shares) await client.query('INSERT INTO bill_share(bill_id,occupant_id,days_applicable,weight,share_amount) VALUES($1,$2,$3,$4,$5)',[bill.bill_id,share.occupant_id,share.days,share.weight,decimal(share.cents)]);
  await client.query("UPDATE bill_cycle SET status='billed',updated_at=now() WHERE cycle_id=$1",[cycle.cycle_id]);
  return bill;
}
async function createExpense(client,input) {
  const household=id(input.household_id,'household'),cycleId=id(input.cycle_id,'cycle');
  const cycle=await assertCycle(client,cycleId,household);
  if(cycle.status==='closed') throw new Error('Cycle is closed');
  const expenseDate=date(input.expense_date,'expense date');
  if(expenseDate<cycle.start_date||expenseDate>cycle.end_date) throw new Error('Expense date must fall inside the cycle');
  const payer=id(input.paid_by_occupant_id,'payer');
  await assertMember(client,household,payer,expenseDate);
  const category=short(input.category,'category',30),isRecurring=!!input.is_recurring;
  const total=money(positive(input.amount,'amount'));
  const start=isRecurring?cycle.start_date:expenseDate,end=isRecurring?cycle.end_date:expenseDate;
  const members=(await client.query(`SELECT o.occupant_id,SUM(occupancy_days(oc,$2,$3))::INT AS days,
    SUM(occupancy_days(oc,$2,$3)*CASE WHEN $4='rent' THEN oc.rent_weight ELSE 1 END)::NUMERIC AS weight
    FROM occupancy oc JOIN occupant o USING(occupant_id)
    WHERE oc.household_id=$1 AND occupancy_days(oc,$2,$3)>0 GROUP BY o.occupant_id ORDER BY o.occupant_id`,[household,start,end,category])).rows;
  const shares=allocate(total,members);
  const expense=(await client.query(`INSERT INTO expense(household_id,cycle_id,paid_by_occupant_id,category,description,amount,expense_date,is_recurring)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[household,cycleId,payer,category,short(input.description,'description',1000),decimal(total),expenseDate,isRecurring])).rows[0];
  for(const share of shares) await client.query('INSERT INTO expense_share(expense_id,occupant_id,share_weight,share_amount,days_applicable) VALUES($1,$2,$3,$4,$5)',[expense.expense_id,share.occupant_id,share.weight,decimal(share.cents),share.days]);
  return expense;
}
async function createPayment(client,session,input) {
  const billId=input.bill_id?id(input.bill_id,'bill'):null;
  const expenseId=input.expense_id?id(input.expense_id,'expense'):null;
  if((!!billId)===(!!expenseId)) throw new Error('Choose either a bill or an expense');
  const occupantId=id(input.occupant_id,'occupant');
  if(session.role==='member' && occupantId!==Number(session.occupant_id)) throw new Error('Members can record only their own payments');
  const amount=money(positive(input.amount_paid,'amount paid'));
  const paidOn=date(input.paid_on,'payment date');
  if(billId){
    const {rows}=await client.query(`SELECT b.*,c.household_id,c.status FROM bill b JOIN bill_cycle c USING(cycle_id) WHERE b.bill_id=$1 FOR UPDATE OF b`,[billId]);
    const bill=rows[0];if(!bill) throw new Error('Bill not found');
    if(bill.status==='closed') throw new Error('Cycle is closed');
    const share=await client.query('SELECT 1 FROM bill_share WHERE bill_id=$1 AND occupant_id=$2',[billId,occupantId]);
    if(!share.rowCount) throw new Error('Occupant has no share in this bill');
    const already=money((await client.query('SELECT COALESCE(SUM(amount_paid),0) AS n FROM payment WHERE bill_id=$1',[billId])).rows[0].n);
    if(already+amount>money(bill.total_amount)) throw new Error('Payment exceeds bill balance');
  } else {
    const {rows}=await client.query(`SELECT e.*,c.status FROM expense e JOIN bill_cycle c USING(cycle_id) WHERE e.expense_id=$1 FOR UPDATE OF e`,[expenseId]);
    const expense=rows[0];if(!expense) throw new Error('Expense not found');
    if(expense.status==='closed') throw new Error('Cycle is closed');
    if(Number(expense.paid_by_occupant_id)===occupantId) throw new Error('The expense payer cannot reimburse themselves');
    const share=(await client.query('SELECT share_amount FROM expense_share WHERE expense_id=$1 AND occupant_id=$2',[expenseId,occupantId])).rows[0];
    if(!share) throw new Error('Occupant has no share in this expense');
    const already=money((await client.query('SELECT COALESCE(SUM(amount_paid),0) AS n FROM payment WHERE expense_id=$1 AND occupant_id=$2',[expenseId,occupantId])).rows[0].n);
    if(already+amount>money(share.share_amount)) throw new Error('Reimbursement exceeds the occupant share');
  }
  return (await client.query('INSERT INTO payment(bill_id,expense_id,occupant_id,amount_paid,paid_on,mode,reference_no) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[billId,expenseId,occupantId,decimal(amount),paidOn,short(input.mode,'mode',30),input.reference_no||null])).rows[0];
}
async function generateSettlements(client,input) {
  const cycle=await assertCycle(client,id(input.cycle_id,'cycle'),id(input.household_id,'household'));
  if(cycle.status==='closed') throw new Error('Cycle is closed');
  const unpaid=await client.query('SELECT 1 FROM v_bill_summary WHERE cycle_id=$1 AND ABS(amount_due)>0.001 LIMIT 1',[cycle.cycle_id]);
  if(unpaid.rowCount) throw new Error('Record full bill payments before generating settlements');
  const completed=await client.query("SELECT 1 FROM settlement WHERE cycle_id=$1 AND status='settled' LIMIT 1",[cycle.cycle_id]);
  if(completed.rowCount) throw new Error('This cycle has settled transfers; do not replace them');
  await client.query("DELETE FROM settlement WHERE cycle_id=$1 AND status IN ('pending','cancelled')",[cycle.cycle_id]);
  const balances=(await client.query('SELECT occupant_id,allocated,paid FROM v_cycle_member_balance WHERE cycle_id=$1 ORDER BY occupant_id',[cycle.cycle_id])).rows;
  const {transfers,optimal}=minimizeTransfers(balances.map(b=>({id:b.occupant_id,balance:money(b.allocated)-money(b.paid)})));
  for(const transfer of transfers)
    await client.query('INSERT INTO settlement(cycle_id,payer_occupant_id,payee_occupant_id,amount) VALUES($1,$2,$3,$4)',[cycle.cycle_id,transfer.payer,transfer.payee,decimal(transfer.cents)]);
  return { generated:transfers.length,optimal };
}
