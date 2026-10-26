import type { AgentReply, Project, Review } from './model';

export class ConflictError extends Error {
  constructor(message = '원고가 검토 이후 변경됐습니다. 현재 원고로 다시 검토해 주세요.') { super(message); this.name = 'ConflictError'; }
}
export function replaceUnique(text: string, before: string, after: string): string {
  const index = text.indexOf(before);
  if (!before || index < 0) throw new ConflictError('제안의 원문을 찾을 수 없습니다. 다시 검토해 주세요.');
  if (text.indexOf(before, index + 1) >= 0) throw new ConflictError('같은 문장이 여러 곳에 있습니다. 문맥을 포함해 다시 검토해 주세요.');
  return text.slice(0, index) + after + text.slice(index + before.length);
}
export function acceptSuggestion(project: Project, review: Review, suggestionId: string): string {
  const proposal = review.suggestions.find(s => s.id === suggestionId);
  if (!proposal || proposal.status !== 'pending') throw new ConflictError('이미 처리했거나 존재하지 않는 제안입니다.');
  if (project.draft !== review.expected) throw new ConflictError();
  return replaceUnique(project.draft, proposal.before, proposal.after);
}
export function validateSuggestions(original: string, proposals: AgentReply['suggestions']): void {
  const ranges: { start: number; end: number }[] = [];
  for (const proposal of proposals) {
    replaceUnique(original, proposal.before, proposal.before);
    const start = original.indexOf(proposal.before), end = start + proposal.before.length;
    if (ranges.some(range => start < range.end && end > range.start)) throw new ConflictError('AI 제안들이 같은 구절을 중복 수정합니다. 범위를 나눠 다시 검토해 주세요.');
    ranges.push({ start, end });
  }
}
