import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {verifyDetachedGrant} from '../tools/zc-bridge/grant-verifier.mjs';
import {TASK_MARKER,BRIDGE_REPO,BRIDGE_REPO_ID} from '../tools/zc-bridge/task-queue.mjs';

const NOW=Date.parse('2026-11-02T08:00:00.000Z');
const WORKER='anti-owner-mac-01';
const task=()=>({
  schema:'zc.task/v1',taskId:'zc-safe-pilot-02',
  repositoryId:BRIDGE_REPO_ID,repository:BRIDGE_REPO,baseSha:'a'.repeat(40),
  goal:'Change one minimal safe test fixture in a disposable environment',
  paths:['test/zc-example.test.mjs'],verificationSuite:'node22-offline-tests',
  limits:{maxMinutes:10,maxTurns:2,maxRetries:0}
});
const issue=t=>({number:123,state:'open',repository:{id:BRIDGE_REPO_ID,full_name:BRIDGE_REPO},
  html_url:`https://github.com/${BRIDGE_REPO}/issues/123`,
  body:TASK_MARKER+'\n```json\n'+JSON.stringify(t)+'\n```'});
const grant=t=>({
  schema:'zc.authorization/v1',grantId:'owner-approval-001',issueNumber:123,
  taskId:t.taskId,repositoryId:BRIDGE_REPO_ID,repository:BRIDGE_REPO,
  baseSha:t.baseSha,taskDigest:createHash('sha256').update(JSON.stringify(t)).digest('hex'),
  paths:t.paths,workerId:WORKER,maxMinutes:5,
  expiresAt:'2026-11-02T08:15:00.000Z',nonce:'f'.repeat(32)
});
function fixture(){
  const t=task(),g=grant(t),keys=generateKeyPairSync('ed25519');
  const signature=sign(null,Buffer.from(JSON.stringify(g)),keys.privateKey).toString('base64');
  return {t,g,keys,signature,input:{issue:issue(t),grant:g,signature,trustedPublicKey:keys.publicKey,workerId:WORKER,nowMs:NOW}};
}
test('detached Ed25519 signature and scope match but execution remains HOLD',()=>{
  const f=fixture(),r=verifyDetachedGrant(f.input);
  assert.equal(r.reason,'CRYPTO_SIGNATURE_SCOPE_MATCH');
  assert.equal(r.cryptoScope,'MATCHED');
  assert.equal(r.ownerApproval,'NOT_VERIFIED');
  assert.equal(r.nonceReservation,'NOT_RESERVED');
  assert.equal(r.effectiveSandbox,'UNVERIFIED');
  assert.equal(r.worker,'NOT_CONNECTED');
  assert.equal(r.dispatch,'HOLD');
  assert.equal(r.readyToCode,false);
  assert.equal(r.modelCalls,0);assert.equal(r.gitHubWrites,0);
});
test('wrong repo, digest and task ID do not match a signed grant',()=>{
  for(const mutate of [
    g=>g.repositoryId=9,g=>g.repository='other/repo',
    g=>g.taskDigest='c'.repeat(64),g=>g.taskId='zc-other-job-01',
    g=>g.issueNumber=124
  ]){
    const f=fixture();mutate(f.input.grant);
    assert.equal(verifyDetachedGrant(f.input).cryptoScope,'HOLD');
  }
});
test('grant cannot elevate base SHA, allowed paths or time budget',()=>{
  for(const mutate of [
    g=>g.baseSha='b'.repeat(40),g=>g.paths=['test/another.test.mjs'],
    g=>g.maxMinutes=11
  ]){
    const f=fixture();mutate(f.input.grant);
    assert.equal(verifyDetachedGrant(f.input).reason,'GRANT_SCOPE_DRIFT');
  }
});
test('task must be admitted before detached grant verification',()=>{
  const f=fixture();f.input.issue.repository.id=9;
  assert.equal(verifyDetachedGrant(f.input).reason,'TASK_ADMISSION_REQUIRED');
});
test('expired, malformed or overly distant expiresAt is rejected',()=>{
  for(const expiresAt of [
    '2026-11-02T07:00:00.000Z','2026-11-02T12:00:00.000Z',
    '2026-13-02T08:10:00.000Z','2026-11-02T08:15:00Z'
  ]){
    const f=fixture();f.input.grant.expiresAt=expiresAt;
    assert.equal(verifyDetachedGrant(f.input).cryptoScope,'HOLD');
  }
});
test('the signing public key must be supplied out of band as Ed25519 public KeyObject',()=>{
  const f=fixture();
  for(const pub of [undefined,'maliciousIssueSuppliedPEM',f.keys.privateKey]){
    assert.equal(verifyDetachedGrant({...f.input,trustedPublicKey:pub}).reason,'SIGNER_OR_SIGNATURE_INVALID');
  }
});
test('a valid scope cannot be authenticated with a different public key',()=>{
  const f=fixture(),other=generateKeyPairSync('ed25519').publicKey;
  assert.equal(verifyDetachedGrant({...f.input,trustedPublicKey:other}).reason,'SIGNATURE_VERIFICATION_FAILED');
});
test('a fake, truncated, malformed or empty signature is rejected',()=>{
  const f=fixture();
  for(const signature of ['',undefined,'a'.repeat(88),'token=secret']){
    assert.equal(verifyDetachedGrant({...f.input,signature}).cryptoScope,'HOLD');
  }
});
test('a signature no longer validates if grant contents are edited',()=>{
  const f=fixture();
  f.input.grant.nonce='e'.repeat(32);
  assert.equal(verifyDetachedGrant(f.input).reason,'SIGNATURE_VERIFICATION_FAILED');
});
test('unsigned extra fields cannot turn into approvals',()=>{
  const f=fixture();f.input.grant.autoMerge=true;
  assert.equal(verifyDetachedGrant(f.input).reason,'GRANT_SHAPE_OR_BINDING_INVALID');
});
test('grant cannot nominate a different worker identity',()=>{
  const f=fixture();f.input.workerId='anti-other-mac-02';
  assert.equal(verifyDetachedGrant(f.input).reason,'GRANT_SHAPE_OR_BINDING_INVALID');
});
test('same signed nonce is NOT proof of replay-safe job reservation',()=>{
  const f=fixture(),a=verifyDetachedGrant(f.input),b=verifyDetachedGrant(f.input);
  assert.equal(a.reason,'CRYPTO_SIGNATURE_SCOPE_MATCH');
  assert.equal(b.reason,'CRYPTO_SIGNATURE_SCOPE_MATCH');
  assert.equal(a.nonceReservation,'NOT_RESERVED');
  assert.equal(b.nonceReservation,'NOT_RESERVED');
  assert.equal(a.dispatch,'HOLD');
});
