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

/**
 * Deterministic, rule-based translation of a project's existing engineering
 * fields into a plain-language verdict. Deliberately not AI-generated: see
 * docs/superpowers/plans (2026-09-06 plain-language redesign) for why.
 *
 * Known limitation: `explanation` falls back to the project's existing
 * `blocker` / `nextAction` free text when present, which may still contain
 * some technical wording (it was originally authored for an engineering
 * audience) — a pure rule table cannot rewrite arbitrary free text into
 * plain language without an AI call, which this phase intentionally avoids.
 */
export function getVerdict(project) {
  let level;
  let explanation;

  if (project.waitingState === 'BLOCKED') {
    level = 'danger';
    explanation = project.blocker || VERDICT_COPY.danger.fallbackExplanation;
  } else if (project.waitingState === 'WAITING_FOR_HUMAN' && project.blocker) {
    level = 'decision';
    explanation = project.blocker;
  } else if (project.waitingState === 'WAITING_FOR_HUMAN') {
    level = 'ready';
    explanation = project.nextAction || VERDICT_COPY.ready.fallbackExplanation;
  } else {
    level = 'waiting';
    explanation = project.nextAction || VERDICT_COPY.waiting.fallbackExplanation;
  }

  const copy = VERDICT_COPY[level];
  return {
    level,
    headline: copy.headline,
    explanation,
    actionLabel: copy.actionLabel,
    hasAction: level !== 'waiting',
    isWaiting: level === 'waiting',
  };
}

export function getVerdictStyle(level) {
  return VERDICT_STYLE[level] || VERDICT_STYLE.waiting;
}
