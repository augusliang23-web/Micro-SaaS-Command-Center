import { spawn } from 'node:child_process';
import { EVIDENCE_REPO, EVIDENCE_REPO_ID, TASK, issueBody, validateRecord } from './contract.mjs';

// Existing authenticated gh session only; no shell, token inspection or configuration mutation.
function ghRequest(method,path,payload) {
  return new Promise((resolve,reject)=>{
    const args=['api','--hostname','github.com','--method',method,path];
    if(payload)args.push('--input','-');
    const env={...process.env,GH_PROMPT_DISABLED:'1',GH_PAGER:'cat'};
    delete env.GH_DEBUG;
    const child=spawn('gh',args,{env,stdio:['pipe','pipe','pipe']});
    let output='',bytes=0,failed=false;
    const fail=()=>{if(!failed){failed=true;child.kill('SIGTERM');reject(new Error('GITHUB_UNAVAILABLE'));}};
    const timer=setTimeout(fail,15000);
    child.stdout.on('data',data=>{bytes+=data.length;if(bytes>4*1024*1024)fail();else output+=data.toString();});
    child.stderr.resume(); // Never expose raw CLI diagnostics, which can contain local details.
    child.on('error',fail);
    child.on('close',code=>{
      clearTimeout(timer);if(failed)return;
      if(code!==0){fail();return;}
      try{resolve(JSON.parse(output));}catch{fail();}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(payload?JSON.stringify(payload):undefined);
  });
}
export function createGithubAdapter({request=ghRequest}={}) {
  async function identity(repo,id) {
    const r=await request('GET',`repos/${repo}`);
    if(r?.id!==id || r.full_name!==repo || r.html_url!==`https://github.com/${repo}` || r.default_branch!=='main')throw new Error('SOURCE_IDENTITY');
  }
  async function nativeComments(){
    await identity(EVIDENCE_REPO,EVIDENCE_REPO_ID);
    const issue=await request('GET',`repos/${EVIDENCE_REPO}/issues/107`);
    if(!validateRecord(issue)||issue.number!==107)throw new Error('TASK_RECORD_MISMATCH');
    const all=[];
    for(let page=1;page<=5;page++){
      const rows=await request('GET',`repos/${EVIDENCE_REPO}/issues/107/comments?per_page=100&page=${page}`);
      if(!Array.isArray(rows)||rows.length>100)throw new Error('INVALID_SOURCE');
      all.push(...rows);if(rows.length<100)return all;
    }throw new Error('PAGINATION_INCOMPLETE');
  }
  async function nativeComment(body){
    const result=await request('POST',`repos/${EVIDENCE_REPO}/issues/107/comments`,{body});
    if(!Number.isSafeInteger(result?.id)||result.id<1||result.user?.login!=='augusliang23-web'||result.body!==body||result.html_url!==`https://github.com/${EVIDENCE_REPO}/issues/107#issuecomment-${result.id}`)throw new Error('WRITE_UNCERTAIN');
    return {url:result.html_url};
  }
  return {
    async verifyNativeTarget(){
      await identity(TASK.target.repository,TASK.target.repositoryId);
      const main=await request('GET',`repos/${TASK.target.repository}/commits/main`);
      const pr=await request('GET',`repos/${TASK.target.repository}/pulls/96`);
      if(main?.sha!==TASK.target.baseSha||pr?.number!==96||pr.state!=='open'||pr.draft!==true||pr.merged!==false||pr.html_url!==`https://github.com/${TASK.target.repository}/pull/96`||pr.head?.sha!=='7953748dedc3c3381aacfe3b8e4f5407e280810b'||pr.head?.repo?.id!==TASK.target.repositoryId||pr.base?.sha!==TASK.target.baseSha)throw new Error('NATIVE_TARGET_DRIFT');
    },
    async reserveNativeJob(jobId,grant){
      if(jobId!=='zc-native-pm-pilot-01'||grant?.grantId!=='github-cc-issue-108-owner-native-pilot')throw new Error('GRANT_MISMATCH');
      const rows=await nativeComments();
      if(rows.some(x=>typeof x.body==='string'&&x.body.includes(`<!-- zc-job:${jobId} -->`)))throw new Error('EXISTING_GITHUB_RESERVATION');
      return nativeComment(`<!-- zc-job:${jobId} -->\n\nNative pilot reservation, not approval.\n\n\`\`\`json\n${JSON.stringify({schema:'zc.job/v1',jobId,taskId:TASK.taskId,grant,state:'RESERVED',ownerUat:'PENDING'})}\n\`\`\``);
    },
    async publishNativeJob(state){
      if(state?.jobId!=='zc-native-pm-pilot-01'||state?.taskId!==TASK.taskId||state?.result?.tree!=='f421278d6eb5bdd12f0adbaaa9634a70e45f5104')throw new Error('RESULT_SCOPE_MISMATCH');
      await nativeComments();
      const evidence={schema:'zc.job/v1',jobId:state.jobId,taskId:state.taskId,grantId:state.grantId,state:'DELIVERED_FOR_REVIEW',native:state.native,result:state.result,events:state.events,ownerUat:'PENDING',mergeDeploy:'NOT_AUTHORIZED'};
      return nativeComment(`<!-- zc-job:${state.jobId} -->\n\n## Real native subscription pilot evidence\n\nNative coding agent produced a bounded CSS proposal; the controller applied it in an isolated branch and ran the existing offline tests. Exact source tree matches existing [PM Draft PR #96](https://github.com/${TASK.target.repository}/pull/96), reused without duplicate PR or push. This is one real foreground dispatch, not an arbitrary-task daemon. Independent adapter review and owner UAT remain separate.\n\n\`\`\`json\n${JSON.stringify(evidence,null,2)}\n\`\`\``);
    },
    async list() {
      await identity(EVIDENCE_REPO,EVIDENCE_REPO_ID);
      const all=[];
      for(let page=1;page<=5;page++) {
        const rows=await request('GET',`repos/${EVIDENCE_REPO}/issues?state=all&per_page=100&page=${page}`);
        if(!Array.isArray(rows)||rows.length>100)throw new Error('INVALID_SOURCE');
        all.push(...rows);
        if(rows.length<100)return all;
      }
      throw new Error('PAGINATION_INCOMPLETE');
    },
    async checkBase() {
      await identity(TASK.target.repository,TASK.target.repositoryId);
      const commit=await request('GET',`repos/${TASK.target.repository}/commits/main`);
      if(commit?.sha!==TASK.target.baseSha)throw new Error('BASE_DRIFT');
    },
    async create() {
      await identity(EVIDENCE_REPO,EVIDENCE_REPO_ID);
      return request('POST',`repos/${EVIDENCE_REPO}/issues`,{title:TASK.title,body:issueBody()});
    },
  };
}
