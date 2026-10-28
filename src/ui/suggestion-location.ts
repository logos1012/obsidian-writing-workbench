import type { Review } from '../domain/model';
import { composeReview } from '../domain/review';

export interface TextLocation { start: number; end: number; paragraph: number; line: number }

// Calculate the accepted offset map once per review. Looking up each card used
// to revalidate every proposal and scan the entire draft, which became costly
// when pointer movement crossed many suggestions in a long document.
export function suggestionLocations(draft: string, review: Review): Map<string, TextLocation> {
  if (draft !== review.expected) return new Map();
  try { if (composeReview(review) !== draft) return new Map(); } catch { return new Map(); }
  const ordered = review.suggestions
    .map(proposal => ({ proposal, originalStart: review.original.indexOf(proposal.before) }))
    .sort((a, b) => a.originalStart - b.originalStart);
  const lineStarts: number[] = [], paragraphStarts: number[] = [];
  for (let i = 0; i < draft.length; i++) {
    if (draft.charCodeAt(i) === 10) lineStarts.push(i + 1);
    if (draft.charCodeAt(i) === 10 && (i === 0 || draft.charCodeAt(i - 1) !== 10)) {
      let next = i + 1;
      while (next < draft.length && (draft.charCodeAt(next) === 9 || draft.charCodeAt(next) === 32)) next++;
      if (draft.charCodeAt(next) === 10) {
        while (draft.charCodeAt(next) === 10) next++;
        paragraphStarts.push(next);
      }
    }
  }
  const countThrough = (starts: number[], index: number) => {
    let low = 0, high = starts.length;
    while (low < high) { const middle = (low + high) >>> 1; if (starts[middle]! <= index) low = middle + 1; else high = middle; }
    return low;
  };
  const locations = new Map<string, TextLocation>(); let delta = 0;
  for (const { proposal, originalStart } of ordered) {
    const start = originalStart + delta;
    const end = start + (proposal.status === 'accepted' ? proposal.after.length : proposal.before.length);
    locations.set(proposal.id, { start, end, paragraph: 1 + countThrough(paragraphStarts, start), line: 1 + countThrough(lineStarts, start) });
    if (proposal.status === 'accepted') delta += proposal.after.length - proposal.before.length;
  }
  return locations;
}

// Use original ranges plus accepted edit offsets, not a search for replacement
// text: two accepted suggestions can legitimately produce identical text.
export function suggestionLocation(draft: string, review: Review, id: string): TextLocation | null {
  return suggestionLocations(draft, review).get(id) ?? null;
}

export function locationLabel(location: TextLocation | null): string {
  if (!location) return '원고 변경됨 · 다시 검토해 주세요';
  return `${location.start === location.end ? '삭제 위치' : '원고'} ${location.paragraph}문단 · ${location.line}행`;
}
