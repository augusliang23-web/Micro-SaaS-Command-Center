import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DevelopmentHistory } from './gitHistoryTypes';
import { branchKind, formatSgt, indexCommits, matchesState, mergeEvidence, MERGE_EVIDENCE_LABEL, pullEnd, STATUS_LABEL, timelineSpan, type RangeId, type StateFilter } from './gitHistoryModel';
import { buildHybridMap, type HybridRow } from './hybridMapModel';
import { flowPath } from './hybridFlowLayout';
import type { RecentActivitySnapshot } from './recentActivityModel';

type Stage = 'feature' | 'integration' | 'main' | 'release';
type Edge = { id: string; from: string; to: string; kind: 'verified' | 'reported'; label: string; members: number[]; count: number };
type Props = {
  recentActivity: RecentActivitySnapshot; pulseEnabled: boolean;
  data: DevelopmentHistory; range: RangeId; stateFilter: StateFilter; query: string; needsRefresh: boolean;
  focusPR: number | null; onFocusPR: (number: number) => void; onClearFocus: () => void;
  modalOpen: boolean; openDetail: (number: number, origin: HTMLElement) => void;
};
const releaseBranch = (name: string, main: string) => name !== main && branchKind(name, main) === 'integration' && !/^(integration|integrate)\//i.test(name);
const branchNode = (name: string) => `branch:${name}`;
const prNode = (number: number) => `pr:${number}`;
const mainLabel = (row: HybridRow, branch: string) => row.main.state === 'verified' ? `IN ${branch} — VERIFIED` : row.main.state === 'not_verified' ? `NOT VERIFIED IN ${branch}` : 'UNKNOWN';

/** Real DOM endpoints keep SVG connections attached when lanes wrap, groups expand or text reflows. */
function usePaths(root: RefObject<HTMLDivElement>, edges: Edge[], layoutKey: string) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const frame = el.getBoundingClientRect();
      const nodes = new Map([...el.querySelectorAll<HTMLElement>('[data-flow-node]')].map(n => [n.dataset.flowNode!, n.getBoundingClientRect()]));
      const next: Record<string, string> = {};
      edges.forEach((edge, slot) => {
        const a = nodes.get(edge.from), b = nodes.get(edge.to);
        if (!a?.width || !b?.width || !frame.width) return;
        next[edge.id] = flowPath(a, b, frame, slot, edges.length);
      });
      setPaths(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    el.querySelectorAll('[data-flow-node]').forEach(n => observer?.observe(n));
    window.addEventListener('resize', measure);
    el.addEventListener('scroll', measure, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); el.removeEventListener('scroll', measure, true); };
  }, [root, edges, layoutKey]);
  return paths;
}

export function HybridFlowMap({ recentActivity, pulseEnabled, data, range, stateFilter, query, needsRefresh, focusPR, onFocusPR, onClearFocus, modalOpen, openDetail }: Props) {
  const rows = useMemo(() => buildHybridMap(data, needsRefresh), [data, needsRefresh]);
  const index = useMemo(() => indexCommits(data.commits), [data.commits]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const root = useRef<HTMLDivElement>(null);
  const inspectorId = useId();
  const markerId = `hf-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const search = query.trim().toLowerCase().replace(/^#/, '');
  const start = timelineSpan(data, range).start;
  const visible = rows.filter(({ pr }) => matchesState(pr, stateFilter) && Date.parse(pullEnd(pr, data.fetchedAt)) >= start
    && (!search || `${pr.number} ${pr.title} ${pr.headRef ?? ''} ${pr.baseRef ?? ''}`.toLowerCase().includes(search)));
  const groups = new Map<string, HybridRow[]>();
  visible.forEach(row => { const target = row.pr.baseRef ?? 'UNKNOWN'; groups.set(target, [...(groups.get(target) ?? []), row]); });
  const collapsedTargets = new Set([...groups].filter(([target, group]) => visible.length >= 20
    && !expanded.has(`feature:${target}`) && !group.some(r => r.pr.number === focusPR || r.pr.number === visible.find(r => r.pr.number === focusPR)?.relationship.parent)).map(([target]) => target));
  const focused = visible.find(r => r.pr.number === focusPR);
  const parentNumber = focused?.relationship.parent ?? null;
  const branchNames = new Set(data.branches.map(b => b.name));
  const integrationNames = [...new Set([
    ...data.branches.filter(b => /^(integration|integrate)\//i.test(b.name)).map(b => b.name),
    ...visible.filter(r => r.relationship.kind === 'unknown' || r.relationship.parent === null || data.branches.some(b => b.name === r.pr.baseRef)).map(r => r.pr.baseRef).filter((n): n is string => Boolean(n) && n !== data.defaultBranch && !releaseBranch(n!, data.defaultBranch)),
  ])];
  const releaseNames = [...new Set([
    ...data.branches.filter(b => releaseBranch(b.name, data.defaultBranch)).map(b => b.name),
    ...visible.map(r => r.pr.baseRef).filter((n): n is string => Boolean(n) && releaseBranch(n!, data.defaultBranch)),
  ])];
  const stages: { id: Stage; title: string; subtitle: string; branches: string[] }[] = [
    { id: 'feature', title: '開發 / Feature', subtitle: 'WORK SOURCES · 所有 PR 來源', branches: [] },
    { id: 'integration', title: '整合 / Integration', subtitle: '實際目標與 reported stack', branches: integrationNames },
    { id: 'main', title: `主分支 / ${data.defaultBranch || 'UNKNOWN'}`, subtitle: 'DESTINATION · 納入狀態另行驗證', branches: [data.defaultBranch] },
    { id: 'release', title: '其他發布分支', subtitle: '依名稱分組 · Git 分支 ≠ 部署', branches: releaseNames },
  ];
  const stackTargets = [...new Set(visible.filter(r => r.relationship.kind !== 'unknown' && r.relationship.parent !== null && !branchNames.has(r.pr.baseRef!)).map(r => r.relationship.parent!))];
  const targetOrder = [...integrationNames.filter(name => branchNames.has(name)), ...stackTargets.map(number => rows.find(r => r.pr.number === number)?.pr.headRef ?? ''), data.defaultBranch, ...releaseNames];
  const rankTarget = (name: string) => targetOrder.includes(name) ? targetOrder.indexOf(name) : targetOrder.length;
  const orderedGroups = [...groups].sort(([a], [b]) => rankTarget(a) - rankTarget(b) || a.localeCompare(b));
  const sourceOrder = orderedGroups.flatMap(([target, group]) => collapsedTargets.has(target) ? [`group:${target}`] : group.map(r => prNode(r.pr.number)));
  // Aggregate only same-kind relationship decisions from the unchanged trust model.
  // A counted route is not a fabricated single merge; branch-to-branch edges are never inferred.
  const edges: Edge[] = [];
  for (const { pr, relationship } of visible) {
    if (relationship.kind === 'unknown' || !pr.baseRef) continue;
    const to = branchNames.has(pr.baseRef) ? branchNode(pr.baseRef) : relationship.parent !== null ? `stack:${relationship.parent}` : null;
    if (!to) continue;
    const collapsed = collapsedTargets.has(pr.baseRef);
    const from = collapsed ? `group:${pr.baseRef}` : prNode(pr.number);
    const id = `${from}:${to}:${relationship.kind}`;
    const existing = edges.find(e => e.id === id);
    if (existing) { existing.members.push(pr.number); existing.count += 1; }
    else edges.push({ id, from, to, kind: relationship.kind, members: [pr.number], count: 1,
      label: `${collapsed ? 'PR 來源群組（目標：' + pr.baseRef + '）' : 'PR #' + pr.number + ' · ' + (pr.headRef ?? 'UNKNOWN')} → ${pr.baseRef} · ${relationship.kind === 'verified' ? 'Git evidence (verified)' : 'PR base（未驗證合併）'}` });
  }
  edges.sort((a,b) => sourceOrder.indexOf(a.from) - sourceOrder.indexOf(b.from) || a.kind.localeCompare(b.kind));
  const edgeKey = JSON.stringify(edges);
  const stableEdges = useMemo(() => edges, [edgeKey]);
  const layoutKey = JSON.stringify([visible.map(r => r.pr.number), [...expanded], parentNumber]);
  const paths = usePaths(root, stableEdges, layoutKey);
  const clear = () => {
    const opener = [...(root.current?.querySelectorAll<HTMLElement>('[data-flow-node]') ?? [])].find(el => el.dataset.flowNode === prNode(focusPR!));
    onClearFocus();
    opener?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !modalOpen && focusPR !== null) clear(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  });
  const activeNodes = new Set(edges.filter(e => e.members.includes(focusPR!)).flatMap(e => [e.from, e.to]));
  const emphasis = (id: string) => focused ? (id === prNode(focused.pr.number) ? 'is-selected' : activeNodes.has(id) || id === prNode(parentNumber!) ? 'is-related' : 'is-dim') : '';
  const distribution = new Map<string, number>();
  rows.forEach(r => { const target = r.pr.baseRef ?? 'UNKNOWN'; distribution.set(target, (distribution.get(target) ?? 0) + 1); });
  const toggleGroup = (key: string, isExpanded: boolean) => setExpanded(old => { const next = new Set(old); isExpanded ? next.delete(key) : next.add(key); return next; });

  return <div className="hf-root g-hybrid" tabIndex={0}>
    <header className="hf-header">
      <div><p className="hf-eyebrow">DEVELOPMENT MAP</p><h2>開發全貌 / Hybrid</h2><p>{data.repository}</p></div>
      <div className="hf-snapshot"><strong>{needsRefresh ? 'Needs refresh' : data.status === 'partial' ? 'Partial history' : 'Snapshot'}</strong><span>Last checked：{formatSgt(data.fetchedAt)}</span></div>
    </header>
    <p className="hf-guide">左側是 PR 工作來源，右側是實際目的地；箭頭區分 Git 證據與回報目標。點選 PR 可聚焦路徑，不代表固定發布順序。</p>
    <div className={`hf-workspace ${focused ? 'has-inspector' : ''}`}>
      <div className="hf-map-area">
        <div className="hf-canvas" ref={root} role="region" aria-label="Git 視覺流程圖">
          <svg className="hf-edges" aria-label="PR 來源與目的地關係" width="100%" height="100%">
            <defs>{(['verified', 'reported'] as const).map(kind => <marker key={kind} id={`${markerId}-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill={kind === 'verified' ? '#368c76' : '#8176a0'} /></marker>)}</defs>
            {edges.map(edge => <g key={edge.id} data-edge-kind={edge.kind} data-edge-count={edge.count} data-from={edge.from} data-to={edge.to} aria-label={`${edge.label} · ${edge.count} PR`} className={focused ? edge.members.includes(focusPR!) ? 'is-highlighted' : 'is-dim' : ''}>
              <title>{edge.label} · {edge.count} PR{edge.count > 1 ? '（關係彙總，非單一 merge）' : ''}</title><path d={paths[edge.id] ?? ''} className={`hf-edge is-${edge.kind}`} markerEnd={`url(#${markerId}-${edge.kind})`} />
            </g>)}
          </svg>
          <div className="hf-lanes">
            {stages.map((stage, i) => {
              const stageRows = stage.id === 'feature' ? visible : [];
              const stageGroups = stage.id === 'feature' ? orderedGroups : [];
              return <section key={stage.id} className={`hf-lane is-${stage.id}`} aria-label={stage.title}>
                <header className="hf-lane-heading"><span className="hf-stage-index">0{i + 1}</span><div><h3>{stage.title}</h3><p>{stage.subtitle}</p></div><span className="hf-lane-count">{stage.id === 'feature' ? `${stageRows.length} PR` : `${stage.branches.length + (stage.id === 'integration' ? stackTargets.length : 0)} 目標`}</span></header>
                <div className="hf-lane-content">
                  {stage.branches.map(name => <div key={name} data-flow-node={branchNode(name)} className={`hf-branch ${emphasis(branchNode(name))}`}>
                    <span className="hf-node-symbol" aria-hidden="true">⑂</span><div><small>{branchNames.has(name) ? 'GIT BRANCH' : 'UNKNOWN · 未觀察到分支'}</small><strong>{name}</strong></div>
                  </div>)}
                  {stage.id === 'integration' && stackTargets.map(number => <div key={`stack-${number}`} data-flow-node={`stack:${number}`} className={`hf-branch ${emphasis(`stack:${number}`)}`}><span className="hf-node-symbol" aria-hidden="true">⑂</span><div><small>STACKED PR TARGET · metadata</small><strong>PR #{number} · {rows.find(r => r.pr.number === number)?.pr.headRef ?? 'UNKNOWN'}</strong></div></div>)}
                  {[...stageGroups].map(([target, group]) => {
                    const key = `${stage.id}:${target}`;
                    const grouped = visible.length >= 20;
                    const relatedGroup = group.some(r => r.pr.number === focusPR || r.pr.number === parentNumber);
                    const isExpanded = !grouped || expanded.has(key) || relatedGroup;
                    return <div className={`hf-cluster ${grouped ? 'is-grouped' : ''}`} key={key}>
                      {grouped ? <button className="hf-cluster-toggle" data-flow-node={!isExpanded ? `group:${target}` : undefined} aria-expanded={isExpanded} onClick={() => { if (relatedGroup) onClearFocus(); toggleGroup(key, isExpanded); }} aria-label={`${isExpanded ? '收折' : '展開'} ${target} 的 ${group.length} 個 PR`}>
                        <span aria-hidden="true">{isExpanded ? '−' : '+'}</span><strong>{group.length} PR</strong><span>目標：{target}</span><small>Git evidence {group.filter(r => r.relationship.kind === 'verified').length} · PR base {group.filter(r => r.relationship.kind === 'reported').length} · UNKNOWN {group.filter(r => r.relationship.kind === 'unknown').length}</small>
                      </button> : null}
                      {isExpanded && group.map(row => <button key={row.pr.number} data-select data-flow-node={prNode(row.pr.number)} data-node={`pr-${row.pr.number}`} data-testid={`hybrid-pr-${row.pr.number}`} className={`hf-pr ${pulseEnabled && recentActivity.byPull.get(row.pr.number)?.state === 'recent' ? 'has-recent-commit' : ''} ${emphasis(prNode(row.pr.number))}`}
                        aria-label={`PR #${row.pr.number} · ${row.pr.title} · ${STATUS_LABEL[row.pr.status]}`} aria-describedby={`hybrid-commit-${row.pr.number}`} title={pulseEnabled && recentActivity.byPull.get(row.pr.number)?.state === 'recent' ? recentActivity.byPull.get(row.pr.number)?.explanation : row.pr.title} aria-pressed={row.pr.number === focusPR} aria-controls={focused ? inspectorId : undefined} onClick={() => onFocusPR(row.pr.number)}>
                        <span className="hf-pr-top"><strong>#{row.pr.number}</strong><span className={`hf-status is-${row.pr.status}`}>{STATUS_LABEL[row.pr.status]}</span></span>
                        <span className="hf-pr-title" title={row.pr.title}>{pulseEnabled && recentActivity.byPull.get(row.pr.number)?.state === 'recent' && <small className="pr-recent-label">{recentActivity.byPull.get(row.pr.number)!.label}</small>}{row.pr.title}</span><span className="pr-activity-sr" id={`hybrid-commit-${row.pr.number}`}>{recentActivity.byPull.get(row.pr.number)?.explanation ?? recentActivity.message}</span><small className="hf-source-name">{row.pr.headRef ?? 'UNKNOWN source'}</small>
                        <small className={`hf-inclusion is-${row.main.state}`}>{mainLabel(row, data.defaultBranch)}</small>
                      </button>)}
                    </div>;
                  })}
                  {!stageRows.length && !stage.branches.length && !(stage.id === 'integration' && stackTargets.length) && <p className="hf-empty">本次未取得此階段節點</p>}
                </div>
              </section>;
            })}
          </div>
        </div>
        <div className="hf-legend"><span><i className="is-verified" />Git evidence (verified)</span><span><i className="is-reported" />PR base（未驗證合併）</span><span>UNKNOWN：不連線</span></div>
        <details className="hf-route-labels"><summary>{edges.length} 條來源 → 目的地路徑 · 查看文字說明</summary><ul>{edges.map(edge => <li key={edge.id}>{edge.label} · {edge.count} PR{edge.count > 1 ? '（彙總，非單一 merge）' : ''}</li>)}{!edges.length && <li>UNKNOWN · 尚無可繪製的確定關係</li>}</ul></details>
        {!visible.length && <p className="hf-empty">此篩選沒有已取得的 PR；不代表沒有開發活動。</p>}
      </div>
      {focused && <aside id={inspectorId} className="hf-inspector" aria-label="PR 情境檢視器">
        <header><p className="hf-eyebrow">PR #{focused.pr.number}</p><button aria-label="關閉情境檢視器" onClick={clear}>×</button></header>
        <h3>{focused.pr.title}</h3><p><span className={`hf-status is-${focused.pr.status}`}>{STATUS_LABEL[focused.pr.status]}</span></p>
        <dl>
          <div><dt>Recent HEAD Commit</dt><dd>{recentActivity.byPull.get(focused.pr.number)?.label ?? 'Not checked'}<p>{recentActivity.byPull.get(focused.pr.number)?.explanation ?? recentActivity.message}</p></dd></div>
          <div><dt>Source</dt><dd>{focused.pr.headRef ?? 'UNKNOWN'}</dd></div>
          <div><dt>Target</dt><dd>{focused.pr.baseRef ?? 'UNKNOWN'}</dd></div>
          <div><dt>Git relationship</dt><dd>{focused.relationship.label}<p>{focused.relationship.evidence}</p></dd></div>
          <div><dt>Default branch inclusion</dt><dd><strong>{mainLabel(focused, data.defaultBranch)}</strong><p>{focused.main.evidence}</p></dd></div>
          <div><dt>Merge evidence</dt><dd>{MERGE_EVIDENCE_LABEL[mergeEvidence(focused.pr, index)]}</dd></div>
          <div><dt>PR head SHA</dt><dd className="g-mono">{focused.pr.headSha ?? 'UNKNOWN'}</dd></div>
          <div><dt>Merge SHA（PR 紀錄）</dt><dd className="g-mono">{focused.pr.merged ? focused.pr.mergeCommitSha ?? 'UNKNOWN' : 'Not merged'}</dd></div>
          <div><dt>Last checked</dt><dd>{formatSgt(data.fetchedAt)} · 非即時快照</dd></div>
        </dl>
        <button className="hf-detail-action" onClick={event => openDetail(focused.pr.number, event.currentTarget)}>開啟完整 PR 詳情</button>
      </aside>}
    </div>
    <section className="hf-deployments" aria-label="部署 / 驗收"><header><h3>部署 / 驗收</h3><span>獨立於 Git 分支 · 尚無權威部署資料</span></header><div>
      <article aria-label="UAT"><span className="hf-environment-icon" aria-hidden="true">◇</span><h4>UAT</h4><p>Not checked</p></article>
      <article aria-label="Production"><span className="hf-environment-icon" aria-hidden="true">◇</span><h4>Production</h4><p>Not checked</p></article>
    </div></section>
    <section className="hf-dashboard" aria-label="本次已取得資料摘要"><header><h3>本次已取得資料</h3><span>{needsRefresh ? 'Needs refresh' : data.status === 'partial' ? 'Partial · 非完整總數' : 'Snapshot'} · {visible.length} 個 PR 符合目前篩選</span></header>
      <div className="hf-metrics">{[
        ['OPEN', rows.filter(r => r.pr.status === 'open').length], ['DRAFT', rows.filter(r => r.pr.isDraft).length], ['MERGED', rows.filter(r => r.pr.merged).length], [`IN ${data.defaultBranch} VERIFIED`, rows.filter(r => r.main.state === 'verified').length],
      ].map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
      <div className="hf-distribution"><h4>PR 目標分布</h4>{[...distribution].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).map(([target,count]) => <div key={target}><span>{target}</span><meter aria-label={`${target} 的已取得 PR`} min={0} max={Math.max(1, rows.length)} value={count} /><strong>{count}</strong></div>)}</div>
    </section>
  </div>;
}
