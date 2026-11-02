import { TASK, validateRecord } from './contract.mjs';

export function createIntakeService({github,allowWrite=false}) {
  let queue=Promise.resolve(), uncertain=false;
  async function read() {
    const rows=await github.list();
    if(!Array.isArray(rows))throw new Error('INVALID_SOURCE');
    const matches=rows.filter(x=>x?.title===TASK.title || (typeof x?.body==='string' && x.body.includes(TASK.idempotencyKey)));
    if(matches.length>1)throw new Error('DUPLICATE_RECORDS');
    const issue=matches[0]??null;
    if(issue && !validateRecord(issue))throw new Error('INVALID_RECORD');
    if(issue)uncertain=false;
    const checkedAt=new Date().toISOString();
    return {
      schema:'zc.status/v1', taskId:TASK.taskId, revision:issue?1:0,
      intake:issue?'RECORDED':uncertain?'WRITE_UNCERTAIN':'NOT_CREATED',
      worker:'NOT_CONNECTED',dispatch:'HOLD',implementation:'NOT_STARTED',tests:'NOT_RUN',ownerUat:'PENDING',
      reason:'SECURE_WORKER_NOT_CONNECTED_ZC06C_SAME_UID_HOLD',
      source:'GitHub', checkedAt,
      issue:issue?{number:issue.number,url:issue.html_url,state:issue.state,updatedAt:issue.updated_at}:null,
      events:issue?[{schema:'zc.event/v1',eventId:`github-issue-${issue.number}-created`,taskId:TASK.taskId,revision:1,kind:'INTAKE_RECORDED',observedAt:checkedAt,occurredAt:issue.created_at,evidenceUrl:issue.html_url}]:[],
    };
  }
  function create() {
    const operation=queue.then(async()=>{
      if(!allowWrite)throw new Error('READ_ONLY');
      const prior=await read();
      if(prior.issue)return prior;
      if(uncertain)throw new Error('WRITE_UNCERTAIN');
      await github.checkBase();
      // Once the write starts, any uncertain result is quarantined. Never auto-retry.
      uncertain=true;
      try {
        const result=await github.create();
        if(!validateRecord(result))throw new Error('INVALID_RECORD');
        const verified=await read();
        if(!verified.issue || verified.issue.number!==result.number)throw new Error('READ_BACK_MISMATCH');
        return verified;
      } catch { uncertain=true;throw new Error('WRITE_UNCERTAIN'); }
    });
    queue=operation.catch(()=>{});
    return operation;
  }
  return {read,create,allowWrite};
}
