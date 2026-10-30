import pg from 'pg';
import { randomBytes, scryptSync } from 'node:crypto';

if(!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL first');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const hash=password=>{const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;};
const adminPassword=process.env.DEMO_ADMIN_PASSWORD;
const memberPassword=process.env.DEMO_MEMBER_PASSWORD;
if(!adminPassword || !memberPassword || adminPassword.length<8 || memberPassword.length<8)
  throw new Error('Set DEMO_ADMIN_PASSWORD and DEMO_MEMBER_PASSWORD (at least 8 characters)');
const client=await pool.connect();
try {
  await client.query('BEGIN');
  const existing=await client.query("SELECT 1 FROM household WHERE name='Demo Flat' LIMIT 1");
  if(existing.rowCount) throw new Error('Demo Flat already exists; seed is intentionally one-time');
  const h=(await client.query("INSERT INTO household(name,address,city,total_rooms) VALUES('Demo Flat','12 College Road','Bengaluru',3) RETURNING household_id")).rows[0].household_id;
  const people=[];
  for(const [name,email] of [['Asha Rao','asha@example.test'],['Dev Shah','dev@example.test'],['Mira Nair','mira@example.test']]) {
    people.push((await client.query('INSERT INTO occupant(name,email) VALUES($1,$2) RETURNING occupant_id',[name,email])).rows[0].occupant_id);
  }
  const cycle=(await client.query("INSERT INTO bill_cycle(household_id,cycle_start,cycle_end,due_date) VALUES($1,'2026-10-01','2026-10-31','2026-11-05') RETURNING cycle_id",[h])).rows[0].cycle_id;
  for(const [i,moveIn] of [[0,'2026-10-01'],[1,'2026-10-01'],[2,'2026-10-16']])
    await client.query('INSERT INTO occupancy(household_id,occupant_id,move_in_date,room_no) VALUES($1,$2,$3,$4)',[h,people[i],moveIn,String(i+1)]);
  for(const [from,to,rate,fixed] of [[0,100,4,60],[100,200,6,0],[200,null,8,0]])
    await client.query("INSERT INTO slab_rate(household_id,utility_type,unit_from,unit_to,rate_per_unit,fixed_charge,effective_from) VALUES($1,'electricity',$2,$3,$4,$5,'2026-01-01')",[h,from,to,rate,fixed]);
  await client.query("INSERT INTO app_user(occupant_id,role_id,username,email,password_hash) SELECT NULL,role_id,'admin','admin@example.test',$1 FROM role WHERE name='admin'",[hash(adminPassword)]);
  await client.query("INSERT INTO app_user(occupant_id,role_id,username,email,password_hash) SELECT $1,role_id,'asha','asha@example.test',$2 FROM role WHERE name='member'",[people[0],hash(memberPassword)]);
  await client.query('COMMIT');
  console.log('Seeded Demo Flat, three occupants, October cycle, electricity slabs, and admin/member accounts.');
  console.log('Sign in as admin or asha with the passwords provided through environment variables.');
} catch(error) { await client.query('ROLLBACK'); throw error; }
finally {client.release();await pool.end();}
