import {verify as cryptoVerify} from 'node:crypto';
import {inspectTaskIssue,BRIDGE_REPO,BRIDGE_REPO_ID,TASK_MARKER} from './task-queue.mjs';

// OFFLINE detached Ed25519 signature and scope primitive ONLY.
// The caller MUST pin a trusted public key outside GitHub Issue data.
// No key generation, owner approval, durable nonce reservation or dispatch.
const required=['schema','grantId','issueNumber','taskId','repositoryId','repository',
  'baseSha','taskDigest','paths','workerId','maxMinutes','expiresAt','nonce'];
const fieldsMatch=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const isHex=(v,n)=>typeof v==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(v);
const validSlug=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{2,63}$/.test(x);
function result(reason,issue=null){
  return Object.freeze({
    schema:'zc.bridge.grant-check/v1',reason,issueNumber:issue,
    cryptoScope:reason==='CRYPTO_SIGNATURE_SCOPE_MATCH'?'MATCHED':'HOLD',
    signerIdentity:'NOT_ATTESTED',
    ownerApproval:'NOT_VERIFIED',
    nonceReservation:'NOT_RESERVED',
    effectiveSandbox:'UNVERIFIED',
    worker:'NOT_CONNECTED',dispatch:'HOLD',
    readyToCode:false,modelCalls:0,gitHubWrites:0
  });
}
export function verifyDetachedGrant({issue,grant,signature,trustedPublicKey,workerId,nowMs=Date.now()}={}){
  const admission=inspectTaskIssue(issue);
  if(admission.reason!=='TASK_DATA_VALID')
    return result('TASK_ADMISSION_REQUIRED');
  if(!fieldsMatch(grant,required)||grant.schema!=='zc.authorization/v1'||
     !validSlug(grant.grantId)||grant.issueNumber!==issue.number||
     grant.taskId!==admission.taskId||grant.repositoryId!==BRIDGE_REPO_ID||
     grant.repository!==BRIDGE_REPO||
     !isHex(grant.baseSha,40)||!isHex(grant.taskDigest,64)||
     grant.taskDigest!==admission.taskDigest||
     !Array.isArray(grant.paths)||grant.paths.length<1||grant.paths.length>8||
     grant.paths.some(p=>typeof p!=='string')||
     !validSlug(workerId)||grant.workerId!==workerId||
     !Number.isSafeInteger(grant.maxMinutes)||grant.maxMinutes<1||grant.maxMinutes>20||
     !isHex(grant.nonce,32)||typeof grant.expiresAt!=='string'||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(grant.expiresAt)||
     !Number.isFinite(nowMs)||!Number.isSafeInteger(nowMs))
    return result('GRANT_SHAPE_OR_BINDING_INVALID',issue.number);
  const task=JSON.parse(issue.body.slice((TASK_MARKER+'\n```json\n').length,-'\n```'.length).trim());
  if(grant.baseSha!==task.baseSha||
     grant.paths.length!==task.paths.length||grant.paths.some((p,i)=>p!==task.paths[i])||
     grant.maxMinutes>task.limits.maxMinutes)
    return result('GRANT_SCOPE_DRIFT',issue.number);
  const expires=Date.parse(grant.expiresAt);
  if(!Number.isFinite(expires)||new Date(expires).toISOString()!==grant.expiresAt||
     expires<=nowMs||expires>nowMs+60*60*1000)
    return result('GRANT_EXPIRED_OR_UNBOUNDED',issue.number);
  if(!trustedPublicKey||trustedPublicKey.type!=='public'||
     trustedPublicKey.asymmetricKeyType!=='ed25519'||
     typeof signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(signature))
    return result('SIGNER_OR_SIGNATURE_INVALID',issue.number);
  const signatureBytes=Buffer.from(signature,'base64');
  if(signatureBytes.length!==64||signatureBytes.toString('base64')!==signature)
    return result('SIGNATURE_ENCODING_INVALID',issue.number);
  let valid=false;
  try{
    valid=cryptoVerify(null,Buffer.from(JSON.stringify(grant)),trustedPublicKey,signatureBytes);
  }catch{valid=false;}
  if(!valid)return result('SIGNATURE_VERIFICATION_FAILED',issue.number);
  // Cryptographic success is not a trusted runtime grant:
  // caller's public key may be untrusted, nonce not atomically consumed,
  // no verified sandbox/identity/quota, so dispatch remains HOLD.
  return result('CRYPTO_SIGNATURE_SCOPE_MATCH',issue.number);
}
