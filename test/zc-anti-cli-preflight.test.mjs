import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAntiCli,formattedPreflight} from '../tools/zc-anti/cli-preflight.mjs';

const ver='Antigravity CLI v1.4.4\n';
const help='  -p, --print <prompt>   --output-format [text|json|stream-json]   --sandbox\n';
function fixture({version=ver,helpText=help,failAt=null,versionToStderr=false,helpToStderr=false,nonzeroAt=null,signalAt=null}={}){
  const calls=[];
  const exec=(command,args,options)=>{
    calls.push({command,args,options});
    if(args[0]===failAt)throw new Error('secret local terminal trace');
    const isVersion=args[0]==='--version',value=isVersion?version:helpText;
    if(value===null)return {status:0,stdout:null,stderr:null};
    const useStderr=isVersion?versionToStderr:helpToStderr;
    return {
      status:args[0]===nonzeroAt?2:0,
      signal:args[0]===signalAt?'SIGTERM':null,
      error:null,
      stdout:useStderr?'':value,
      stderr:useStderr?value:''
    };
  };
  const env={PATH:'/usr/local/bin:/usr/bin',HOME:'/Users/private-owner',OPENAI_API_KEY:'private-token',GH_TOKEN:'secret',TMPDIR:'/private/tmp',LANG:'en_US.UTF-8'};
  return {calls,exec,env};
}
test('unsupported host stops before attempting to run a CLI',()=>{
  const f=fixture();const result=assessAntiCli({platform:'linux',env:f.env,exec:f.exec});
  assert.equal(result.reason,'UNSUPPORTED_HOST');
  assert.equal(result.readyToCode,false);assert.deepEqual(f.calls,[]);
});
test('Mac CLI help+version are interface evidence, NOT authorization',()=>{
  const f=fixture();const result=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(result.gate,'CLI_INTERFACE_DETECTED');
  assert.equal(result.version,'v1.4.4');
  assert.deepEqual(result.flags,{'--print':true,'--output-format':true,'--sandbox':true});
  assert.equal(result.isolation,'UNVERIFIED');assert.equal(result.authentication,'UNVERIFIED');
  assert.equal(result.subscriptionQuota,'UNVERIFIED');assert.equal(result.trustedGrant,'NOT_GRANTED');
  assert.equal(result.worker,'NOT_CONNECTED');assert.equal(result.dispatch,'HOLD');
  assert.equal(result.readyToCode,false);
  assert.equal(result.modelCalls,0);assert.equal(result.gitHubWrites,0);
});
test('only exactly two fixed non-model CLI probes are invoked, never shell',()=>{
  const f=fixture();assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.deepEqual(f.calls.map(x=>[x.command,x.args]),[['agy',['--version']],['agy',['--help']]]);
  assert.ok(f.calls.every(x=>x.options.shell===false&&x.options.timeout===5000));
  assert.ok(f.calls.every(x=>x.options.stdio[0]==='ignore'));
});
test('secrets and unrelated environment variables are not inherited by the probe',()=>{
  const f=fixture();assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.deepEqual(Object.keys(f.calls[0].options.env).sort(),['HOME','LANG','PATH','TMPDIR']);
  assert.ok(!JSON.stringify(f.calls).includes('private-token'));
  assert.ok(!JSON.stringify(f.calls).includes('GH_TOKEN'));
});
test('relative, empty or traversal PATH entries cannot select a local spoofed agy',()=>{
  for(const path of ['.:/usr/bin','/usr/bin:','/usr/bin::/bin','./node_modules/.bin:/usr/bin','../bin:/usr/bin','/usr/bin/../tmp','/','']){
    const f=fixture();f.env.PATH=path;
    const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
    assert.equal(r.gate,'HOLD');
    assert.equal(r.reason,'UNSAFE_PATH');
    assert.deepEqual(f.calls,[]);
  }
});
test('owner reproduced agy help on stderr: 0 stdout, 3048 stderr, all flags detect',()=>{
  const f=fixture({helpToStderr:true,version:'agy version 1.4.12\n'});
  const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(r.gate,'CLI_INTERFACE_DETECTED');
  assert.equal(r.version,'1.4.12');
  assert.deepEqual(r.flags,{'--print':true,'--output-format':true,'--sandbox':true});
  assert.equal(r.dispatch,'HOLD');
  assert.equal(r.readyToCode,false);
});
test('version may also be printed to stderr without exposing its raw content',()=>{
  const f=fixture({versionToStderr:true,helpToStderr:true,version:'agy v1.4.12 key=SECRET_123\n'});
  const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(r.gate,'CLI_INTERFACE_DETECTED');
  assert.equal(r.version,'v1.4.12');
  assert.ok(!formattedPreflight(r).includes('SECRET_123'));
});
test('nonzero process exit, terminated probe, and oversized stderr all fail closed',()=>{
  for(const opts of [
    {nonzeroAt:'--help'},
    {signalAt:'--help'},
    {helpToStderr:true,helpText:'x'.repeat(65536)}
  ]){
    const f=fixture(opts);
    const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
    assert.equal(r.gate,'HOLD');
    assert.equal(r.reason,'CLI_MISSING_OR_FAILED');
  }
});
test('missing CLI is fail-closed and no CLI error is exposed',()=>{
  const f=fixture({failAt:'--version'});const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(r.gate,'HOLD');assert.equal(r.reason,'CLI_MISSING_OR_FAILED');
  assert.ok(!formattedPreflight(r).includes('terminal trace'));
});
test('help invocation failing is fail-closed even if version succeeded',()=>{
  const f=fixture({failAt:'--help'});const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(r.gate,'HOLD');assert.equal(f.calls.length,2);
});
test('unknown version cannot be represented as a supported CLI',()=>{
  const f=fixture({version:'some path /Users/private-owner/no-version\n'});
  const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  assert.equal(r.reason,'CLI_VERSION_UNRECOGNIZED');assert.equal(r.version,null);
});
test('every required CLI option must appear in help output',()=>{
  for(const flag of ['--print','--output-format','--sandbox']){
    const f=fixture({helpText:help.replace(flag,'NOT_SUPPORTED')});
    const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
    assert.equal(r.reason,'CLI_FLAGS_MISSING');assert.equal(r.flags[flag],false);
  }
});
test('null and unbounded help are rejected rather than trusted',()=>{
  for(const helpText of [null,'a'.repeat(65*1024)]){
    const f=fixture({helpText});const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
    assert.equal(r.reason,'CLI_MISSING_OR_FAILED');
  }
});
test('CLI stdout could contain secrets but response only includes version',()=>{
  const f=fixture({version:'path=/Users/private-owner/secret CLI v2.15.0 token=SECRET_ABC'});
  const r=assessAntiCli({platform:'darwin',env:f.env,exec:f.exec});
  const out=formattedPreflight(r);
  assert.equal(r.version,'v2.15.0');assert.ok(!out.includes('SECRET_ABC'));
  assert.ok(!out.includes('/Users/private-owner'));
});
test('the result is machine-readable with one JSON line',()=>{
  const f=fixture();const out=formattedPreflight(assessAntiCli({platform:'darwin',env:f.env,exec:f.exec}));
  assert.ok(out.endsWith('\n'));assert.equal(out.split('\n').length,2);
  const parsed=JSON.parse(out);assert.equal(parsed.schema,'zc.anti.preflight/v1');
  assert.equal(parsed.readyToCode,false);
});
test('serialized preflight evidence cannot be promoted to worker-ready by a consumer',()=>{
  const x=assessAntiCli({platform:'darwin',env:fixture().env,exec:fixture().exec});
  for(const change of [
    y=>y.readyToCode=true,
    y=>y.dispatch='RUN',
    y=>y.worker='CONNECTED',
    y=>y.isolation='PASS',
    y=>y.authentication='PASS',
    y=>y.subscriptionQuota='PASS',
    y=>y.trustedGrant='GRANTED',
    y=>y.modelCalls=1,
    y=>y.gitHubWrites=1,
    y=>y.reason='VERIFIED'
  ]){
    const altered=structuredClone(x);change(altered);
    assert.throws(()=>formattedPreflight(altered),/INVALID_PREFLIGHT/);
  }
});
test('an incorrectly shaped report cannot be serialized as authoritative',()=>{
  assert.throws(()=>formattedPreflight({gate:'CLI_INTERFACE_DETECTED'}),/INVALID_PREFLIGHT/);
});
