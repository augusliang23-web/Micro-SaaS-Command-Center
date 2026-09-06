const VERDICT_COPY = {
  danger: {
    headline: 'AI 遇到問題，卡住了',
    fallbackExplanation: 'AI 目前卡住了，需要你看一下發生了什麼事。',
    actionLabel: '查看問題',
  },
  decision: {
    headline: 'AI 做完了，但有一個問題要問你',
    fallbackExplanation: 'AI 遇到一個只有你能回答的問題，需要你做個決定。',
    actionLabel: '查看並回答',
  },
  ready: {
    headline: '都檢查過了，可以繼續了',
    fallbackExplanation: 'AI 已經完成這個階段，等你確認就能繼續下一步。',
    actionLabel: '查看並確認',
  },
  waiting: {
    headline: 'AI 正在處理，請稍等',
    fallbackExplanation: 'AI 正在自動執行下一步，還沒輪到你。',
    actionLabel: 'AI 處理中…',
  },
};

const VERDICT_STYLE = {
  danger: { headlineColor: '#e11d48', borderColor: '#fda4af', iconBg: '#fff1f2', iconColor: '#e11d48' },
  decision: { headlineColor: '#b45309', borderColor: '#fcd34d', iconBg: '#fffbeb', iconColor: '#b45309' },
  ready: { headlineColor: '#059669', borderColor: '#a7f3d0', iconBg: '#ecfdf5', iconColor: '#059669' },
  waiting: { headlineColor: '#0369a1', borderColor: '#bae6fd', iconBg: '#f0f9ff', iconColor: '#0369a1' },
};

// Small, dependency-free relative-time formatter (deliberately not imported
// from server/githubRepos.mjs, which pulls in node:child_process and can't
// be bundled into the browser build).
function formatRelativeTime(dateInput, now = new Date()) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 60) return '剛剛';
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  if (diffHour < 24) return `${diffHour} 小時前`;
  if (diffDay === 1) return '昨天';
  return `${diffDay} 天前`;
}

function buildVerdict(level, explanation, source) {
  const copy = VERDICT_COPY[level];
  return {
    level,
    headline: copy.headline,
    explanation,
    actionLabel: copy.actionLabel,
    hasAction: level !== 'waiting',
    isWaiting: level === 'waiting',
    source,
  };
}

/**
 * Fallback path: translate a project's manually-set `waitingState`/`blocker`/
 * `nextAction` fields (the only signal available before/without a real
 * GitHub repo link) into a verdict.
 *
 * Known limitation: `explanation` reuses that free text as-is, which may
 * still contain technical wording — a pure rule table cannot rewrite
 * arbitrary free text into plain language without an AI call, which this
 * phase intentionally avoids (see docs/superpowers/plans, 2026-09-06).
 */
function getVerdictFromManualFields(project) {
  if (project.waitingState === 'BLOCKED') {
    return buildVerdict('danger', project.blocker || VERDICT_COPY.danger.fallbackExplanation, 'manual');
  }
  if (project.waitingState === 'WAITING_FOR_HUMAN' && project.blocker) {
    return buildVerdict('decision', project.blocker, 'manual');
  }
  if (project.waitingState === 'WAITING_FOR_HUMAN') {
    return buildVerdict('ready', project.nextAction || VERDICT_COPY.ready.fallbackExplanation, 'manual');
  }
  return buildVerdict('waiting', project.nextAction || VERDICT_COPY.waiting.fallbackExplanation, 'manual');
}

/**
 * Real path: translate a `fetchPullRequestStatus()` snapshot (server/
 * githubPullStatus.mjs) into a verdict. No manual click drives this — it is
 * a pure function of the PR's actual CI/review/merge state.
 *
 * Known limitation: GitHub has no equivalent of a "needs a product decision"
 * signal, so this path never returns the 'decision' level — only projects
 * still using getVerdictFromManualFields() (no real repo link) can surface
 * one. Also, 'merged' means the code landed on the default branch, not that
 * it was deployed anywhere — the explanation says so explicitly rather than
 * implying production is updated.
 */
function getVerdictFromGithub(githubState) {
  if (githubState.state === 'none') {
    return buildVerdict('waiting', '還沒有看到任何程式碼變更，AI 可能還在準備中。', 'github');
  }

  if (githubState.state === 'merged') {
    const when = githubState.mergedAt ? `（${formatRelativeTime(githubState.mergedAt)}）` : '';
    return buildVerdict(
      'ready',
      `最新的修改（PR #${githubState.prNumber}）${when}已經合併進主分支了。如果你有另外的上線流程，記得手動更新正式環境。`,
      'github',
    );
  }

  if (githubState.state === 'active') {
    // The repo has commits past the last known merged PR — likely direct
    // pushes to the default branch rather than a PR-reviewed change. There
    // is no PR/review signal to inspect here, only the commit itself.
    const when = githubState.lastCommitAt ? `（${formatRelativeTime(githubState.lastCommitAt)}）` : '';
    if (githubState.ciStatus === 'failing') {
      return buildVerdict(
        'danger',
        `主分支${when}直接更新的內容沒有通過自動檢查（「${githubState.lastCommitMessage}」），需要請 AI 修好。`,
        'github',
      );
    }
    return buildVerdict(
      'waiting',
      `主分支${when}有新的更新（不是透過 PR）：「${githubState.lastCommitMessage}」，看起來還在調整中，暫時不需要你做什麼。`,
      'github',
    );
  }

  // githubState.state === 'open'
  if (githubState.isDraft) {
    return buildVerdict('waiting', 'AI 還在準備這次的修改，還沒有標記完成，先不用管它。', 'github');
  }
  if (githubState.ciStatus === 'failing') {
    return buildVerdict('danger', 'AI 最新的修改沒有通過自動檢查，需要請 AI 修好再繼續。', 'github');
  }
  if (githubState.reviewDecision === 'changes_requested') {
    return buildVerdict('danger', '有人對這次修改提出了需要修正的意見，需要請 AI 處理。', 'github');
  }
  if (githubState.ciStatus === 'running') {
    return buildVerdict('waiting', 'AI 剛提交了新的修改，自動檢查正在執行中。', 'github');
  }
  return buildVerdict('ready', '自動檢查都通過了，可以把這次的修改合併進去了。', 'github');
}

/**
 * Deterministic, rule-based plain-language verdict for a project. Pass a
 * `githubState` (from `fetchPullRequestStatus()`) when the project is
 * linked to a real repo to drive the verdict from real PR/CI/review signals
 * instead of the manually-set fields — see docs/superpowers/issue-drafts
 * (2026-09-05 live GitHub state) for why manual clicking isn't the source
 * of truth once a project is really connected.
 */
export function getVerdict(project, githubState) {
  if (githubState) {
    return getVerdictFromGithub(githubState);
  }
  return getVerdictFromManualFields(project);
}

export function getVerdictStyle(level) {
  return VERDICT_STYLE[level] || VERDICT_STYLE.waiting;
}
