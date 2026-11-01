import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { TASK } from './contract.mjs';
import { createGithubAdapter } from './github.mjs';
import { createIntakeService } from './service.mjs';

const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/client.mjs',['client.mjs','text/javascript; charset=utf-8']],['/pilot.css',['pilot.css','text/css; charset=utf-8']]]);
const safeErrors=new Set(['READ_ONLY','DUPLICATE_RECORDS','INVALID_RECORD','INVALID_SOURCE','PAGINATION_INCOMPLETE','SOURCE_IDENTITY','BASE_DRIFT','WRITE_UNCERTAIN','GITHUB_UNAVAILABLE']);
const unknown={schema:'zc.status/v1',intake:'UNKNOWN',worker:'NOT_CONNECTED',dispatch:'HOLD',implementation:'NOT_STARTED',tests:'NOT_RUN',ownerUat:'PENDING',issue:null,events:[]};
export function createPilotHandler({service,port=3134,csrfToken=randomBytes(32).toString('hex')}) {
  const origin=`http://127.0.0.1:${port}`;
  const reply=(status,body,type='application/json; charset=utf-8')=>({status,body,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
  return async({method,path,headers,body=''})=>{
    if(headers.host!==`127.0.0.1:${port}` || (headers.origin && headers.origin!==origin))return reply(403,{error:'UNTRUSTED_BROWSER'});
    if(!['GET','POST'].includes(method))return reply(405,{error:'METHOD_DENIED'});
    if(method==='GET' && assets.has(path)){
      const [file,type]=assets.get(path);return reply(200,await readFile(new URL(file,import.meta.url),'utf8'),type);
    }
    if(method==='GET' && path==='/api/session')return reply(200,{schema:'zc.session/v1',csrfToken,allowWrite:service.allowWrite,task:TASK});
    if(path!=='/api/tasks')return reply(404,{error:'NOT_FOUND'});
    if(method==='POST'){
      if(!service.allowWrite)return reply(403,{error:'READ_ONLY'});
      if(headers.origin!==origin || headers['x-zc-csrf']!==csrfToken)return reply(403,{error:'UNTRUSTED_BROWSER'});
      if(headers['content-type']!=='application/json')return reply(415,{error:'JSON_REQUIRED'});
      if(Buffer.byteLength(body)>1024)return reply(413,{error:'BODY_TOO_LARGE'});
      try{
        if(!isDeepStrictEqual(JSON.parse(body),{schema:'zc.intake/v1',taskId:TASK.taskId}))return reply(400,{error:'INVALID_INTAKE'});
      }catch{return reply(400,{error:'INVALID_JSON'});}
    }
    try{return reply(200,await (method==='POST'?service.create():service.read()));}
    catch(error){return reply(503,{...unknown,error:safeErrors.has(error?.message)?error.message:'GITHUB_UNAVAILABLE'});}
  };
}
export function createPilotServer({service,port=3134}={}) {
  const handle=createPilotHandler({service,port});
  return http.createServer({requestTimeout:30000,headersTimeout:10000},async(req,res)=>{
    const chunks=[];let bytes=0;
    try{
      for await(const chunk of req){bytes+=chunk.length;if(bytes>1024){res.writeHead(413,{'Connection':'close'});res.end();return;}chunks.push(chunk);}
      const result=await handle({method:req.method,path:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')});
      res.writeHead(result.status,result.headers);res.end(typeof result.body==='string'?result.body:JSON.stringify(result.body));
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.some(x=>x!=='--allow-github-intake') || args.length>1)throw new Error('Only --allow-github-intake is supported');
  const allowWrite=args.includes('--allow-github-intake');
  createPilotServer({service:createIntakeService({github:createGithubAdapter(),allowWrite})}).listen(3134,'127.0.0.1',()=>{
    console.log(`ZC Pilot: http://127.0.0.1:3134 · GitHub intake ${allowWrite?'enabled for fixed task':'read-only'} · worker NOT_CONNECTED`);
  });
}
