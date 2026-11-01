import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {ReadOnlyCommandCenter} from './ReadOnlyCommandCenter';
import {ProjectWorkstreams} from './ProjectWorkstreams';
import {FIXED_TARGETS} from './zc08bStatusModel.mjs';
import {catalogEntry} from './projectCatalog.mjs';
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
const flush=()=>act(async()=>{await new Promise(r=>setTimeout(r,0));});
function setup(){
 const calls:string[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>{
  calls.push(String(url)); expect(init?.method??'GET').toBe('GET');
  if(String(url)==='/api/state')return Promise.resolve(new Response(JSON.stringify({error:'No saved state yet.'}),{status:404}));
  return new Promise<Response>(()=>{});
 });
 render(<ReadOnlyCommandCenter/>);return calls;
}
test('approved catalog offers three projects independently of saved-state availability',async()=>{
 const calls=setup();await flush();
 for(const name of ['PM Dashboard','Inventory Tool','Zero-Copy Development'])
  expect(screen.getByRole('article',{name:'監控目標 '+name})).toBeVisible();
 expect(screen.getByRole('article',{name:'監控目標 Zero-Copy Development'})).toHaveTextContent('2 Repositories');
 expect(calls).toEqual(['/api/state']);
 expect(document.body).not.toHaveTextContent('SYNTHETIC_FIXTURE_ONLY');
});
const head='a'.repeat(40);
function evidenceResponse(url:string){
 const params=new URL(url,'http://localhost').searchParams;
 const target=FIXED_TARGETS.find(t=>t.repo===params.get('repo')&&String(t.pr)===params.get('number'))!;
 const evidence={source:'GitHub',repository:target.repo,repositoryId:catalogEntry(target.repo)!.id,number:target.pr,
  head,observedAt:new Date().toISOString(),consistent:true,
  pull:{number:target.pr,headSha:head,draft:true,merged:false},
  workflows:[{name:target.workflow,headSha:head,status:'completed',conclusion:'success'}],codex:[]};
 return new Response(JSON.stringify({source:'GitHub',repository:target.repo,number:target.pr,pull:{headSha:head},zcEvidence:{evidence}}));
}
test('workstream refresh failure suppresses old CI PASS and keeps Agent disconnected',async()=>{
 let fail=false;
 vi.spyOn(globalThis,'fetch').mockImplementation(url=>fail?Promise.reject(Error('offline')):Promise.resolve(evidenceResponse(String(url))));
 render(<ProjectWorkstreams/>);await flush();await flush();
 expect(within(screen.getByRole('region',{name:'ZC-08'})).getAllByRole('link',{name:'PASS'})).toHaveLength(2);
 fail=true;fireEvent.click(screen.getByRole('button',{name:'刷新工作線 GitHub 證據'}));await flush();await flush();
 expect(screen.queryAllByRole('link',{name:'PASS'})).toHaveLength(0);
 expect(screen.getByRole('region',{name:'ZC-08'})).toHaveTextContent('STALE');
 expect(screen.getByRole('region',{name:'ZC-08'})).toHaveTextContent('NOT_CONNECTED');
});
test('workstream evidence expires while the browser is hidden; no hidden requests restore PASS',async()=>{
 vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});
 vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
 const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(url=>Promise.resolve(evidenceResponse(String(url))));
 render(<ProjectWorkstreams/>);await flush();await flush();
 expect(screen.getAllByRole('link',{name:'PASS'})).toHaveLength(7);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
 const count=fetch.mock.calls.length;
 await act(async()=>{vi.advanceTimersByTime(330000);});
 expect(screen.queryAllByRole('link',{name:'PASS'})).toHaveLength(0);
 expect(fetch.mock.calls).toHaveLength(count);
 expect(screen.getByRole('region',{name:'ZC-07'})).toHaveTextContent('STALE');
});
test('Inventory opens only its own history; Zero-Copy switches between independent repositories',async()=>{
 const calls=setup();await flush();
 fireEvent.click(within(screen.getByRole('article',{name:'監控目標 Inventory Tool'})).getByRole('button'));await flush();
 expect(calls.some(x=>x.includes(encodeURIComponent('alin36242-web/inventory-management-tool')))).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:/Zero-Copy Development ·/}));await flush();
 const repos=screen.getByRole('group',{name:'Zero-Copy repositories'});
 expect(within(repos).getAllByRole('button')).toHaveLength(2);
 for(const label of ['ZC-06C','ZC-07','ZC-08','ZC-09'])expect(screen.getByRole('region',{name:label})).toBeVisible();
 fireEvent.click(within(repos).getByRole('button',{name:'Command Center'}));await flush();
 expect(screen.getByRole('heading',{level:1,name:'Command Center'})).toBeVisible();
 expect(screen.getAllByText(/NOT_CONNECTED/).length).toBeGreaterThan(0);
 const histories=calls.filter(x=>x.includes('development-history?'));
 expect(histories.at(-1)).toContain(encodeURIComponent('augusliang23-web/Micro-SaaS-Command-Center'));
 expect(screen.getByLabelText('資料來源')).toHaveTextContent('augusliang23-web/Micro-SaaS-Command-Center');
 expect(calls.every(x=>x==='/api/state'||x.startsWith('/api/github/development-history'))).toBe(true);
});
