import { githubSnapshot } from '../test/githubSnapshots.mjs';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useProjectVerdicts } from './useProjectVerdicts';
import { initialProjects } from '../mockData';
import { STATUS_MAX_AGE_MS } from '../verdict.mjs';
const project={...initialProjects[0],id:'real',repository:'owner/real'};
const response=(data:unknown)=>({ok:true,json:async()=>data}) as Response;
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});

test('expired observation invalidates status and passing badge without a network poll', async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T02:00:00Z'));
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(response(githubSnapshot({state:'open',ciStatus:'passing',reviewDecision:'approved'})));
 const {result}=renderHook(()=>useProjectVerdicts([project]));
 await act(async()=>{await Promise.resolve();});
 expect(result.current.byId.real.checksPassed).toBe(true);
 await act(async()=>{vi.advanceTimersByTime(STATUS_MAX_AGE_MS+1000);});
 expect(result.current.byId.real.status).toBe('UNKNOWN');
 expect(result.current.byId.real.sourceState).toBe('STALE');
 expect(result.current.byId.real.checksPassed).toBe(false);
 expect(fetcher).toHaveBeenCalledTimes(1);
});

test('late response from a superseded refresh cannot restore previous success', async()=>{
 const pending:((response:Response)=>void)[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const {result}=renderHook(()=>useProjectVerdicts([project]));
 await act(async()=>result.current.refresh());
 await act(async()=>{pending[1]({ok:false} as Response);});
 expect(result.current.byId.real.status).toBe('UNKNOWN');
 expect(result.current.byId.real.sourceState).toBe('UNAVAILABLE');
 await act(async()=>{pending[0](response(githubSnapshot({state:'open',ciStatus:'passing'})));});
 expect(result.current.byId.real.sourceState).toBe('UNAVAILABLE');
 expect(result.current.byId.real.checksPassed).toBe(false);
});

test('same project id with a replaced repository cannot reuse previous observed checks', async()=>{
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>String(input).includes('owner%2Freal') ? response(githubSnapshot({state:'open',ciStatus:'passing'})) : ({ok:false} as Response));
 const {result,rerender}=renderHook(({repository})=>useProjectVerdicts([{...project,repository}]),{initialProps:{repository:'owner/real'}});
 await waitFor(()=>expect(result.current.byId.real.checksPassed).toBe(true));
 rerender({repository:'owner/replaced'});
 expect(result.current.byId.real.status).toBe('UNKNOWN');
 await waitFor(()=>expect(result.current.byId.real.sourceState).toBe('UNAVAILABLE'));
 expect(result.current.byId.real.checksPassed).toBe(false);
});
