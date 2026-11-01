import { spawn } from 'node:child_process';
import { EVIDENCE_REPO, EVIDENCE_REPO_ID, TASK, issueBody } from './contract.mjs';

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
  return {
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
