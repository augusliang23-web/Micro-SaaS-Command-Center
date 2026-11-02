const $=id=>document.getElementById(id);
let session=null,last=null,busy=false,jobData=null,jobBusy=false,jobTimer=null;
const labels={NOT_CREATED:'尚未建立',RECORDED:'已記錄於 GitHub',WRITE_UNCERTAIN:'提交結果待核對',UNKNOWN:'來源暫時無法確認'};
const errors={READ_ONLY:'入口目前為唯讀。',BASE_DRIFT:'PM main 已變更，需重新檢查任務範圍。',WRITE_UNCERTAIN:'提交結果不確定，請重新查詢；系統不會自動重送。',DUPLICATE_RECORDS:'發現重複任務，暫停建立並保留證據。',INVALID_RECORD:'GitHub 任務內容與固定契約不符，已暫停。'};
function controls(){
  $('create').disabled=busy || !session?.allowWrite || last?.intake!=='NOT_CREATED';
  $('refresh').disabled=busy || !session;
  $('create').textContent=last?.intake==='RECORDED'?'GitHub 任務已建立':'建立 GitHub 任務';
  $('dispatch').disabled=jobBusy || !session?.nativeEnabled || last?.intake!=='RECORDED' || jobData?.state!=='NOT_STARTED';
  $('job-refresh').disabled=jobBusy || !session;
}
const jobLabels={NOT_CONNECTED:'原生試點能力尚未啟用',NOT_STARTED:'已啟用單次能力，等待派工',VERIFYING:'正在核對 GitHub 任務與來源',RESERVING:'正在保留唯一派工記錄',PREPARING:'正在準備隔離分支',CODING:'原生 Coding Agent 正在處理限定修改',TESTING:'正在套用修改與執行離線測試',PUBLISHING:'正在核對既有 PR 並保存證據',DELIVERED:'原生試點已交付，可進入複查與 Owner 驗收',HOLD:'派工已安全停止，需檢查證據'};
const eventLabels={LOCAL_RESERVATION_CREATED:'本機單次工作已保留',SOURCE_VERIFIED:'GitHub 任務與來源已核對',JOB_RESERVED:'GitHub 派工記錄已保留',ISOLATED_SOURCE_PREPARED:'隔離來源已準備',MODEL_REQUESTED:'已送出原生訂閱模型請求',PATCH_PROPOSED:'模型提出的修改已通過範圍檢查',SOURCE_EDITED_AND_TESTED:'隔離修改與離線測試完成',DELIVERY_EVIDENCE_RECORDED:'GitHub 成果證據已保存',HOLD:'停止並保留診斷'};
function renderJob(data){
  jobData=data;$('job-message').textContent=jobLabels[data.state]??'無法確認目前派工狀態';
  if(data.state==='HOLD'&&data.reason)$('job-message').textContent+=`（${data.reason}）`;
  $('job-events').replaceChildren();
  for(const event of data.events??[]){const li=document.createElement('li');li.textContent=eventLabels[event.kind]??'未知事件';$('job-events').append(li);}
  $('job-evidence').hidden=true;$('job-evidence').removeAttribute('href');
  if(data.state==='DELIVERED'&&/^https:\/\/github\.com\/augusliang23-web\/Micro-SaaS-Command-Center\/issues\/107#issuecomment-[1-9][0-9]*$/.test(data.evidenceUrl??'')){
    $('job-evidence').href=data.evidenceUrl;$('job-evidence').hidden=false;
    $('worker-status').textContent='原生試點已完成';$('qa-status').textContent='測試完成，複查見證據';
  }else if(['CODING','TESTING','PUBLISHING'].includes(data.state))$('worker-status').textContent='原生任務執行中';
  else $('worker-status').textContent=data.state==='HOLD'?'已停止':'等待原生派工';
  if(data.state!=='DELIVERED')$('qa-status').textContent='尚無本次完成證據';
  controls();
}
async function queryJob(start=false){
  if(jobBusy)return;jobBusy=true;clearTimeout(jobTimer);controls();
  try{
    const response=await fetch('/api/jobs',start?{method:'POST',headers:{'Content-Type':'application/json','X-ZC-CSRF':session.csrfToken},body:JSON.stringify({schema:'zc.dispatch/v1',taskId:session.task.taskId,jobId:session.jobId})}:{cache:'no-store'});
    const data=await response.json();if(data.schema!=='zc.job/v1'||data.jobId!==session.jobId)throw new Error('Invalid job response');renderJob(data);
    if(['VERIFYING','RESERVING','PREPARING','CODING','TESTING','PUBLISHING'].includes(data.state))jobTimer=setTimeout(()=>queryJob(),2000);
  }catch{renderJob({state:'UNKNOWN',events:[]});}
  finally{jobBusy=false;controls();}
}
$('dispatch').addEventListener('click',()=>queryJob(true));
$('job-refresh').addEventListener('click',()=>queryJob());
function render(data){
  last=data;$('intake').textContent=labels[data.intake]??labels.UNKNOWN;
  $('issue').hidden=true;$('issue').removeAttribute('href');
  if(data.intake==='RECORDED' && /^https:\/\/github\.com\/augusliang23-web\/Micro-SaaS-Command-Center\/issues\/[1-9][0-9]*$/.test(data.issue?.url)){
    $('issue').href=data.issue.url;$('issue').textContent=`查看 GitHub 任務 #${data.issue.number} ↗`;$('issue').hidden=false;
  }
  $('checked').textContent=data.checkedAt?`來源：GitHub · 本次查詢：${new Date(data.checkedAt).toLocaleString('zh-TW')}`:'GitHub 來源尚未確認；先前狀態不作為目前證據。';
  $('message').textContent=data.error?(errors[data.error]??'目前無法確認 GitHub 來源，已暫停建立。'):data.intake==='RECORDED'?'任務已存入 GitHub；原生派工狀態見下方。':data.intake==='WRITE_UNCERTAIN'?errors.WRITE_UNCERTAIN:session?.allowWrite?'可以建立這項固定任務，無需複製 Prompt。':'目前為唯讀入口，可查詢既有任務。';
  controls();
}
async function query(create=false){
  if(busy)return;busy=true;controls();$('message').textContent=create?'正在提交並核對 GitHub 任務…':'正在重新查詢 GitHub…';
  try{
    const response=await fetch('/api/tasks',create?{method:'POST',headers:{'Content-Type':'application/json','X-ZC-CSRF':session.csrfToken},body:JSON.stringify({schema:'zc.intake/v1',taskId:session.task.taskId})}:{cache:'no-store'});
    const data=await response.json();
    if(data.schema!=='zc.status/v1')throw new Error('Invalid response');
    render(data);
  }catch{render({intake:'UNKNOWN',error:'GITHUB_UNAVAILABLE'});}
  finally{busy=false;controls();}
}
$('create').addEventListener('click',()=>query(true));
$('refresh').addEventListener('click',()=>query());
try{
  const response=await fetch('/api/session',{cache:'no-store'});
  if(!response.ok)throw new Error('Unavailable session');
  session=await response.json();
  if(session.schema!=='zc.session/v1'||session.task?.schema!=='zc.task/v1')throw new Error('Unsupported session');
  $('contract').textContent=JSON.stringify(session.task,null,2);await query();await queryJob();
}catch{session=null;render({intake:'UNKNOWN',error:'GITHUB_UNAVAILABLE'});}
