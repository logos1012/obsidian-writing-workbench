import { describe, expect, it } from 'vitest';
import { harness, reply } from './helpers';
import { replaceUnique } from '../src/domain/review';
import { Workspace } from '../src/domain/workspace';
import { defaultSettings } from '../src/domain/model';

describe('review and author control', () => {
  it('does not change draft or document when receiving or rejecting suggestions', async () => {
    const h = harness(); const original = h.ws.project.draft;
    await h.ws.run('review', '검토', false);
    const review = h.ws.project.reviews[0]!;
    expect(h.ws.project.draft).toBe(original);
    await h.ws.decide(review.id, review.suggestions[0]!.id, 'rejected');
    expect(h.ws.project.draft).toBe(original); expect(h.getDocument()).toBe(original);
    expect(h.projectStore.value?.reviews[0]?.suggestions[0]?.status).toBe('rejected');
  });
  it('accepts only the selected change, then saves explicitly', async () => {
    const h = harness(); await h.ws.run('review', '검토', false);
    const review = h.ws.project.reviews[0]!;
    await h.ws.decide(review.id, review.suggestions[0]!.id, 'accepted');
    expect(h.ws.project.draft).toBe('반복 작업 시간이 줄었다. 내 경험이다.');
    expect(h.getDocument()).toBe('효율이 좋아졌다. 내 경험이다.');
    await h.ws.saveDocument(); expect(h.getDocument()).toBe(h.ws.project.draft);
  });
  it('blocks stale proposals after the author edits the draft', async () => {
    const h = harness(); await h.ws.run('review', '검토', false);
    const review = h.ws.project.reviews[0]!;
    await h.ws.edit({ draft: '내가 새로 고친 문장이다.' });
    await expect(h.ws.decide(review.id, review.suggestions[0]!.id, 'accepted')).rejects.toThrow('원고가 검토 이후');
    expect(h.ws.project.draft).toBe('내가 새로 고친 문장이다.');
  });
  it('blocks absent and ambiguous matches, including overlapping repetitions', () => {
    expect(() => replaceUnique('가나가나', '가나', '다')).toThrow('여러 곳');
    expect(() => replaceUnique('aaa', 'aa', 'b')).toThrow('여러 곳');
    expect(() => replaceUnique('하나', '둘', '셋')).toThrow('찾을 수');
    expect(replaceUnique('한 문장. 다음 문장.', '한 문장. ', '')).toBe('다음 문장.');
  });
  it('accepts non-overlapping proposals in sequence and prevents applying twice', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, suggestions: [...reply.suggestions, { before: '내 경험이다.', after: '직접 겪은 일이다.', reason: '구체화', sourceIds: [] }] });
    await h.ws.run('review', '검토', false); const review = h.ws.project.reviews[0]!;
    for (const s of review.suggestions) await h.ws.decide(review.id, s.id, 'accepted');
    expect(h.ws.project.draft).toBe('반복 작업 시간이 줄었다. 직접 겪은 일이다.');
    await expect(h.ws.decide(review.id, review.suggestions[0]!.id, 'accepted')).rejects.toThrow();
  });
  it('rolls back a failed acceptance persistence', async () => {
    const h = harness(); await h.ws.run('review', '검토', false);
    const review = h.ws.project.reviews[0]!; const original = h.ws.project.draft;
    h.projectStore.failure = true;
    await expect(h.ws.decide(review.id, review.suggestions[0]!.id, 'accepted')).rejects.toThrow('disk full');
    expect(h.ws.project.draft).toBe(original);
    expect(h.ws.project.reviews[0]!.suggestions[0]!.status).toBe('pending');
  });
  it('rejects an overlapping model response before presenting actionable edits', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, suggestions: [...reply.suggestions, { before: '좋아졌다.', after: '변했다.', reason: '중복된 제안', sourceIds: [] }] });
    await expect(h.ws.run('review', '검토', false)).rejects.toThrow('중복 수정');
    expect(h.ws.project.reviews).toHaveLength(0); expect(h.ws.project.draft).toBe('효율이 좋아졌다. 내 경험이다.');
  });
});

describe('file writes and recovery', () => {
  it('does not overwrite another editor and retains the working copy', async () => {
    const h = harness(); await h.ws.edit({ draft: '플러그인의 수정' }); h.setDocument('외부 편집 내용');
    await expect(h.ws.saveDocument()).rejects.toThrow('external modification');
    expect(h.getDocument()).toBe('외부 편집 내용'); expect(h.ws.project.draft).toBe('플러그인의 수정');
    await h.ws.reloadDocument(); expect(h.ws.project.draft).toBe('외부 편집 내용');
    expect(h.ws.project.revisions.some(r => r.text === '플러그인의 수정')).toBe(true);
  });
  it('records an intent before changing a file and recovers a crash after writing', async () => {
    const h = harness(); await h.ws.edit({ draft: '새 원고' });
    h.documents.compareAndSwap = async (_, expected, next) => {
      expect(h.projectStore.value?.pendingWrite).toMatchObject({ before: expected, after: next });
      h.setDocument(next); h.projectStore.failure = true;
    };
    await expect(h.ws.saveDocument()).rejects.toThrow('disk full');
    expect(h.projectStore.value?.pendingWrite?.after).toBe('새 원고');
    h.projectStore.failure = false;
    const restored = new Workspace(h.projectStore.value!, h.ws.preferences, h.projectStore, h.preferencesStore, h.documents, h.agent, () => defaultSettings);
    await restored.recoverWrite(); expect(restored.project.base).toBe('새 원고'); expect(restored.project.pendingWrite).toBeNull();
  });
  it('never changes a file if write-ahead persistence fails', async () => {
    const h = harness(); await h.ws.edit({ draft: '새 원고' }); h.projectStore.failure = true;
    await expect(h.ws.saveDocument()).rejects.toThrow(); expect(h.getDocument()).toBe('효율이 좋아졌다. 내 경험이다.');
  });
  it('restores an older draft without losing the current draft', async () => {
    const h = harness(); await h.ws.edit({ draft: '새 원고' });
    await h.ws.restoreRevision(h.ws.project.revisions[0]!.id);
    expect(h.ws.project.revisions.some(r => r.text === '새 원고')).toBe(true);
    expect(h.ws.project.draft).toBe('효율이 좋아졌다. 내 경험이다.');
  });
});

describe('interview, context and preferences', () => {
  it('passes shared context and only approved preferences when switching providers', async () => {
    const h = harness();
    h.ws.preferences.items = [
      { id: 'a', text: '짧은 문장', reason: '', status: 'approved', provider: 'claude', createdAt: '' },
      { id: 'b', text: '무조건 반말', reason: '', status: 'pending', provider: 'claude', createdAt: '' },
    ];
    await h.ws.run('review', '첫 검토', false); await h.ws.chooseProvider('codex'); await h.ws.run('review', '다른 관점', true);
    const request = h.requests[1]!; expect(request.provider).toBe('codex');
    expect(request.prompt).toContain('첫 검토'); expect(request.prompt).toContain('짧은 문장'); expect(request.prompt).not.toContain('무조건 반말');
    expect(request.research).toBe(true);
  });
  it('does not produce a draft from an interview; stores exactly one question', async () => {
    const h = harness(''); h.agent.run = async () => ({ ...reply, diagnosis: [], suggestions: [], question: '최근 일하면서 생각이 바뀐 경험이 있나요?' });
    await h.ws.run('interview', '시작하자', false); expect(h.ws.project.draft).toBe('');
    expect(h.ws.project.messages.at(-1)?.text).toContain('경험이 있나요?');
  });
  it('rejects multiple interview questions', async () => {
    const h = harness(''); h.agent.run = async () => ({ ...reply, diagnosis: [], suggestions: [], question: '언제였나요? 왜 그랬나요?' });
    await expect(h.ws.run('interview', '시작', false)).rejects.toThrow('한 질문');
    expect(h.ws.project.messages).toHaveLength(1); expect(h.ws.project.draft).toBe('');
  });
  it('requires approval before learning a preference', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, preferences: [{ text: '과장된 수식어를 피한다', reason: '사용자가 요청함' }] });
    await h.ws.run('review', '검토', false); const preference = h.ws.preferences.items[0]!;
    expect(preference.status).toBe('pending'); await h.ws.preference(preference.id, 'approved');
    expect(h.preferencesStore.value?.items[0]?.status).toBe('approved');
    await h.ws.preference(preference.id, 'dismissed'); expect(h.preferencesStore.value?.items[0]?.status).toBe('dismissed');
  });
  it('rejects invalid source links in the response before changing the memo', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, memo: [{ key: '관점', text: '덮어쓰면 안 됨' }], suggestions: [{ ...reply.suggestions[0]!, sourceIds: ['missing'] }] });
    await expect(h.ws.run('review', '검토', false)).rejects.toThrow('출처 연결');
    expect(h.ws.project.memo[0]?.text).toBe(''); expect(h.ws.project.reviews).toHaveLength(0);
  });
  it('cancels the pending request, preserves the user turn, and unlocks the UI', async () => {
    const h = harness();
    h.agent.run = request => new Promise((_, reject) => { request.signal.addEventListener('abort', () => reject(new Error('취소됨')), { once: true }); });
    const work = h.ws.run('review', '검토', false);
    await new Promise(resolve => setTimeout(resolve, 10)); h.ws.cancel();
    await expect(work).rejects.toThrow('취소'); expect(h.ws.busy).toBe(false);
    expect(h.ws.project.messages).toHaveLength(1); expect(h.ws.project.reviews).toHaveLength(0);
  });
});
