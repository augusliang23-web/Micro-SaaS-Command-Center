const $=id=>document.getElementById(id);
let session=null,last=null,busy=false;
const labels={NOT_CREATED:'尚未建立',RECORDED:'已記錄於 GitHub',WRITE_UNCERTAIN:'提交結果待核對',UNKNOWN:'來源暫時無法確認'};
const errors={READ_ONLY:'入口目前為唯讀。',BASE_DRIFT:'PM main 已變更，需重新檢查任務範圍。',WRITE_UNCERTAIN:'提交結果不確定，請重新查詢；系統不會自動重送。',DUPLICATE_RECORDS:'發現重複任務，暫停建立並保留證據。',INVALID_RECORD:'GitHub 任務內容與固定契約不符，已暫停。'};
function controls(){
  $('create').disabled=busy || !session?.allowWrite || last?.intake!=='NOT_CREATED';
  $('refresh').disabled=busy || !session;
  $('create').textContent=last?.intake==='RECORDED'?'GitHub 任務已建立':'建立 GitHub 任務';
}
function render(data){
  last=data;$('intake').textContent=labels[data.intake]??labels.UNKNOWN;
  $('issue').hidden=true;$('issue').removeAttribute('href');
  if(data.intake==='RECORDED' && /^https:\/\/github\.com\/augusliang23-web\/Micro-SaaS-Command-Center\/issues\/[1-9][0-9]*$/.test(data.issue?.url)){
    $('issue').href=data.issue.url;$('issue').textContent=`查看 GitHub 任務 #${data.issue.number} ↗`;$('issue').hidden=false;
  }
  $('checked').textContent=data.checkedAt?`來源：GitHub · 本次查詢：${new Date(data.checkedAt).toLocaleString('zh-TW')}`:'GitHub 來源尚未確認；先前狀態不作為目前證據。';
  $('message').textContent=data.error?(errors[data.error]??'目前無法確認 GitHub 來源，已暫停建立。'):data.intake==='RECORDED'?'任務已存入 GitHub；尚未派給 Agent。':data.intake==='WRITE_UNCERTAIN'?errors.WRITE_UNCERTAIN:session?.allowWrite?'可以建立這項固定任務，無需複製 Prompt。':'目前為唯讀入口，可查詢既有任務。';
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
  $('contract').textContent=JSON.stringify(session.task,null,2);await query();
}catch{session=null;render({intake:'UNKNOWN',error:'GITHUB_UNAVAILABLE'});}
