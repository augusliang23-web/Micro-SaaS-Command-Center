import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// NO model invocation, token read, permission change, GitHub write, or task claim.
// Only static CLI interface detection. It is not a sandbox or authentication proof.
const SCHEMA='zc.anti.preflight/v1';
const flags=['--print','--output-format','--sandbox'];
const reasons=new Set(['UNSUPPORTED_HOST','UNSAFE_PATH','CLI_MISSING_OR_FAILED','CLI_VERSION_UNRECOGNIZED','CLI_FLAGS_MISSING','CLI_INTERFACE_DETECTED']);
function report(reason,version=null,advertised=[]){
  if(!reasons.has(reason))throw new Error('INTERNAL_REASON_UNKNOWN');
  return Object.freeze({
    schema:SCHEMA,
    gate:reason==='CLI_INTERFACE_DETECTED'?'CLI_INTERFACE_DETECTED':'HOLD',
    reason,
    version,
    flags:Object.freeze(Object.fromEntries(flags.map(x=>[x,advertised.includes(x)]))),
    isolation:'UNVERIFIED',
    authentication:'UNVERIFIED',
    subscriptionQuota:'UNVERIFIED',
    trustedGrant:'NOT_GRANTED',
    worker:'NOT_CONNECTED',
    dispatch:'HOLD',
    modelCalls:0,
    gitHubWrites:0,
    readyToCode:false
  });
}
export function assessAntiCli({platform=process.platform, env=process.env, exec=execFileSync}={}){
  if(platform!=='darwin')return report('UNSUPPORTED_HOST');
  // Never resolve an executable from an empty/relative PATH entry, including CWD.
  // This is not CLI binary attestation; operator must still trust installed agy.
  const pathEntries=typeof env.PATH==='string'?env.PATH.split(':'):[];
  if(!pathEntries.length||pathEntries.some(p=>!p.startsWith('/')||p==='/'||p.includes('/../')||p.endsWith('/..')||p.includes('/./')||p.endsWith('/.')))
    return report('UNSAFE_PATH');
  const allowedEnv=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
  const run=arg=>exec('agy',[arg],{
    encoding:'utf8',shell:false,timeout:5000,maxBuffer:64*1024,
    windowsHide:true,env:allowedEnv,stdio:['ignore','pipe','pipe']
  });
  let versionText,help;
  try{
    versionText=run('--version');
    help=run('--help');
    if(typeof versionText!=='string'||typeof help!=='string'||help.length>64*1024)throw new Error('OUTPUT_INVALID');
  }catch{return report('CLI_MISSING_OR_FAILED');}
  // Do not echo CLI logs or absolute paths; only a bounded semantic version.
  const match=versionText.match(/\b(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,32})?)\b/);
  if(!match)return report('CLI_VERSION_UNRECOGNIZED');
  const advertised=flags.filter(x=>help.includes(x));
  if(advertised.length!==flags.length)return report('CLI_FLAGS_MISSING',match[1],advertised);
  return report('CLI_INTERFACE_DETECTED',match[1],advertised);
}
export function formattedPreflight(value){
  // A future bridge must never serialize a forged ready/authorized result.
  if(!value||value.schema!==SCHEMA||!reasons.has(value.reason)||
    value.readyToCode!==false||value.dispatch!=='HOLD'||value.worker!=='NOT_CONNECTED'||
    value.isolation!=='UNVERIFIED'||value.authentication!=='UNVERIFIED'||
    value.subscriptionQuota!=='UNVERIFIED'||value.trustedGrant!=='NOT_GRANTED'||
    value.modelCalls!==0||value.gitHubWrites!==0)
    throw new Error('INVALID_PREFLIGHT');
  return JSON.stringify(value)+'\n';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=assessAntiCli();
  process.stdout.write(formattedPreflight(result));
  // Interface detected is NOT execution authorization. Missing CLI is a safe HOLD.
  if(result.gate==='HOLD')process.exitCode=2;
}
