import { ProjectHealth, ProjectStage, GateStatus, WaitingState, CodexModelName } from './types';

export function getHealthBadgeStyle(health: ProjectHealth): { bg: string; text: string; border: string; dot: string } {
  switch (health) {
    case 'Healthy':
      return {
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-200',
        dot: 'bg-emerald-600',
      };
    case 'Attention':
      return {
        bg: 'bg-amber-50',
        text: 'text-amber-900',
        border: 'border-amber-200',
        dot: 'bg-amber-600',
      };
    case 'At Risk':
      return {
        bg: 'bg-orange-50',
        text: 'text-orange-900',
        border: 'border-orange-200',
        dot: 'bg-orange-600',
      };
    case 'Blocked':
      return {
        bg: 'bg-rose-50',
        text: 'text-rose-900',
        border: 'border-rose-200',
        dot: 'bg-rose-600',
      };
  }
}

export function getStageBadgeStyle(stage: ProjectStage): { bg: string; text: string; border: string } {
  switch (stage) {
    case 'Prototype':
      return { bg: 'bg-stone-100', text: 'text-stone-700', border: 'border-stone-300/80' };
    case 'Alpha':
      return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300/80' };
    case 'Beta':
      return { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200/80' };
    case 'Production':
      return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200/80' };
  }
}

export function getModelBadgeStyle(model: CodexModelName): { bg: string; text: string; border: string; accent: string } {
  switch (model) {
    case 'Luna':
      return { bg: 'bg-stone-100', text: 'text-stone-800', border: 'border-stone-300', accent: '#44403c' };
    case 'Terra':
      return { bg: 'bg-sky-50', text: 'text-sky-900', border: 'border-sky-200', accent: '#0369a1' };
    case 'Sol':
      return { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-200', accent: '#b45309' };
    case 'Not Assigned':
      return { bg: 'bg-stone-100', text: 'text-stone-500', border: 'border-stone-200', accent: '#78716c' };
  }
}

export function getGateStatusBadgeStyle(status: GateStatus): { bg: string; text: string; border: string; icon: string } {
  switch (status) {
    case 'COMPLETED':
      return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', icon: '✓' };
    case 'CURRENT':
      return { bg: 'bg-sky-50', text: 'text-sky-900', border: 'border-sky-300', icon: '●' };
    case 'CHANGES_REQUIRED':
      return { bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-300', icon: '⚠️' };
    case 'FAILED':
      return { bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-300', icon: '✕' };
    case 'PENDING':
      return { bg: 'bg-stone-100', text: 'text-stone-500', border: 'border-stone-200', icon: '○' };
    case 'SKIPPED':
      return { bg: 'bg-stone-50', text: 'text-stone-400', border: 'border-stone-200', icon: '–' };
  }
}

export function getWaitingStateBadge(waitingState: WaitingState): { label: string; bg: string; text: string; border: string; pulse: boolean } {
  switch (waitingState) {
    case 'WAITING_FOR_HUMAN':
      return { label: 'Waiting for Human', bg: 'bg-amber-50', text: 'text-amber-900', border: 'border-amber-300', pulse: true };
    case 'AI_RUNNING':
      return { label: 'AI Executing', bg: 'bg-sky-50', text: 'text-sky-900', border: 'border-sky-300', pulse: true };
    case 'BLOCKED':
      return { label: 'Blocked', bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-300', pulse: false };
    case 'AUTOMATION_IDLE':
      return { label: 'Idle', bg: 'bg-stone-100', text: 'text-stone-600', border: 'border-stone-200', pulse: false };
  }
}
