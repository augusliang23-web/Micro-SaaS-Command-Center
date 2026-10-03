import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MicroSaaSProject, GithubPullStatus } from '../types';
import { getVerdict, isRealProject, isValidGithubState } from '../verdict.mjs';

export type ProjectStatus = 'IDLE' | 'IN_PROGRESS' | 'NEEDS_CONFIRMATION' | 'BLOCKED' | 'UNKNOWN';
export interface Verdict {
 status: ProjectStatus;
 level: 'danger' | 'decision' | 'waiting' | 'idle' | 'unknown';
 headline: string; explanation: string; actionLabel: string;
 hasAction: boolean; isWaiting: boolean; source: 'manual' | 'github';
 sourceState: 'AVAILABLE' | 'CHECKING' | 'UNAVAILABLE' | 'STALE';
 checkedAt: string | null; checksPassed: boolean; deployed: boolean; activityAt: string | null;
}
interface Observation {
 repository: string;
 data: GithubPullStatus | null;
 checkedAt?: string;
 availability: 'AVAILABLE' | 'CHECKING' | 'UNAVAILABLE';
}
interface ProjectStatuses {
 byId: Record<string, Verdict>;
 observations: Record<string, Observation>;
 isLoading: boolean;
 refresh: () => void;
}
export const ProjectStatusesContext = createContext<ProjectStatuses>({byId:{},observations:{},isLoading:false,refresh:()=>{}});
export function useProjectStatuses() { return useContext(ProjectStatusesContext); }
export function useProjectStatus(project: MicroSaaSProject | null) {
 const shared=useProjectStatuses();
 const stored = project ? shared.observations[project.id] : undefined;
 const observation = stored?.repository === project?.repository ? stored : undefined;
 return { verdict: (project && shared.byId[project.id]) || getVerdict(project,null) as Verdict,
  githubState: observation?.data || null, isLoadingGithub: shared.isLoading,
  loadGithubState: shared.refresh };
}
// One fetch per repo per refresh; every view consumes this same observation.
export function useProjectVerdicts(projects: MicroSaaSProject[]): ProjectStatuses {
 const [observations,setObservations]=useState<Record<string,Observation>>({});
 const [isLoading,setIsLoading]=useState(true);
 const [revision,setRevision]=useState(0);
 const [now,setNow]=useState(Date.now());
 const generation=useRef(0);
 // Ignore unrelated project edits (e.g. saving a summary).
 const identity=JSON.stringify(projects.filter(isRealProject).map(p=>[p.id,p.repository]));
 const refresh=useCallback(()=>{
  generation.current++;
  setObservations(prev=>Object.fromEntries(Object.entries(prev).map(([id,o])=>[id,{...o,data:null,availability:'CHECKING'}])));
  setIsLoading(true); setRevision(v=>v+1);
 },[]);
 useEffect(()=>{
  const timer=setInterval(()=>setNow(Date.now()),1000);
  return ()=>clearInterval(timer);
 },[]);
 useEffect(()=>{
  const token=++generation.current;
  const controller=new AbortController();
  const entries: [string,string][]=JSON.parse(identity);
  setIsLoading(true);
  setObservations(Object.fromEntries(entries.map(([id,repository])=>[id,{repository,data:null,availability:'CHECKING'}])));
  const repos=[...new Set(entries.map(([,repo])=>repo))];
  Promise.all(repos.map(async repository=>{
   let data: GithubPullStatus | null=null, availability: Observation['availability']='UNAVAILABLE';
   // Abort also bounds hangs; unknown remains visible while waiting.
   const timeout=setTimeout(()=>controller.abort(),15000);
   try {
    const res=await fetch(`/api/github/pull-status?repo=${encodeURIComponent(repository)}`,{signal:controller.signal});
    if(!res.ok) throw new Error('Unavailable');
    const candidate=await res.json();
    if(!isValidGithubState(candidate)) throw new Error('Invalid snapshot');
    data=candidate; availability='AVAILABLE';
   } catch { /* No fallback to saved fixture/manual state. */ }
   finally { clearTimeout(timeout); }
   return [repository,{repository,data,availability,checkedAt:new Date().toISOString()}] as const;
  })).then(results=>{
   if(token!==generation.current) return;
   const byRepo=Object.fromEntries(results);
   setObservations(Object.fromEntries(entries.map(([id,repo])=>[id,byRepo[repo]])));
   setNow(Date.now()); setIsLoading(false);
  });
  return ()=>{generation.current++;controller.abort();};
 },[identity,revision]);
 const byId=Object.fromEntries(projects.map(project=>{
  const stored=observations[project.id];
  const observation=stored?.repository===project.repository ? stored : undefined;
  return [project.id,getVerdict(project,observation?.data,{...observation,now}) as Verdict];
 }));
 return {byId,observations,isLoading,refresh};
}
