import {mkdir,open,readFile,lstat,realpath,writeFile,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {constants} from 'node:fs';
import {TASK} from './contract.mjs';
import {validatePatch,produceNativePatch} from './nativeClient.mjs';

const exec=promisify(execFile);
export const JOB_ID='zc-native-pm-pilot-01';
export const PM_HEAD='7953748dedc3c3381aacfe3b8e4f5407e280810b';
export const PM_TREE='f421278d6eb5bdd12f0adbaaa9634a70e45f5104';
const PM_SOURCE='/private/tmp/zc-pilot-pm-source';
const DEPS='/Users/augusliang/Developer/worktrees/p1-hist-pr92-local-20261101/node_modules';
const allowedFiles=['index.html','tests/zc-pilot-reduced-motion.test.mjs','tests/helpers/p1-bc-source-baseline.mjs'];
export const GRANT=Object.freeze({schema:'zc.authorization/v1',grantId:'github-cc-issue-108-owner-native-pilot',taskId:TASK.taskId,repository:TASK.target.repository,baseSha:TASK.target.baseSha,capabilities:['native:patch-proposal','source:exact-css-apply','offline:browser-test','github:job-evidence','draft-pr:reuse-exact-tree'],maxJobs:1,maxFixAttempts:2,automaticRedispatches:0});

export async function createNativeJob({root,enabled=false,ops}){
  await mkdir(root,{recursive:true,mode:0o700});
  const stat=await lstat(root);
  if(stat.isSymbolicLink()||!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)throw new Error('UNSAFE_JOB_DIRECTORY');
  root=await realpath(root);
  let fd=null,work=null,starting=null,reserved=false,recordQueue=Promise.resolve();
  try{await lstat(root+'/journal.jsonl');reserved=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  let state={schema:'zc.job/v1',jobId:JOB_ID,taskId:TASK.taskId,grantId:GRANT.grantId,state:reserved?'HOLD':'NOT_STARTED',reason:reserved?'EXISTING_RESERVATION':null,enabled,worker:'NOT_CONNECTED',ownerUat:'PENDING',events:[],result:null};
  if(reserved){
    // Read completed evidence for display only; never resume a provider automatically.
    let reader;
    try{
      reader=await open(root+'/journal.jsonl',constants.O_RDONLY|constants.O_NOFOLLOW);
      const info=await reader.stat();
      if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o077)!==0||info.size>256*1024)throw new Error('UNSAFE_JOURNAL');
      const lines=(await reader.readFile('utf8')).trim().split('\n');const last=JSON.parse(lines.at(-1));
      if(last.schema==='zc.job/v1'&&last.jobId===JOB_ID&&last.taskId===TASK.taskId&&last.grantId===GRANT.grantId&&last.state==='DELIVERED'&&last.result?.tree===PM_TREE)state={...last,enabled};
    }catch{}finally{await reader?.close();}
  }
  const snapshot=()=>structuredClone(state);
  function record(kind,extra={}){
    recordQueue=recordQueue.then(async()=>{
      state={...state,...extra,events:[...state.events,{schema:'zc.event/v1',eventId:`${JOB_ID}-${state.events.length+1}`,jobId:JOB_ID,taskId:TASK.taskId,revision:state.events.length+1,kind,observedAt:new Date().toISOString()}]};
      await fd.write(JSON.stringify(state)+'\n');await fd.sync();
    });return recordQueue;
  }
  async function execute(){
    try{
      await ops.verify();await record('SOURCE_VERIFIED',{state:'RESERVING'});
      const reservation=await ops.reserve();await record('JOB_RESERVED',{reservationUrl:reservation.url,state:'PREPARING'});
      const context=await ops.prepare(root);await record('ISOLATED_SOURCE_PREPARED',{state:'CODING',worker:'NATIVE_SESSION_STARTING'});
      const generated=await ops.produce(context,event=>record(event.kind,{worker:'NATIVE_SESSION_ACTIVE'}));
      if(generated.toolTypes?.length)throw new Error('UNEXPECTED_NATIVE_TOOL');
      const updated=validatePatch(generated.patch,context.source);
      await record('PATCH_PROPOSED',{state:'TESTING',worker:'NATIVE_SESSION_COMPLETED',native:{model:generated.model,effort:generated.effort,accountMode:generated.accountMode??'chatgpt',itemTypes:generated.itemTypes??[],toolTypes:generated.toolTypes??[]}});
      const result=await ops.applyAndTest(context,updated);
      if(result.tree!==PM_TREE||result.tests!=='PASS'||result.prUrl!=='https://github.com/augusliang23-web/pm-dashboard/pull/96')throw new Error('RESULT_SCOPE_MISMATCH');
      await record('SOURCE_EDITED_AND_TESTED',{state:'PUBLISHING',result});
      const evidence=await ops.publish(snapshot());
      await record('DELIVERY_EVIDENCE_RECORDED',{state:'DELIVERED',evidenceUrl:evidence.url});
    }catch(error){await record('HOLD',{state:'HOLD',worker:'STOPPED_OR_UNKNOWN',reason:/^[A-Z][A-Z0-9_]{2,80}$/.test(error?.message??'')?error.message:'NATIVE_JOB_UNCERTAIN'});}
    finally{await fd?.close();fd=null;}
  }
  return {status:snapshot,wait:()=>work??Promise.resolve(),async start(){
    if(!enabled)throw new Error('NATIVE_CAPABILITY_DISABLED');
    if(reserved&&state.state==='HOLD')throw new Error('EXISTING_RESERVATION');
    if(work)return snapshot();
    if(starting){await starting;return snapshot();}
    if(reserved)throw new Error('EXISTING_RESERVATION');
    starting=(async()=>{
      try{fd=await open(root+'/journal.jsonl','wx',0o600);}catch{reserved=true;state={...state,state:'HOLD',reason:'EXISTING_RESERVATION'};throw new Error('EXISTING_RESERVATION');}
      reserved=true;await record('LOCAL_RESERVATION_CREATED',{state:'VERIFYING'});work=execute().catch(()=>{state={...state,state:'HOLD',reason:'JOURNAL_WRITE_FAILED'};});return snapshot();
    })();return starting;
  }};
}

async function git(cwd,args){
  return (await exec('/usr/bin/git',['-c','core.hooksPath=/dev/null',...args],{cwd,timeout:20000,maxBuffer:4*1024*1024,env:{PATH:'/usr/bin:/bin',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}})).stdout;
}
export function createNativeOperations({github,intake}){
  return {
    async verify(){
      const record=await intake.read();if(record.issue?.number!==107)throw new Error('TASK_RECORD_MISMATCH');
      await github.verifyNativeTarget();
      if(await realpath(PM_SOURCE)!==PM_SOURCE || (await lstat(PM_SOURCE)).isSymbolicLink())throw new Error('SOURCE_PATH_MISMATCH');
      if((await git(PM_SOURCE,['status','--porcelain'])).trim())throw new Error('DIRTY_SOURCE');
      if((await git(PM_SOURCE,['remote','get-url','origin'])).trim()!=='https://github.com/augusliang23-web/pm-dashboard.git')throw new Error('SOURCE_REMOTE_MISMATCH');
      if((await git(PM_SOURCE,['rev-parse','HEAD'])).trim()!==PM_HEAD)throw new Error('SOURCE_HEAD_MISMATCH');
    },
    reserve:()=>github.reserveNativeJob(JOB_ID,GRANT),
    async prepare(root){
      const cwd=path.join(root,'checkout');
      await git(root,['clone','--no-hardlinks','--no-checkout',PM_SOURCE,cwd]);
      await git(cwd,['checkout','-b','codex/zc-pilot-native-proof',TASK.target.baseSha]);
      for(const file of allowedFiles.slice(1))await writeFile(path.join(cwd,file),await git(cwd,['show',`${PM_HEAD}:${file}`]));
      return {cwd,source:await readFile(path.join(cwd,'index.html'),'utf8')};
    },
    produce:(context,onProgress)=>produceNativePatch({...context,onProgress}),
    async applyAndTest(context,updated){
      await writeFile(path.join(context.cwd,'index.html'),updated);
      await symlink(DEPS,path.join(context.cwd,'node_modules'));
      const {stdout}=await exec('/opt/homebrew/opt/node@22/bin/node',['--test','tests/zc-pilot-reduced-motion.test.mjs'],{cwd:context.cwd,timeout:30000,maxBuffer:32768,env:{PATH:'/usr/bin:/bin',HOME:context.cwd,TMPDIR:context.cwd, PUPPETEER_EXECUTABLE_PATH:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}});
      if(!/^# fail 0$/m.test(stdout)||!/^# pass 2$/m.test(stdout))throw new Error('OFFLINE_TEST_FAILED');
      const files=(await git(context.cwd,['diff','--name-only'])).trim().split('\n').filter(Boolean);
      if(files.some(file=>!allowedFiles.includes(file)))throw new Error('SOURCE_SCOPE_DRIFT');
      await git(context.cwd,['add','--',...allowedFiles]);
      if((await git(context.cwd,['write-tree'])).trim()!==PM_TREE)throw new Error('TREE_MISMATCH');
      await git(context.cwd,['-c','user.name=ZC Native Pilot','-c','user.email=zc-native-pilot@localhost','commit','-m','Verify native PM reduced-motion pilot']);
      return {commit:(await git(context.cwd,['rev-parse','HEAD'])).trim(),tree:PM_TREE,tests:'PASS',testSummary:'2 offline browser/guard tests passed',prUrl:'https://github.com/augusliang23-web/pm-dashboard/pull/96',prReused:true,sourceBranch:'codex/zc-pilot-native-proof',release:'NOT_AUTHORIZED'};
    },
    publish:state=>github.publishNativeJob(state),
  };
}
