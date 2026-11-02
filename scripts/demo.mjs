import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, unlink, rmdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import pg from 'pg';

const execute=promisify(execFile);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const runtime=path.join(root,'.slabsplit-runtime'),lock=path.join(runtime,'start.lock');
const port=Number(process.env.PORT||3000),url=`http://127.0.0.1:${port}`;
const instance=createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0,16);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let ownsLock=false,child,setupChild,cleaning=false;

function run(command,args) {
  return new Promise((resolve,reject)=>{
    const proc=spawn(command,args,{cwd:root,stdio:'inherit',env:process.env,windowsHide:true});
    setupChild=proc;
    proc.once('error',reject);proc.once('exit',code=>{if(setupChild===proc)setupChild=null;code===0?resolve():reject(new Error(`${path.basename(command)} exited with code ${code}`));});
  });
}
async function appStatus() {
  try {
    const response=await fetch(`${url}/api/health`,{signal:AbortSignal.timeout(5000)});
    const body=await response.json();
    return body.application==='SlabSplit'&&body.instance===instance?body:null;
  } catch { return null; }
}
function alive(pid) {try{process.kill(pid,0);return true;}catch{return false;}}
async function releaseLock() {
  if(!ownsLock) return;
  ownsLock=false;
  await unlink(path.join(lock,'owner.json')).catch(()=>{});
  await rmdir(lock).catch(()=>{});
}
async function acquireLock() {
  await mkdir(runtime,{recursive:true});
  try {await mkdir(lock);} catch(error) {
    if(error.code!=='EEXIST') throw error;
    let owner;
    try {owner=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));} catch {
      if(Date.now()-(await stat(lock)).mtimeMs<10000) {console.log('SlabSplit startup is already in progress.');return false;}
    }
    const sameBoot=owner?.startedAt>Date.now()-os.uptime()*1000;
    if(sameBoot&&alive(owner.pid)) {console.log(`SlabSplit is already starting or running at ${owner.url}. Reuse that terminal.`);return false;}
    // Only this script's fixed, project-local lock files are removed.
    await unlink(path.join(lock,'owner.json')).catch(()=>{});
    await rmdir(lock);await mkdir(lock);
  }
  ownsLock=true;
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,startedAt:Date.now(),url}));
  return true;
}
async function dockerCommand() {
  const candidates=process.platform==='win32'?[
    path.join(process.env.ProgramFiles||'C:\\Program Files','Docker','Docker','resources','bin','docker.exe'),
    path.join(process.env.LOCALAPPDATA||'','Programs','DockerDesktop','resources','bin','docker.exe'),'docker.exe']:['docker'];
  for(const candidate of candidates) {try {await execute(candidate,['--version'],{windowsHide:true,timeout:10000});return candidate;} catch {}}
  throw new Error('Docker Desktop was not found. Install it once, then rerun npm run demo.');
}
async function readyDatabase() {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000,max:1});
  try {
    let ready=false;
    for(let i=0;i<30;i++) {try{await pool.query('SELECT 1');ready=true;break;}catch{await delay(2000);}}
    if(!ready) throw new Error('Database did not become ready. Check DATABASE_URL against the Compose port.');
    const result=await pool.query('SELECT (SELECT count(*) FROM household)::INT AS households,(SELECT count(*) FROM app_user)::INT AS users');
    if(result.rows[0].households===0&&result.rows[0].users===0) {
      console.log('New empty database: creating demo records once.');
      await run(process.execPath,['--env-file=.env.local','scripts/seed.mjs']);
    } else console.log('Existing database detected; preserving records and skipping seeding.');
  } finally {await pool.end();}
}
async function stopChild() {
  const owned=child||setupChild;
  if(!owned||owned.exitCode!==null) return;
  if(process.platform==='win32') await execute('taskkill',['/PID',String(owned.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});
  else owned.kill('SIGTERM');
}
async function finish(code=0) {
  if(cleaning) return;
  cleaning=true;await stopChild();await releaseLock();process.exitCode=code;
}
process.on('SIGINT',()=>finish());process.on('SIGTERM',()=>finish());

try {
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT must be between 1024 and 65535.');
  if(!process.env.DATABASE_URL||!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32||process.env.SESSION_SECRET.startsWith('replace-'))
    throw new Error('Configure DATABASE_URL and SESSION_SECRET in .env.local first. See README.');
  if(!await acquireLock()) process.exitCode=0;
  else {
    const docker=await dockerCommand();
    try {await execute(docker,['info','--format','{{.ServerVersion}}'],{timeout:10000,windowsHide:true});}
    catch {console.log('Starting Docker Desktop...');await run(docker,['desktop','start','--timeout','120']);}
    let engineReady=false;
    for(let i=0;i<60;i++) {try{await execute(docker,['info','--format','{{.ServerVersion}}'],{timeout:5000,windowsHide:true});engineReady=true;break;}catch{await delay(2000);}}
    if(!engineReady) throw new Error('Docker engine did not become ready. Check the Docker Desktop window.');
    const buildFiles=['embedding-service/Dockerfile','embedding-service/requirements.txt','embedding-service/app.py'];
    const hash=createHash('sha256');for(const file of buildFiles) hash.update(await readFile(file));
    const fingerprint=hash.digest('hex'),marker=path.join(runtime,'embedding-build.sha256');
    let previous='';try{previous=await readFile(marker,'utf8');}catch{}
    let image='';try{image=(await execute(docker,['compose','images','-q','embeddings'],{cwd:root,windowsHide:true})).stdout.trim();}catch{}
    if(previous!==fingerprint||!image) {console.log('Preparing embedding image (cached after this build)...');await run(docker,['compose','build','embeddings']);await writeFile(marker,fingerprint);}
    await run(docker,['compose','up','-d']);
    await readyDatabase();
    let serviceReady=false;
    for(let i=0;i<60;i++) {try{const response=await fetch(`${process.env.EMBEDDING_SERVICE_URL||'http://127.0.0.1:8001'}/openapi.json`,{signal:AbortSignal.timeout(3000)});if(response.ok){serviceReady=true;break;}}catch{}await delay(1000);}
    if(!serviceReady) throw new Error('Embedding service did not start. Check docker compose logs embeddings.');
    console.log('Checking MiniLM readiness (the first model download can take several minutes)...');
    const embedding=await fetch(`${process.env.EMBEDDING_SERVICE_URL||'http://127.0.0.1:8001'}/embed`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'SlabSplit readiness check'}),signal:AbortSignal.timeout(300000)});
    const vector=(await embedding.json()).embedding;
    if(!embedding.ok||!Array.isArray(vector)||vector.length!==384||!vector.every(Number.isFinite)) throw new Error('MiniLM did not return a valid 384-dimensional embedding.');
    if(process.argv.includes('--services-only')) {console.log('Database and embedding service are ready.');await releaseLock();}
    else if(await appStatus()) {console.log(`SlabSplit is already running: ${url}`);await releaseLock();}
    else {
      const free=await new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
      if(!free) throw new Error(`Port ${port} belongs to another process. Stop that process or choose PORT in .env.local.`);
      console.log(`Starting SlabSplit at ${url}. Keep this terminal open; Ctrl+C stops the website.`);
      child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{cwd:root,stdio:'inherit',env:process.env,windowsHide:true});
      await writeFile(path.join(runtime,'app.json'),JSON.stringify({pid:child.pid,url,startedAt:Date.now()}));
      const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code||0));});
      await releaseLock();process.exitCode=exitCode;
    }
  }
} catch(error) {
  console.error(`SlabSplit startup failed: ${error.message}`);
  await finish(1);
}
