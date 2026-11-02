import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {TASK} from './contract.mjs';

export const BEFORE='@media (prefers-reduced-motion: reduce) { #productionWeekSyncSpinner { animation:none; } }';
export const AFTER='@media (prefers-reduced-motion: reduce) { #productionWeekSyncSpinner, .spinner, .async-action-spinner { animation:none; } }';
export const NATIVE_BINARY='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const toml=v=>v&&typeof v==='object'?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+toml(x)).join(',')+'}':JSON.stringify(v);
const disabledFeatures=['memories','js_repl','remote_plugin','remote_control','tool_suggest','codex_apps_mcp_2026_07_28','mcp_2026_07_28','auth_elicitation'];
export function buildNativeSpec(cwd,sourceEnvironment=process.env){
  const env=Object.fromEntries(['HOME','PATH','TMPDIR','USER','LOGNAME','LANG','SHELL'].filter(k=>typeof sourceEnvironment[k]==='string').map(k=>[k,sourceEnvironment[k]]));
  const config={
    'analytics.enabled':false,'forced_login_method':'chatgpt','model_provider':'openai','approval_policy':'on-request',
    'default_permissions':'zc-patch','permissions.zc-patch.extends':':read-only',
    'permissions.zc-patch.filesystem':{':root':'deny',':minimal':'read',':tmpdir':'deny',':slash_tmp':'deny',':workspace_roots':{'.':'read'}},
    'permissions.zc-patch.network.enabled':false,'mcp_servers.node_repl.enabled':false,'mcp_servers.computer-use.enabled':false,'web_search':'disabled',
    ...Object.fromEntries(disabledFeatures.map(x=>['features.'+x,false])),
  };
  return {command:NATIVE_BINARY,args:[...Object.entries(config).flatMap(([k,v])=>['-c',`${k}=${toml(v)}`]),'app-server','--stdio'],cwd,env};
}
export function checkNativeEligibility({account,models,limits}){
  if(account?.account?.type!=='chatgpt')throw new Error('NATIVE_CHATGPT_REQUIRED');
  const model=models?.data?.find(x=>x.model==='gpt-6-luna');
  if(!model?.supportedReasoningEfforts?.some(x=>x.reasoningEffort==='low'))throw new Error('MODEL_UNAVAILABLE');
  if(limits?.ordinaryUsageAllowed!==true)throw new Error('INCLUDED_USAGE_NOT_CONFIRMED');
  const buckets=[limits.rateLimits,...Object.values(limits.rateLimitsByLimitId??{})].filter(Boolean);
  if(buckets.some(x=>x.spendControlReached===true||x.rateLimitReachedType!=null))throw new Error('SUBSCRIPTION_SPEND_OR_USAGE_DENIED');
  const windows=buckets.flatMap(x=>[x.primary,x.secondary]);
  if(windows.some(x=>!x||typeof x.usedPercent!=='number'||x.usedPercent<0||x.usedPercent>=100))throw new Error('SUBSCRIPTION_QUOTA_UNAVAILABLE');
}
export const isToolItem=type=>!['userMessage','agentMessage','reasoning'].includes(type);
export function validatePatch(patch,source){
  if(!isDeepStrictEqual(patch,{path:'index.html',oldText:BEFORE,newText:AFTER}) || typeof source!=='string' || source.split(BEFORE).length!==2)throw new Error('PATCH_SCOPE_MISMATCH');
  return source.replace(BEFORE,AFTER);
}

// Adapter-only native handles never appear in the public task/job/event protocol.
export class NativeSession{
  constructor(cwd,{spawnImpl=spawn}={}){
    const spec=buildNativeSpec(cwd);this.seq=0;this.pending=new Map();this.onMessage=()=>{};this.failure=null;
    this.child=spawnImpl(spec.command,spec.args,{cwd:spec.cwd,env:spec.env,shell:false,detached:true,stdio:['pipe','pipe','pipe']});
    this.exited=new Promise(resolve=>this.child.on('exit',()=>{this.fail('NATIVE_EXITED');resolve();}));
    this.child.stderr.resume();this.child.stdin.on('error',()=>{});
    this.child.on('error',()=>this.fail('NATIVE_SPAWN_FAILED'));
    let bytes=0;
    readline.createInterface({input:this.child.stdout}).on('line',line=>{
      bytes+=Buffer.byteLength(line);if(bytes>2*1024*1024){this.fail('NATIVE_OUTPUT_LIMIT');return;}
      let m;try{m=JSON.parse(line);}catch{this.fail('NATIVE_PROTOCOL_ERROR');return;}
      if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error('NATIVE_RPC_FAILED')):p.resolve(m.result);}}
      else if(m.id!==undefined&&m.method){this.fail('NATIVE_PERMISSION_REQUEST');}
      else if(m.method==='error')this.fail(m.params?.willRetry===true?'NATIVE_RETRY_BLOCKED':'NATIVE_TURN_ERROR');
      else this.onMessage(m);
    });
  }
  fail(code){
    if(!this.failure)this.failure=new Error(code);
    if(this.child.pid){try{process.kill(-this.child.pid,'SIGTERM');}catch{}}
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(this.failure);}this.pending.clear();
    this.onFailure?.(this.failure);
  }
  request(method,params={}){
    if(this.failure)return Promise.reject(this.failure);
    return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('NATIVE_RPC_TIMEOUT'));},20000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  }
  async initialize(){
    await this.request('initialize',{clientInfo:{name:'zc-native-patch-adapter',version:'1.0.0'}});
    this.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  }
  async close(){
    this.child.stdin.end();
    const kill=signal=>{try{process.kill(-this.child.pid,signal);}catch{}};
    await Promise.race([this.exited,new Promise(resolve=>setTimeout(resolve,300))]);
    // The leader may exit while its descendants remain in our private group.
    kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,150));kill('SIGKILL');
    await Promise.race([this.exited,new Promise(resolve=>setTimeout(resolve,300))]);
  }
}

export async function produceNativePatch({cwd,source,onProgress=()=>{}}){
  if(source.split(BEFORE).length!==2)throw new Error('SOURCE_DRIFT');
  const session=new NativeSession(cwd);
  try{
    await session.initialize();
    const account=await session.request('account/read',{refreshToken:false});
    const config=await session.request('config/read',{includeLayers:false,cwd});
    if(config.config?.forced_login_method!=='chatgpt'||config.config?.model_provider!=='openai'||config.config?.web_search!=='disabled'||disabledFeatures.some(k=>config.config?.features?.[k]!==false))throw new Error('NATIVE_CONFIG_MISMATCH');
    const models=await session.request('model/list',{limit:100,includeHidden:false});
    const limits=await session.request('account/rateLimits/read');
    checkNativeEligibility({account,models,limits});
    const thread=await session.request('thread/start',{cwd,model:'gpt-6-luna',modelProvider:'openai',approvalPolicy:'on-request',ephemeral:true,config:{model_reasoning_effort:'low'},developerInstructions:'You are a bounded patch producer. Return only the requested JSON patch. No tools, filesystem actions, commands, MCP, browser, permissions or external calls. The controller applies and verifies your proposal.'});
    if(thread.model!=='gpt-6-luna'||thread.modelProvider!=='openai')throw new Error('MODEL_OR_PROVIDER_MISMATCH');
    let output='',settle,reject;const itemTypes=[];const done=new Promise((yes,no)=>{settle=yes;reject=no;});done.catch(()=>{});
    session.onFailure=reject;
    session.onMessage=m=>{
      if(m.method==='model/rerouted'){session.fail('MODEL_REROUTED');return;}
      if(m.method==='item/started'){
        const type=m.params?.item?.type;itemTypes.push(type??'UNKNOWN');
        if(isToolItem(type)){session.fail('UNEXPECTED_NATIVE_TOOL');return;}
      }
      if(m.method==='item/agentMessage/delta')output+=m.params?.delta??'';
      if(output.length>16000){session.fail('PATCH_OUTPUT_LIMIT');return;}
      if(m.method==='turn/completed')settle(m.params?.turn);
    };
    const prompt=`Agent: Codex\nModel: GPT-6 Luna\nReasoning/Effort: Low\n\nWhy this route:\nOne tiny deterministic CSS patch needs no tools.\n\nGoal:\n${TASK.scope.goal}\n\nScope / Constraints:\nReturn one JSON patch for index.html only. Expand the existing reduced-motion rule to include .spinner and .async-action-spinner; retain #productionWeekSyncSpinner. Preserve every other byte. No tool calls or side effects.\n\nTask data:\n${JSON.stringify(TASK)}\n\nExact existing CSS line:\n${BEFORE}\n\nAcceptance / Required validation:\nOnly propose the patch; controller runs browser tests and independent QA.\n\nSafety / Production Boundary:\nNo commands, GitHub, credentials, provider changes, merge or deploy.\n\nExpected output:\nJSON with path, oldText and newText.`;
    await onProgress({kind:'MODEL_REQUESTED',worker:'codex-native',model:'gpt-6-luna',effort:'low',accountMode:'chatgpt'});
    await session.request('turn/start',{threadId:thread.thread.id,model:'gpt-6-luna',effort:'low',input:[{type:'text',text:prompt}],outputSchema:{type:'object',properties:{path:{type:'string'},oldText:{type:'string'},newText:{type:'string'}},required:['path','oldText','newText'],additionalProperties:false}});
    let timer;const terminal=await Promise.race([done,new Promise((_,no)=>{timer=setTimeout(()=>no(new Error('NATIVE_TURN_DEADLINE')),120000);})]).finally(()=>clearTimeout(timer));
    if(terminal?.status!=='completed')throw new Error('NATIVE_TURN_FAILED');
    let patch;try{patch=JSON.parse(output);}catch{throw new Error('INVALID_PATCH_JSON');}
    validatePatch(patch,source);
    return {patch,model:'gpt-6-luna',effort:'low',accountMode:'chatgpt',itemTypes,toolTypes:itemTypes.filter(isToolItem)};
  }finally{await session.close();}
}
