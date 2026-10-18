// Pure snapshot projection. PR routing, Git ancestry and deployments are separate facts.
import type { DevelopmentHistory, HistoryPull } from './gitHistoryTypes';
import { buildStackGraph, indexCommits, isAncestor, mergeEvidence, prHeadMismatch } from './gitHistoryModel';

type MainEvidence = { state: 'verified' | 'not_verified' | 'unknown'; evidence: string };
type Relationship = { kind: 'verified' | 'reported' | 'unknown'; label: string; evidence: string; parent: number | null };
export type HybridRow = { pr: HistoryPull; main: MainEvidence; relationship: Relationship };

/** Validate the fetched DAG once, before asking existing ancestry helpers for any positive claim.
 * Duplicate SHAs, cycles and missing parent records must not turn isAncestor's early success into proof.
 * This is deliberately conservative: incomplete history anywhere keeps the Hybrid projection UNKNOWN.
 */
function validGraph(data: DevelopmentHistory): boolean {
  const index = indexCommits(data.commits);
  if (index.size !== data.commits.length || !index.size) return false;
  const done = new Set<string>();
  const visiting = new Set<string>();
  for (const sha of index.keys()) {
    const stack: { sha: string; exit: boolean }[] = [{ sha, exit: false }];
    while (stack.length) {
      const item = stack.pop()!;
      if (item.exit) { visiting.delete(item.sha); done.add(item.sha); continue; }
      if (done.has(item.sha)) continue;
      const commit = index.get(item.sha);
      if (!commit || visiting.has(item.sha)) return false;
      visiting.add(item.sha);
      stack.push({ sha: item.sha, exit: true });
      for (const parent of commit.parents) stack.push({ sha: parent, exit: false });
    }
  }
  return true;
}

export function buildHybridMap(data: DevelopmentHistory, needsRefresh = false): HybridRow[] {
  const index = indexCommits(data.commits);
  const graph = buildStackGraph(data.pulls);
  const defaultBranches = data.branches.filter(b => b.name === data.defaultBranch);
  const mainHead = defaultBranches.length === 1 ? defaultBranches[0].headSha : null;
  const healthy = !needsRefresh && data.status === 'complete' && data.coverage.branches.complete && data.coverage.pulls.complete
    && data.coverage.commits.defaultBranchComplete && !data.coverage.focusRefs.truncated
    && data.warnings.length === 0 && data.comparisons.every(c => c.complete && !c.error)
    && Object.entries(data.refs).every(([name, ref]) => ref.complete && data.branches.filter(b => b.name === name).length === 1
      && data.branches.find(b => b.name === name)?.headSha === ref.headSha)
    && data.consistency?.status === 'consistent' && data.consistency.driftedRefs.length === 0
    && Number.isFinite(Date.parse(data.consistency.rereadAt ?? '')) && Number.isFinite(Date.parse(data.fetchedAt)) && validGraph(data);
  const mainHealthy = healthy && Boolean(mainHead && data.defaultBranchShas[0] === mainHead
    && data.defaultBranchShas.every(sha => index.has(sha) && isAncestor(index, sha, mainHead) === true));

  return data.pulls.map(pr => {
    const mismatch = prHeadMismatch(data, pr.number) || (pr.state === 'open' && pr.headRepo === data.repository
      && data.branches.some(b => b.name === pr.headRef && b.headSha !== pr.headSha));
    const candidates = [
      ...(pr.merged && pr.mergeCommitSha ? [{ sha: pr.mergeCommitSha, basis: 'merge commit ancestor' }] : []),
      ...(pr.headSha ? [{ sha: pr.headSha, basis: 'PR head ancestor' }] : []),
    ];
    let main: MainEvidence = { state: 'unknown', evidence: '歷史缺漏、快照不完整／需重新整理，或一致性未驗證；無法判定。' };
    if (mainHealthy && !mismatch) {
      const positive = candidates.find(c => index.has(c.sha) && isAncestor(index, c.sha, mainHead) === true);
      if (positive) main = { state: 'verified', evidence: `${positive.basis}: ${positive.sha} → ${data.defaultBranch} head ${mainHead}（commit parents）；僅於此快照驗證。` };
      else {
        const complete = candidates.length > 0 && candidates.every(c => index.has(c.sha) && isAncestor(index, c.sha, mainHead) === false);
        main = { state: complete ? 'not_verified' : 'unknown', evidence: `檢查 SHA: ${candidates.map(c => c.sha).join(', ') || 'UNKNOWN'}；${data.defaultBranch} head: ${mainHead}。${complete ? '未驗證納入；不代表程式碼不存在（可能 squash／rebase／cherry-pick）。' : '所需 commit 未取得，無法判定。'}` };
      }
    }
    const node = graph.nodes.get(pr.number);
    const parents = data.pulls.filter(p => p.number !== pr.number && p.state === 'open' && p.headRef && p.headRef === pr.baseRef);
    const targets = data.branches.filter(b => b.name === pr.baseRef);
    const parent = node?.parent ?? null;
    let badStack = false;
    let ancestor = node;
    const seen = new Set<number>();
    while (ancestor) {
      if (ancestor.issue || seen.has(ancestor.pr.number)) { badStack = true; break; }
      seen.add(ancestor.pr.number);
      ancestor = ancestor.parent === null ? undefined : graph.nodes.get(ancestor.parent);
    }
    const badRoute = !pr.headRef || !pr.baseRef || pr.headRef === pr.baseRef || badStack
      || parents.length > 1 || targets.length > 1 || (!targets.length && parent === null);
    let relationship: Relationship = { kind: 'unknown', label: 'UNKNOWN', evidence: '缺少、重複或循環的 source／target；無法驗證關係。', parent: null };
    if (!badRoute) {
      relationship = { kind: 'reported', label: 'PR base（未驗證合併）', evidence: '僅為 PR 回報的 base metadata；不代表 fork、合併或 Git ancestry。', parent };
      const targetHead = targets[0]?.headSha;
      if (healthy && !mismatch && mergeEvidence(pr, index) === 'verified_merge_commit' && targetHead
        && isAncestor(index, pr.mergeCommitSha, targetHead) === true) {
        relationship = { kind: 'verified', label: 'Git relationship · VERIFIED', evidence: `merge ${pr.mergeCommitSha} 的 parent 包含 PR head ${pr.headSha}；merge 是 ${pr.baseRef} head ${targetHead} 的祖先。`, parent };
      }
    }
    return { pr, main, relationship };
  });
}
