import { query, transaction } from './db';
import { hashPassword, checkPassword } from './auth';
import { toCents as money, fromCents as decimal, allocateCents as allocate, calculateSlabs, minimizeTransfers } from './calculation';
import { inputPaise, prepareFinancialChange, checkOccupancyChange, checkSlabChange } from './financial-state';
import { outstandingBalancesSql, auditHistorySql } from './reporting';
import { createOccupantInvitation } from './invitations';
import { receiptFilename, readReceiptFile } from './receipts';

const required = (x,name) => { if (x === undefined || x === null || String(x).trim()==='') throw new Error(`${name} is required`); return x; };
const positive = (x,name) => { const n=Number(required(x,name)); if (!Number.isFinite(n)||n<=0) throw new Error(`${name} must be positive`); return n; };
const id = (x,name) => { const n=Number(required(x,name)); if (!Number.isSafeInteger(n)||n<=0) throw new Error(`${name} must be a valid ID`); return n; };
const date = (x,name) => { required(x,name); if (!/^\d{4}-\d{2}-\d{2}$/.test(x)||Number.isNaN(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x) throw new Error(`${name} must be a valid YYYY-MM-DD date`); return x; };
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
    query(outstandingBalancesSql,[c||0]),
    query(auditHistorySql,[h,c||null]),
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
  // Account list is admin-only: members never receive other people's login records.
  const users=session.role==='admin'
    ? (await query(`SELECT u.user_id,u.username,u.email,u.is_active,r.name AS role,o.name AS occupant_name
        FROM app_user u JOIN role r USING(role_id) LEFT JOIN occupant o USING(occupant_id)
        ORDER BY u.user_id`)).rows
    : [];
  return { households, selectedHousehold:h, cycles, selectedCycle:c||null, users,
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
  const memberActions=['create_payment','settle_own','change_password'];
  if(session.role!=='admin' && !memberActions.includes(action)) throw new Error('Admin role required');
  return transaction(session.user_id,async client=>{
    let result;
    switch(action){
      case 'create_household': result=await client.query('INSERT INTO household(name,address,city,total_rooms) VALUES($1,$2,$3,$4) RETURNING *',[short(input.name,'name',120),short(input.address,'address'),short(input.city,'city',80),positive(input.total_rooms||1,'rooms')]); break;
      case 'create_occupant': {
        const email=input.email?short(input.email,'email',160).toLowerCase():null;
        if(email&&(await client.query('SELECT 1 FROM occupant WHERE lower(email)=$1',[email])).rowCount) throw new Error('An occupant already uses that email.');
        result=await client.query('INSERT INTO occupant(name,email,phone,upi_id) VALUES($1,$2,$3,$4) RETURNING *',[short(input.name,'name',120),email,input.phone||null,input.upi_id||null]); break;
      }
      case 'create_occupancy': {
        const next={household_id:id(input.household_id,'household'),occupant_id:id(input.occupant_id,'occupant'),move_in_date:date(input.move_in_date,'move in'),move_out_date:input.move_out_date?date(input.move_out_date,'move out'):null,rent_weight:positive(input.rent_weight||1,'rent weight')};
        if(next.move_out_date&&next.move_out_date<next.move_in_date) throw new Error('Move-out date must not precede move-in date.');
        await checkOccupancyChange(client,next.household_id,null,next);
        result=await client.query('INSERT INTO occupancy(household_id,occupant_id,move_in_date,move_out_date,rent_weight,room_no) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[next.household_id,next.occupant_id,next.move_in_date,next.move_out_date,next.rent_weight,input.room_no||null]); break;
      }
      case 'update_occupancy': {
        const before=(await client.query('SELECT * FROM occupancy WHERE occupancy_id=$1 FOR UPDATE',[id(input.occupancy_id,'occupancy')])).rows[0];
        if(!before) throw new Error('Occupancy not found.');
        const next={...before,move_out_date:input.move_out_date?date(input.move_out_date,'move out'):null,rent_weight:positive(input.rent_weight||before.rent_weight,'rent weight')};
        if(next.move_out_date&&next.move_out_date<next.move_in_date) throw new Error('Move-out date must not precede move-in date.');
        await checkOccupancyChange(client,before.household_id,before,next);
        result=await client.query('UPDATE occupancy SET move_out_date=$2,rent_weight=$3,room_no=$4 WHERE occupancy_id=$1 RETURNING *',[before.occupancy_id,next.move_out_date,next.rent_weight,input.room_no??before.room_no]); break;
      }
      case 'create_cycle': result=await client.query('INSERT INTO bill_cycle(household_id,cycle_start,cycle_end,due_date) VALUES($1,$2,$3,$4) RETURNING *',[id(input.household_id,'household'),date(input.cycle_start,'cycle start'),date(input.cycle_end,'cycle end'),input.due_date?date(input.due_date,'due date'):null]); break;
      case 'update_cycle': result=await client.query('UPDATE bill_cycle SET status=$2,due_date=$3,updated_at=now() WHERE cycle_id=$1 RETURNING *',[id(input.cycle_id,'cycle'),short(input.status,'status',20),input.due_date?date(input.due_date,'due date'):null]); break;
      case 'create_slab': {
        const slab={household_id:id(input.household_id,'household'),utility_type:short(input.utility_type,'utility',30),unit_from:Number(input.unit_from),unit_to:input.unit_to===''||input.unit_to==null?null:Number(input.unit_to),effective_from:date(input.effective_from,'effective from'),effective_to:input.effective_to?date(input.effective_to,'effective to'):null};
        const rate=Number(input.rate_per_unit),fixed=inputPaise(input.fixed_charge||0,'Fixed charge',{allowZero:true})/100;
        if(!Number.isFinite(slab.unit_from)||slab.unit_from<0||
          (slab.unit_to!==null&&(!Number.isFinite(slab.unit_to)||slab.unit_to<=slab.unit_from))||
          !Number.isFinite(rate)||rate<0) throw new Error('Tariff units and rates must be finite nonnegative numbers with an increasing unit band.');
        if(slab.effective_to&&slab.effective_to<slab.effective_from) throw new Error('Tariff end date must not precede its start date.');
        await checkSlabChange(client,slab);
        result=await client.query('INSERT INTO slab_rate(household_id,utility_type,unit_from,unit_to,rate_per_unit,fixed_charge,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[slab.household_id,slab.utility_type,slab.unit_from,slab.unit_to,rate,fixed,slab.effective_from,slab.effective_to]); break;
      }
      case 'delete_slab': {
        const slab=(await client.query('SELECT * FROM slab_rate WHERE slab_rate_id=$1',[id(input.slab_rate_id,'slab')])).rows[0];
        if(!slab) throw new Error('Tariff not found.');
        await checkSlabChange(client,slab,true);
        result=await client.query('DELETE FROM slab_rate WHERE slab_rate_id=$1 RETURNING *',[slab.slab_rate_id]); break;
      }
      case 'generate_bill': return generateBill(client,input);
      case 'create_expense': return createExpense(client,input);
      case 'delete_expense': return deleteExpense(client,input);
      case 'create_payment': return createPayment(client,session,input);
      case 'delete_payment': return deletePayment(client,input);
      case 'create_receipt': return createReceipt(client,session,input);
      case 'generate_settlements': return generateSettlements(client,input);
      case 'create_user': return createUser(client,input);
      case 'change_password': return changePassword(client,session,input);
      case 'create_occupant_invitation': {
        const occupant=(await client.query('SELECT o.* FROM occupant o WHERE occupant_id=$1 AND NOT EXISTS(SELECT 1 FROM app_user u WHERE u.occupant_id=o.occupant_id)',[id(input.occupant_id,'occupant')])).rows[0];
        if(!occupant?.is_active||!occupant.email) throw new Error('Choose an active occupant with an email and no existing account.');
        return {invitation:createOccupantInvitation(occupant),email:occupant.email,expires_in_hours:24};
      }
      case 'update_user': {
        const uid=id(input.user_id,'user');
        if(Number(uid)===Number(session.user_id)) throw new Error('You cannot change your own account state');
        result=await client.query('UPDATE app_user SET is_active=$2 WHERE user_id=$1 RETURNING user_id,username,is_active',[uid,!!input.is_active]); break;
      }
      case 'delete_bill': return deleteBill(client,input);
      case 'update_settlement': case 'settle_own': {
        const sid=id(input.settlement_id,'settlement');
        const transfer=(await client.query('SELECT s.*,c.status AS cycle_status FROM settlement s JOIN bill_cycle c USING(cycle_id) WHERE settlement_id=$1 FOR UPDATE OF s,c',[sid])).rows[0];
        if(!transfer) throw new Error('Settlement not found.');
        if(action==='settle_own'&&Number(transfer.payer_occupant_id)!==Number(session.occupant_id)) throw new Error('Only the payer may mark this settlement');
        const status=action==='settle_own'?'settled':short(input.status,'status',20);
        if(transfer.status==='settled') {
          if(status==='settled') return transfer;
          throw new Error('Completed settlements cannot be reversed or replaced.');
        }
        if(transfer.cycle_status==='closed') throw new Error('Cycle is closed. Reopen it before recording a settlement.');
        if(transfer.status!=='pending'||!['settled','cancelled'].includes(status)) throw new Error('Only a current pending suggestion can be settled or cancelled. Regenerate suggestions after financial changes.');
        const unpaid=await client.query('SELECT 1 FROM v_bill_summary WHERE cycle_id=$1 AND amount_due<>0 LIMIT 1',[transfer.cycle_id]);
        if(status==='settled'&&unpaid.rowCount) throw new Error('Record full bill payments before settling transfers.');
        result=await client.query("UPDATE settlement SET status=$2::settlement_status_t,settled_on=CASE WHEN $2::settlement_status_t='settled'::settlement_status_t THEN CURRENT_DATE ELSE NULL END,updated_at=now() WHERE settlement_id=$1 RETURNING *",[sid,status]); break;
      }
      default: throw new Error('Unknown action');
    }
    if(!result.rowCount) throw new Error('Record not found');
    return result.rows[0];
  });
}

async function createUser(client,input) {
  const username=short(input.username,'username',60);
  if(!/^[A-Za-z0-9_]{3,60}$/.test(username)) throw new Error('Username must be 3-60 letters, numbers or underscores');
  const email=short(input.email,'email',160).toLowerCase();
  const password=String(required(input.password,'password'));
  if(password.length<8) throw new Error('Password must be at least 8 characters');
  const roleName=short(input.role,'role',30);
  if(!['admin','member'].includes(roleName)) throw new Error('Role must be admin or member');
  const role=(await client.query('SELECT role_id FROM role WHERE name=$1',[roleName])).rows[0];
  if(!role) throw new Error('Unknown role');
  const occupantId=input.occupant_id?id(input.occupant_id,'occupant'):null;
  return (await client.query(`INSERT INTO app_user(occupant_id,role_id,username,email,password_hash)
    VALUES($1,$2,$3,$4,$5) RETURNING user_id,username,email,occupant_id`,
    [occupantId,role.role_id,username,email,hashPassword(password)])).rows[0];
}

async function changePassword(client,session,input) {
  const current=String(required(input.current_password,'current password'));
  const next=String(required(input.new_password,'new password'));
  if(next.length<8) throw new Error('New password must be at least 8 characters');
  if(next===current) throw new Error('New password must differ from the current one');
  const {rows}=await client.query('SELECT password_hash FROM app_user WHERE user_id=$1 FOR UPDATE',[session.user_id]);
  if(!rows[0]||!checkPassword(current,rows[0].password_hash)) throw new Error('Current password is incorrect');
  await client.query('UPDATE app_user SET password_hash=$2 WHERE user_id=$1',[session.user_id,hashPassword(next)]);
  return {user_id:session.user_id,changed:true};
}

async function deleteExpense(client,input) {
  const expense=(await client.query('SELECT * FROM expense WHERE expense_id=$1 FOR UPDATE',[id(input.expense_id,'expense')])).rows[0];
  if(!expense) throw new Error('Expense not found.');
  const reimbursements=await client.query('SELECT 1 FROM payment WHERE expense_id=$1 LIMIT 1',[expense.expense_id]);
  if(reimbursements.rowCount) throw new Error('This expense has reimbursements and cannot be deleted. Its expense and payment history must be preserved.');
  await prepareFinancialChange(client,[expense.cycle_id]);
  await client.query("DELETE FROM doc_embedding WHERE (source_type='expense' AND source_id=$1) OR (source_type='receipt' AND source_id IN (SELECT receipt_id FROM receipt WHERE expense_id=$1))",[expense.expense_id]);
  return (await client.query('DELETE FROM expense WHERE expense_id=$1 RETURNING *',[expense.expense_id])).rows[0];
}

async function deletePayment(client,input) {
  const payment=(await client.query(`SELECT p.*,COALESCE(b.cycle_id,e.cycle_id) AS cycle_id FROM payment p
    LEFT JOIN bill b USING(bill_id) LEFT JOIN expense e USING(expense_id) WHERE payment_id=$1 FOR UPDATE OF p`,[id(input.payment_id,'payment')])).rows[0];
  if(!payment) throw new Error('Payment not found.');
  await prepareFinancialChange(client,[payment.cycle_id]);
  return (await client.query('DELETE FROM payment WHERE payment_id=$1 RETURNING *',[payment.payment_id])).rows[0];
}

async function createReceipt(client,session,input) {
  const billId=input.bill_id?id(input.bill_id,'bill'):null;
  const expenseId=input.expense_id?id(input.expense_id,'expense'):null;
  if((!!billId)===(!!expenseId)) throw new Error('Choose exactly one bill or expense for this receipt.');
  const target=(await client.query(billId
    ? 'SELECT c.household_id,b.cycle_id FROM bill b JOIN bill_cycle c USING(cycle_id) WHERE bill_id=$1'
    : 'SELECT household_id,cycle_id FROM expense WHERE expense_id=$1',[billId||expenseId])).rows[0];
  if(!target) throw new Error('Receipt target not found.');
  if(Number(target.household_id)!==id(input.household_id,'household')) throw new Error('Receipt target is outside the selected household.');
  const name=receiptFilename(input.file_url);
  if(!name) throw new Error('Upload a local receipt file first.');
  await readReceiptFile(name);
  return (await client.query('INSERT INTO receipt(expense_id,bill_id,uploaded_by,file_url,ocr_text) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [expenseId,billId,session.user_id,`/uploads/${name}`,input.ocr_text?short(input.ocr_text,'receipt text',10000):null])).rows[0];
}

async function deleteBill(client,input) {
  const billId=id(input.bill_id,'bill');
  const {rows}=await client.query(`SELECT b.bill_id,c.cycle_id,c.status
    FROM bill b JOIN bill_cycle c USING(cycle_id) WHERE b.bill_id=$1 FOR UPDATE OF b`,[billId]);
  const bill=rows[0];
  if(!bill) throw new Error('Bill not found');
  await prepareFinancialChange(client,[bill.cycle_id]);
  // payment.bill_id is ON DELETE SET NULL, which would leave a payment pointing at
  // neither a bill nor an expense and break chk_payment_target, so its payments go first.
  await client.query('DELETE FROM payment WHERE bill_id=$1',[billId]);
  await client.query("DELETE FROM doc_embedding WHERE source_type='receipt' AND source_id IN (SELECT receipt_id FROM receipt WHERE bill_id=$1)",[billId]);
  const deleted=(await client.query('DELETE FROM bill WHERE bill_id=$1 RETURNING *',[billId])).rows[0];
  const remaining=await client.query('SELECT 1 FROM bill WHERE cycle_id=$1 LIMIT 1',[bill.cycle_id]);
  if(!remaining.rowCount) await client.query("UPDATE bill_cycle SET status='open',updated_at=now() WHERE cycle_id=$1",[bill.cycle_id]);
  return deleted;
}

async function generateBill(client,input) {
  const cycle=await assertCycle(client,id(input.cycle_id,'cycle'),id(input.household_id,'household'));
  await prepareFinancialChange(client,[cycle.cycle_id]);
  const utility=short(input.utility_type,'utility',30);
  const prevPaise=inputPaise(input.prev_reading,'Previous reading',{allowZero:true});
  const currPaise=inputPaise(input.curr_reading,'Current reading',{allowZero:true});
  if(currPaise<prevPaise) throw new Error('Current reading must be at least the previous reading');
  const prev=prevPaise/100,curr=currPaise/100,units=(currPaise-prevPaise)/100;
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
  await prepareFinancialChange(client,[cycleId]);
  const expenseDate=date(input.expense_date,'expense date');
  if(expenseDate<cycle.start_date||expenseDate>cycle.end_date) throw new Error('Expense date must fall inside the cycle');
  const payer=id(input.paid_by_occupant_id,'payer');
  await assertMember(client,household,payer,expenseDate);
  const category=short(input.category,'category',30),isRecurring=!!input.is_recurring;
  const total=inputPaise(input.amount,'Amount');
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
  const amount=inputPaise(input.amount_paid,'Amount paid');
  const paidOn=date(input.paid_on,'payment date');
  if(billId){
    const {rows}=await client.query(`SELECT b.*,c.household_id,c.status FROM bill b JOIN bill_cycle c USING(cycle_id) WHERE b.bill_id=$1 FOR UPDATE OF b`,[billId]);
    const bill=rows[0];if(!bill) throw new Error('Bill not found');
    if(Number(bill.household_id)!==id(input.household_id,'household')) throw new Error('Bill is outside the selected household.');
    await prepareFinancialChange(client,[bill.cycle_id]);
    const share=await client.query('SELECT 1 FROM bill_share WHERE bill_id=$1 AND occupant_id=$2',[billId,occupantId]);
    if(!share.rowCount) throw new Error('Occupant has no share in this bill');
    const already=money((await client.query('SELECT COALESCE(SUM(amount_paid),0) AS n FROM payment WHERE bill_id=$1',[billId])).rows[0].n);
    if(already+amount>money(bill.total_amount)) throw new Error('Payment exceeds bill balance');
  } else {
    const {rows}=await client.query(`SELECT e.*,c.status FROM expense e JOIN bill_cycle c USING(cycle_id) WHERE e.expense_id=$1 FOR UPDATE OF e`,[expenseId]);
    const expense=rows[0];if(!expense) throw new Error('Expense not found');
    if(Number(expense.household_id)!==id(input.household_id,'household')) throw new Error('Expense is outside the selected household.');
    await prepareFinancialChange(client,[expense.cycle_id]);
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
  await client.query("UPDATE settlement SET status='cancelled',updated_at=now() WHERE cycle_id=$1 AND status='pending'",[cycle.cycle_id]);
  const balances=(await client.query('SELECT occupant_id,allocated,paid FROM v_cycle_member_balance WHERE cycle_id=$1 ORDER BY occupant_id',[cycle.cycle_id])).rows;
  const {transfers,optimal}=minimizeTransfers(balances.map(b=>({id:b.occupant_id,balance:money(b.allocated)-money(b.paid)})));
  for(const transfer of transfers)
    await client.query('INSERT INTO settlement(cycle_id,payer_occupant_id,payee_occupant_id,amount) VALUES($1,$2,$3,$4)',[cycle.cycle_id,transfer.payer,transfer.payee,decimal(transfer.cents)]);
  return { generated:transfers.length,optimal };
}
