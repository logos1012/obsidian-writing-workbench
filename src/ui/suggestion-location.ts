import type { Review } from '../domain/model';
import { composeReview } from '../domain/review';

export interface TextLocation { start: number; end: number; paragraph: number; line: number }

// Use original ranges plus accepted edit offsets, not a search for replacement
// text: two accepted suggestions can legitimately produce identical text.
export function suggestionLocation(draft: string, review: Review, id: string): TextLocation | null {
  const proposal = review.suggestions.find(s => s.id === id);
  if (!proposal || draft !== review.expected) return null;
  try { if (composeReview(review) !== draft) return null; } catch { return null; }
  const originalStart = review.original.indexOf(proposal.before);
  let start = originalStart;
  for (const other of review.suggestions) {
    if (other.status === 'accepted' && review.original.indexOf(other.before) < originalStart) start += other.after.length - other.before.length;
  }
  const end = start + (proposal.status === 'accepted' ? proposal.after.length : proposal.before.length);
  const prefix = draft.slice(0, start);
  return { start, end, paragraph: 1 + (prefix.match(/\n[\t ]*\n+/g)?.length ?? 0), line: 1 + (prefix.match(/\n/g)?.length ?? 0) };
}

export function locationLabel(location: TextLocation | null): string {
  if (!location) return '원고 변경됨 · 다시 검토해 주세요';
  return `${location.start === location.end ? '삭제 위치' : '원고'} ${location.paragraph}문단 · ${location.line}행`;
}
