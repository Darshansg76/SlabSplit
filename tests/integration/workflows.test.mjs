import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';

const execute=promisify(execFile),root=process.cwd();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const evidence=path.join(root,'tmp','slabsplit-repair');
const tables=['household','occupant','occupancy','bill_cycle','slab_rate','bill','bill_slab_breakdown','bill_share','expense','expense_share','payment','settlement','role','app_user','receipt','doc_embedding','audit_log'];
pg.types.setTypeParser(pg.types.builtins.DATE,value=>value);
async function fingerprints(pool) {
  const result={};
  for(const name of tables) result[name]=(await pool.query(`SELECT count(*)::INT AS rows,md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::TEXT)::TEXT,'[]')) AS digest FROM ${name} t`)).rows[0];
  return result;
}
async function freePort() {
  return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
}

test('database-backed workflows against an isolated copy of the unchanged schema',{timeout:600000},async t=>{
  assert.ok(process.env.DATABASE_URL,'Configure .env.local and run npm run demo -- --services-only first.');
  await mkdir(evidence,{recursive:true});
  const live=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
  const baseline=await fingerprints(live);
  await writeFile(path.join(evidence,'existing-data-before.json'),JSON.stringify(baseline,null,2));
  const dbName=`slabsplit_verify_${randomBytes(8).toString('hex')}`;
  const dbUrl=new URL(process.env.DATABASE_URL);dbUrl.pathname='/'+dbName;
  const pool=new pg.Pool({connectionString:dbUrl.toString(),max:3});
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const privateFiles=path.join(evidence,dbName,'receipts');
  const password='Integration-only-882!';
  const env={...process.env,DATABASE_URL:dbUrl.toString(),SESSION_SECRET:randomBytes(32).toString('hex'),
    DEMO_ADMIN_PASSWORD:password,DEMO_MEMBER_PASSWORD:password,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',
    SLABSPLIT_DIST_DIR:'.next-integration',SLABSPLIT_RECEIPT_DIR:privateFiles};
  let server,created=false,admin,member,h,c,billId,expenseId,paymentId,firstSettled,outsider;
  const generatedFiles=[];
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7V0AAAAASUVORK5CYII=','base64');
  const legacyName=`verify-${randomUUID()}.png`,legacyPath=path.join(root,'public','uploads',legacyName);
  const report={};
  const cents=value=>Math.round(Number(value)*100);
  async function request(route,{cookie,body,method=body?'POST':'GET',expected=200,form}={}) {
    const headers={};if(cookie) headers.cookie=cookie;
    if(body) headers['content-type']='application/json';
    const response=await fetch(base+route,{method:form?'POST':method,headers,body:form|| (body?JSON.stringify(body):undefined)});
    const result=await response.json();
    assert.equal(response.status,expected,`${route}: ${JSON.stringify(result)}`);
    return {body:result,cookie:response.headers.get('set-cookie')?.split(';')[0],response};
  }
  const action=async(actionName,values={},cookie=admin,expected=200)=>(await request('/api/actions',{cookie,body:{household_id:h,cycle_id:c,...values,action:actionName},expected})).body.result;
  const snapshot=async(cookie=admin,household=h,cycle=c)=>(await request(`/api/data?household_id=${household}&cycle_id=${cycle}`,{cookie})).body;
  const expense=async(description,amount='90.00',extra={})=>action('create_expense',{paid_by_occupant_id:extra.payer,category:'repair',description,amount,expense_date:'2026-10-31',...extra});
  try {
    assert.match(dbName,/^slabsplit_verify_[a-f0-9]+$/);
    assert.notEqual(dbUrl.pathname,new URL(process.env.DATABASE_URL).pathname);
    await live.query(`CREATE DATABASE ${dbName}`);created=true;
    await pool.query(await readFile('database/schema.sql','utf8'));
    await execute(process.execPath,['scripts/seed.mjs'],{cwd:root,env,timeout:20000,windowsHide:true});
    const oldPublicFiles=await readdir(path.dirname(legacyPath)).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    assert.equal(oldPublicFiles.length,0,'Start the app once to protect existing public receipts before running isolated tests.');
    await mkdir(path.dirname(legacyPath),{recursive:true});await writeFile(legacyPath,png,{flag:'wx'});generatedFiles.push(legacyPath);
    const log=createWriteStream(path.join(evidence,'integration-server.log'),{flags:'w'});
    server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    server.stdout.pipe(log,{end:false});server.stderr.pipe(log,{end:false});
    let ready=false;
    for(let i=0;i<90;i++) {try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(3000)});if(r.ok){ready=true;break;}}catch{}if(server.exitCode!==null)break;await delay(1000);}
    assert.ok(ready,'Integration server did not start; see tmp/slabsplit-repair/integration-server.log');
    admin=(await request('/api/auth',{body:{username:'admin',password}})).cookie;
    member=(await request('/api/auth',{body:{username:'asha',password}})).cookie;
    h=(await pool.query('SELECT household_id FROM household')).rows[0].household_id;
    c=(await pool.query('SELECT cycle_id FROM bill_cycle')).rows[0].cycle_id;
    const people=(await pool.query('SELECT * FROM occupant ORDER BY occupant_id')).rows;
    const [asha,dev,mira]=people;

    await t.test('both roles load the October dates and members cannot perform admin actions',async()=>{
      const data=await snapshot(member);
      assert.equal(data.cycles[0].cycle_start,'2026-10-01');assert.equal(data.cycles[0].cycle_end,'2026-10-31');
      assert.deepEqual(data.reports.occupancy.map(row=>row.occupied_days).sort((a,b)=>a-b),[16,31,31]);
      assert.equal(data.users.length,0);
      await action('create_slab',{utility_type:'water',unit_from:0,unit_to:100,rate_per_unit:'NaN',fixed_charge:0,effective_from:'2026-01-01'},admin,400);
      await action('create_slab',{utility_type:'electricity',unit_from:0,unit_to:100,rate_per_unit:4,fixed_charge:60,effective_from:'2026-01-01'},admin,400);
      await action('create_occupant',{name:'Not allowed'},member,403);
      await request('/api/data',{expected:401});
    });

    await t.test('bill shares persist, deletion clears dependent rows, and different readings regenerate correctly',async()=>{
      billId=(await action('generate_bill',{utility_type:'electricity',prev_reading:'1000',curr_reading:'1220'})).bill_id;
      let data=await snapshot();
      assert.equal(cents(data.bills[0].total_amount),122000);
      assert.deepEqual(data.billShares.map(row=>cents(row.share_amount)),[48487,48487,25026]);
      assert.equal(data.breakdown.length,3);
      await action('generate_bill',{utility_type:'electricity',prev_reading:'1000',curr_reading:'1220'},admin,400);
      await action('delete_bill',{bill_id:billId});
      data=await snapshot();assert.equal(data.bills.length,0);assert.equal(data.billShares.length,0);assert.equal(data.breakdown.length,0);
      assert.ok(data.audit.some(row=>row.entity_name==='bill'&&row.action==='DELETE'&&row.entity_id===billId));
      billId=(await action('generate_bill',{utility_type:'electricity',prev_reading:'1000',curr_reading:'1200'})).bill_id;
      data=await snapshot();assert.equal(cents(data.bills[0].total_amount),106000);
      assert.deepEqual(data.billShares.map(row=>cents(row.share_amount)),[42128,42128,21744]);
      await action('delete_bill',{bill_id:billId});
      billId=(await action('generate_bill',{utility_type:'electricity',prev_reading:'1000',curr_reading:'1220'})).bill_id;
    });

    await t.test('partial payments, unpaid-settlement refusal, and overpayment rollback use real database balances',async()=>{
      await action('generate_settlements',{},admin,400);
      paymentId=(await action('create_payment',{bill_id:billId,occupant_id:asha.occupant_id,amount_paid:'500',paid_on:'2026-10-31',mode:'upi'})).payment_id;
      await action('generate_settlements',{},admin,400);
      await action('create_payment',{bill_id:billId,occupant_id:asha.occupant_id,amount_paid:'720',paid_on:'2026-10-31',mode:'upi'});
      await action('create_payment',{bill_id:billId,occupant_id:asha.occupant_id,amount_paid:'0.01',paid_on:'2026-10-31',mode:'upi'},admin,400);
      assert.equal(cents((await snapshot()).bills[0].amount_due),0);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM payment')).rows[0].n,2);
    });

    await t.test('source mutations cancel suggestions; failed mutations roll back cancellation; stale suggestions cannot settle',async()=>{
      await action('generate_settlements');
      let data=await snapshot();const old=data.settlements.filter(row=>row.status==='pending');assert.equal(old.length,2);
      const temporary=await expense('Temporary cleaning expense','3',{payer:asha.occupant_id});
      data=await snapshot();assert.equal(data.settlements.filter(row=>row.status==='pending').length,0);
      await action('update_settlement',{settlement_id:old[0].settlement_id,status:'settled'},admin,400);
      await action('delete_expense',{expense_id:temporary.expense_id});
      data=await snapshot();assert.ok(data.audit.some(row=>row.entity_name==='expense'&&row.action==='DELETE'&&row.entity_id===temporary.expense_id));
      await action('generate_settlements');
      await expense('Invalid precision','0.001',{payer:asha.occupant_id}).then(()=>assert.fail('Accepted unsupported precision'),()=>{});
      assert.equal((await snapshot()).settlements.filter(row=>row.status==='pending').length,2);
      await action('delete_payment',{payment_id:paymentId});
      assert.equal((await snapshot()).settlements.filter(row=>row.status==='pending').length,0);
      paymentId=(await action('create_payment',{bill_id:billId,occupant_id:asha.occupant_id,amount_paid:'500',paid_on:'2026-10-31',mode:'upi'})).payment_id;
      await action('generate_settlements');
    });

    await t.test('closed cycles reject financial writes and saved allocations reject retroactive occupancy changes',async()=>{
      const occupancy=(await pool.query('SELECT * FROM occupancy WHERE occupant_id=$1',[asha.occupant_id])).rows[0];
      await action('update_occupancy',{occupancy_id:occupancy.occupancy_id,move_out_date:'2026-10-30',rent_weight:1},admin,400);
      assert.equal((await snapshot()).reports.occupancy.find(row=>row.name===asha.name).occupied_days,31);
      await action('update_cycle',{status:'closed',due_date:'2026-11-05'});
      for(const [name,values] of [
        ['delete_bill',{bill_id:billId}],['delete_payment',{payment_id:paymentId}],
        ['create_expense',{paid_by_occupant_id:asha.occupant_id,description:'Blocked',category:'other',amount:10,expense_date:'2026-10-31'}],
        ['generate_bill',{utility_type:'water',prev_reading:0,curr_reading:1}]
      ]) await action(name,values,admin,400);
      const pending=(await snapshot()).settlements.find(row=>row.status==='pending');
      await action('update_settlement',{settlement_id:pending.settlement_id,status:'settled'},admin,400);
      await action('update_cycle',{status:'billed',due_date:'2026-11-05'});
    });

    await t.test('reimbursements alter the existing balance once and reimbursed expense deletion preserves payment history',async()=>{
      expenseId=(await expense('Repair of kitchen tap','90',{payer:asha.occupant_id})).expense_id;
      const before=Object.fromEntries((await snapshot()).balances.map(row=>[row.occupant_id,cents(row.original_balance)]));
      await action('create_payment',{expense_id:expenseId,occupant_id:dev.occupant_id,amount_paid:'15',paid_on:'2026-10-31',mode:'upi'});
      const after=(await snapshot()).balances;
      assert.equal(cents(after.find(row=>row.occupant_id===dev.occupant_id).original_balance),before[dev.occupant_id]-1500);
      assert.equal(cents(after.find(row=>row.occupant_id===asha.occupant_id).original_balance),before[asha.occupant_id]+1500);
      assert.equal(cents(after.find(row=>row.occupant_id===mira.occupant_id).original_balance),before[mira.occupant_id]);
      const refusal=await request('/api/actions',{cookie:admin,body:{action:'delete_expense',expense_id:expenseId},expected:400});
      assert.match(refusal.body.error,/reimbursements.*preserved/i);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM payment WHERE expense_id=$1',[expenseId])).rows[0].n,1);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM expense WHERE expense_id=$1',[expenseId])).rows[0].n,1);
      await action('create_payment',{expense_id:expenseId,occupant_id:dev.occupant_id,amount_paid:'15.01',paid_on:'2026-10-31',mode:'upi'},admin,400);
    });

    await t.test('completed transfers clear outstanding balances, preserve original due, and freeze their source finances',async()=>{
      const plain=await expense('Unreimbursed financial record','3',{payer:asha.occupant_id});
      await action('generate_settlements');
      const before=await snapshot(),pending=before.settlements.filter(row=>row.status==='pending');assert.equal(pending.length,2);
      firstSettled=pending[0];
      await action('update_settlement',{settlement_id:firstSettled.settlement_id,status:'settled'});
      const partial=await snapshot();
      for(const row of partial.balances) {
        const original=before.balances.find(x=>x.occupant_id===row.occupant_id);
        assert.equal(cents(row.original_balance),cents(original.original_balance));
        const delta=row.occupant_id===firstSettled.payer_occupant_id?-cents(firstSettled.amount):row.occupant_id===firstSettled.payee_occupant_id?cents(firstSettled.amount):0;
        assert.equal(cents(row.outstanding),cents(original.original_balance)+delta);
      }
      await action('update_settlement',{settlement_id:pending[1].settlement_id,status:'settled'});
      const done=await snapshot();assert.ok(done.balances.every(row=>cents(row.outstanding)===0));
      await action('update_settlement',{settlement_id:firstSettled.settlement_id,status:'settled'});
      await action('update_settlement',{settlement_id:firstSettled.settlement_id,status:'pending'},admin,400);
      for(const [name,values] of [
        ['generate_settlements',{}],['delete_bill',{bill_id:billId}],['delete_expense',{expense_id:plain.expense_id}],
        ['delete_payment',{payment_id:paymentId}],['create_payment',{bill_id:billId,occupant_id:dev.occupant_id,amount_paid:1,paid_on:'2026-10-31',mode:'upi'}],
        ['create_expense',{paid_by_occupant_id:asha.occupant_id,description:'Blocked',category:'other',amount:1,expense_date:'2026-10-31'}],
        ['delete_slab',{slab_rate_id:(await pool.query('SELECT slab_rate_id FROM slab_rate LIMIT 1')).rows[0].slab_rate_id}]
      ]) await action(name,values,admin,400);
      assert.ok(done.audit.some(row=>row.entity_name==='payment'));
      assert.ok(done.audit.some(row=>row.entity_name==='settlement'&&row.action==='UPDATE'));
      report.completedSettlementBalances=done.balances.map(({name,original_balance,outstanding})=>({name,original_balance,outstanding}));
    });

    await t.test('self-registration, invited linking, role protection, password change, and single-use claiming work',async()=>{
      const email='invited@example.test';
      const occupant=await action('create_occupant',{name:'Invited person',email});
      const registration={name:'Invited person',username:'invited',email:email.toUpperCase(),password};
      await request('/api/register',{body:registration,expected:400});
      await action('create_occupant_invitation',{occupant_id:occupant.occupant_id},member,403);
      const invitation=(await action('create_occupant_invitation',{occupant_id:occupant.occupant_id})).invitation;
      await request('/api/register',{body:{...registration,email:'wrong@example.test',invitation},expected:400});
      const registered=await request('/api/register',{body:{...registration,invitation,role:'admin'}});
      outsider=registered.cookie;
      assert.equal(registered.body.user.role,'member');assert.equal(registered.body.user.occupant_id,occupant.occupant_id);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM occupant WHERE lower(email)=$1',[email])).rows[0].n,1);
      await request('/api/register',{body:{...registration,username:'replay',invitation},expected:400});
      const fresh=await request('/api/register',{body:{name:'New person',username:'fresh',email:'fresh@example.test',password,role:'admin'}});
      assert.equal(fresh.body.user.role,'member');
      await action('change_password',{current_password:password,new_password:'Changed-password-992!'},fresh.cookie);
      const logout=await request('/api/auth',{cookie:fresh.cookie,method:'DELETE'});
      assert.match(logout.response.headers.get('set-cookie'),/Max-Age=0/i);
      await request('/api/auth',{body:{username:'fresh',password},expected:401});
      await request('/api/auth',{body:{username:'fresh',password:'Changed-password-992!'}});
      const second=await action('create_occupant',{name:'Concurrent invite',email:'race@example.test'});
      const token=(await action('create_occupant_invitation',{occupant_id:second.occupant_id})).invitation;
      const attempts=await Promise.all(['racer1','racer2'].map(username=>fetch(base+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Race user',username,email:'race@example.test',password,invitation:token})})));
      assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM app_user WHERE occupant_id=$1',[second.occupant_id])).rows[0].n,1);
    });

    let receiptId;
    await t.test('private and existing public receipt URLs enforce login and household access and preserve exact bytes',async()=>{
      const upload=async(bytes,mime='image/png')=>{const form=new FormData();form.set('file',new Blob([bytes],{type:mime}),'receipt.png');return request('/api/upload',{cookie:admin,form,expected:bytes===png?200:400});};
      await upload(Buffer.from('<html>not an image</html>'));
      const up=await upload(png);const fileUrl=up.body.file_url;
      await request(fileUrl,{expected:401});
      await request(fileUrl,{cookie:member,expected:404});
      const saved=await action('create_receipt',{bill_id:billId,file_url:fileUrl,ocr_text:'Electrician replaced failed circuit breaker panel'});receiptId=saved.receipt_id;
      await action('create_receipt',{bill_id:billId,expense_id:expenseId,file_url:fileUrl},admin,400);
      await request(fileUrl,{cookie:outsider,expected:403});
      let response=await fetch(base+fileUrl,{headers:{cookie:member}});
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
      assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      const legacyUrl='/uploads/'+legacyName;
      await action('create_receipt',{bill_id:billId,file_url:legacyUrl,ocr_text:'Legacy receipt'});
      await request(legacyUrl,{expected:401});await request(legacyUrl,{cookie:outsider,expected:403});
      for(const alternate of [legacyUrl.replace('/uploads/','/UPLOADS/'),legacyUrl.replace('/uploads/','/%75ploads/')]) {
        const bypass=await fetch(base+alternate);
        assert.notEqual(bypass.status,200,`Unauthenticated path variant bypassed receipt authorization: ${alternate}`);
      }
      response=await fetch(base+legacyUrl,{headers:{cookie:member}});
      assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
      assert.deepEqual(await readFile(path.join(privateFiles,legacyName)),png);
      await assert.rejects(readFile(legacyPath),{code:'ENOENT'});
    });

    await t.test('actual MiniLM indexing retrieves relevant expenses and receipt text through pgvector',{timeout:180000},async()=>{
      const searchCycle=await action('create_cycle',{cycle_start:'2027-01-01',cycle_end:'2027-01-31',due_date:'2027-02-05'});
      const docs=[];
      for(const description of ['Plumber repaired a leaking kitchen tap and water pipe','Weekly groceries: rice vegetables and milk','Monthly broadband internet subscription']) {
        const record=await action('create_expense',{cycle_id:searchCycle.cycle_id,paid_by_occupant_id:asha.occupant_id,category:'other',description,amount:'100',expense_date:'2027-01-15'});
        docs.push(record);
        await request('/api/search',{cookie:admin,body:{action:'index',household_id:h,source_type:'expense',source_id:record.expense_id}});
      }
      await request('/api/search',{cookie:admin,body:{action:'index',household_id:h,source_type:'receipt',source_id:receiptId}});
      const text=(await request('/api/search',{cookie:member,body:{action:'text',household_id:h,text:'plumber'}})).body.results;
      assert.equal(text[0].source_id,docs[0].expense_id);
      const semantic=(await request('/api/search',{cookie:member,body:{action:'semantic',household_id:h,text:'plumbing repair for a leaking faucet'}})).body.results;
      assert.equal(semantic[0].source_type,'expense');assert.equal(semantic[0].source_id,docs[0].expense_id);
      assert.ok(Number(semantic[0].similarity)>Number(semantic.find(row=>row.source_id===docs[1].expense_id&&row.source_type==='expense').similarity));
      const receipt=(await request('/api/search',{cookie:member,body:{action:'semantic',household_id:h,text:'electrician replacing a broken circuit breaker'}})).body.results;
      assert.equal(receipt[0].source_type,'receipt');assert.equal(receipt[0].source_id,receiptId);
      await request('/api/search',{cookie:outsider,body:{action:'semantic',household_id:h,text:'plumbing'},expected:403});
      const stored=(await pool.query('SELECT source_type,source_id,vector_dims(embedding) AS dimensions,model FROM doc_embedding')).rows;
      assert.equal(stored.length,4);assert.ok(stored.every(row=>row.dimensions===384&&row.model==='all-MiniLM-L6-v2'));
      report.semanticSearch={query:'plumbing repair for a leaking faucet',ranking:semantic,receiptQuery:'electrician replacing a broken circuit breaker',receiptRanking:receipt,stored};
      const indexed=docs[2];await action('delete_expense',{expense_id:indexed.expense_id});
      assert.equal((await pool.query("SELECT count(*)::INT AS n FROM doc_embedding WHERE source_type='expense' AND source_id=$1",[indexed.expense_id])).rows[0].n,0);
    });

    await t.test('simultaneous payments and occupancy writes serialize without overpayment or duplicate overlap',async()=>{
      const cycle=await action('create_cycle',{cycle_start:'2027-02-01',cycle_end:'2027-02-28'});
      const bill=await action('generate_bill',{cycle_id:cycle.cycle_id,utility_type:'electricity',prev_reading:0,curr_reading:10});
      const body={action:'create_payment',household_id:h,cycle_id:cycle.cycle_id,bill_id:bill.bill_id,occupant_id:asha.occupant_id,amount_paid:60,paid_on:'2027-02-28',mode:'upi'};
      const payments=await Promise.all([1,2].map(()=>fetch(base+'/api/actions',{method:'POST',headers:{'content-type':'application/json',cookie:admin},body:JSON.stringify(body)})));
      assert.deepEqual(payments.map(r=>r.status).sort(),[200,400]);
      assert.equal(cents((await pool.query('SELECT sum(amount_paid) AS amount FROM payment WHERE bill_id=$1',[bill.bill_id])).rows[0].amount),6000);
      const occupant=await action('create_occupant',{name:'Overlap concurrency',email:'overlap@example.test'});
      const occupancy={action:'create_occupancy',household_id:h,occupant_id:occupant.occupant_id,move_in_date:'2028-01-01',move_out_date:'2028-01-31',rent_weight:1};
      const attempts=await Promise.all([1,2].map(()=>fetch(base+'/api/actions',{method:'POST',headers:{'content-type':'application/json',cookie:admin},body:JSON.stringify(occupancy)})));
      assert.deepEqual(attempts.map(r=>r.status).sort(),[200,400]);
      assert.equal((await pool.query('SELECT count(*)::INT AS n FROM occupancy WHERE occupant_id=$1',[occupant.occupant_id])).rows[0].n,1);
      const raceCycle=await action('create_cycle',{cycle_start:'2027-03-01',cycle_end:'2027-03-31'});
      await action('create_expense',{cycle_id:raceCycle.cycle_id,paid_by_occupant_id:asha.occupant_id,description:'Settlement race source',category:'other',amount:90,expense_date:'2027-03-15'});
      await action('generate_settlements',{cycle_id:raceCycle.cycle_id});
      const suggestion=(await pool.query("SELECT settlement_id FROM settlement WHERE cycle_id=$1 AND status='pending' LIMIT 1",[raceCycle.cycle_id])).rows[0];
      const financialEdit={action:'create_expense',household_id:h,cycle_id:raceCycle.cycle_id,paid_by_occupant_id:asha.occupant_id,description:'Concurrent edit',category:'other',amount:3,expense_date:'2027-03-15'};
      const settlementEdit={action:'update_settlement',settlement_id:suggestion.settlement_id,status:'settled'};
      const race=await Promise.all([financialEdit,settlementEdit].map(value=>fetch(base+'/api/actions',{method:'POST',headers:{'content-type':'application/json',cookie:admin},body:JSON.stringify(value)})));
      assert.deepEqual(race.map(r=>r.status).sort(),[200,400]);
      const completed=(await pool.query("SELECT count(*)::INT AS n FROM settlement WHERE cycle_id=$1 AND status='settled'",[raceCycle.cycle_id])).rows[0].n;
      const sourceCount=(await pool.query('SELECT count(*)::INT AS n FROM expense WHERE cycle_id=$1',[raceCycle.cycle_id])).rows[0].n;
      assert.equal(sourceCount,completed?1:2,'A completed settlement must not coexist with a concurrent source edit.');
    });

    await t.test('the formerly negative tiny allocation persists under the unchanged database checks',async()=>{
      const household=await action('create_household',{name:'Tiny allocation fixture',address:'Test only',city:'Test',total_rooms:3});
      const cycle=await action('create_cycle',{household_id:household.household_id,cycle_start:'2026-11-01',cycle_end:'2026-11-30'});
      let payer;
      for(let i=0;i<6;i++) {
        const person=await action('create_occupant',{name:`Tiny member ${i}`,email:`tiny${i}@example.test`});payer??=person.occupant_id;
        await action('create_occupancy',{household_id:household.household_id,occupant_id:person.occupant_id,move_in_date:'2026-11-01',rent_weight:1});
      }
      const record=await action('create_expense',{household_id:household.household_id,cycle_id:cycle.cycle_id,paid_by_occupant_id:payer,description:'Three paise among six people',category:'other',amount:'0.03',expense_date:'2026-11-02'});
      const shares=(await pool.query('SELECT share_amount FROM expense_share WHERE expense_id=$1',[record.expense_id])).rows.map(row=>cents(row.share_amount));
      assert.deepEqual(shares.sort((a,b)=>a-b),[0,0,0,1,1,1]);
    });
    await writeFile(path.join(evidence,'integration-evidence.json'),JSON.stringify(report,null,2));
  } finally {
    if(server&&server.exitCode===null) {
      if(process.platform==='win32') await execute('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
      else server.kill('SIGTERM');
    }
    await pool.end();
    if(created) {assert.match(dbName,/^slabsplit_verify_[a-f0-9]+$/);await live.query(`DROP DATABASE ${dbName} WITH (FORCE)`);}
    for(const file of generatedFiles) await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    const after=await fingerprints(live);await live.end();
    await writeFile(path.join(evidence,'existing-data-after.json'),JSON.stringify(after,null,2));
    assert.deepEqual(after,baseline,'Existing application data changed during isolated integration tests');
  }
});
