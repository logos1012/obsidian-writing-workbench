import { describe, expect, it } from 'vitest';
import { ProjectSchema } from '../src/domain/model';
import { harness, reply } from './helpers';

async function accepted() {
  const h = harness(); await h.ws.run('review', '검토', false);
  const review = h.ws.project.reviews[0]!, proposal = review.suggestions[0]!;
  await h.ws.decide(review.id, proposal.id, 'accepted');
  return { ...h, review, proposal };
}

describe('undo acceptance', () => {
  it('returns to pending, permits another decision, and retains the decision history', async () => {
    const h = await accepted();
    await h.ws.undoAcceptance(h.review.id, h.proposal.id);
    expect(h.ws.project.draft).toBe(h.review.original);
    expect(h.proposal.status).toBe('pending');
    expect(h.review.expected).toBe(h.review.original);
    await h.ws.decide(h.review.id, h.proposal.id, 'accepted');
    await h.ws.undoAcceptance(h.review.id, h.proposal.id);
    await h.ws.decide(h.review.id, h.proposal.id, 'rejected');
    expect(h.review.decisions.map(e => e.action)).toEqual(['accepted', 'accept-undone', 'accepted', 'accept-undone', 'rejected']);
    expect(h.projectStore.value?.draft).toBe(h.review.original);
    expect(h.ws.project.revisions.some(r => r.text === '반복 작업 시간이 줄었다. 내 경험이다.')).toBe(true);
  });
  it.each([0, 1])('preserves the other acceptance when undoing proposal %s with colliding replacement text', async index => {
    const h = harness(); h.agent.run = async () => ({ ...reply, suggestions: [
      { ...reply.suggestions[0]!, after: '내 경험이다.' },
      { before: '내 경험이다.', after: '같은 결론이다.', reason: '수정', sourceIds: [] },
    ] });
    await h.ws.run('review', '검토', false); const review = h.ws.project.reviews[0]!;
    for (const s of review.suggestions) await h.ws.decide(review.id, s.id, 'accepted');
    expect(h.ws.project.draft).toBe('내 경험이다. 같은 결론이다.');
    await h.ws.undoAcceptance(review.id, review.suggestions[index]!.id);
    expect(h.ws.project.draft).toBe(index === 0 ? '효율이 좋아졌다. 같은 결론이다.' : '내 경험이다. 내 경험이다.');
    await h.ws.undoAcceptance(review.id, review.suggestions[1 - index]!.id);
    expect(h.ws.project.draft).toBe(review.original);
  });
  it('restores a deleted passage without searching for empty replacement text', async () => {
    const h = harness(); h.agent.run = async () => ({ ...reply, suggestions: [{ ...reply.suggestions[0]!, after: '' }] });
    await h.ws.run('review', '검토', false); const review = h.ws.project.reviews[0]!, s = review.suggestions[0]!;
    await h.ws.decide(review.id, s.id, 'accepted'); expect(h.ws.project.draft).toBe(' 내 경험이다.');
    await h.ws.undoAcceptance(review.id, s.id); expect(h.ws.project.draft).toBe(review.original);
  });
  it('refuses to undo after manual changes and preserves those changes', async () => {
    const h = await accepted(); await h.ws.edit({ draft: '내가 직접 다시 쓴 문장.' });
    const previous = structuredClone(h.ws.project);
    await expect(h.ws.undoAcceptance(h.review.id, h.proposal.id)).rejects.toThrow('따로 수정');
    expect(h.ws.project).toEqual(previous);
  });
  it('undoes a saved acceptance in the working copy and saves the reversal only explicitly', async () => {
    const h = await accepted(); await h.ws.saveDocument(); const saved = h.getDocument();
    await h.ws.undoAcceptance(h.review.id, h.proposal.id);
    expect(h.getDocument()).toBe(saved); expect(h.ws.project.draft).toBe(h.review.original);
    await h.ws.saveDocument(); expect(h.getDocument()).toBe(h.review.original);
  });
  it('rolls back the draft, proposal, snapshots, and decisions if persistence fails', async () => {
    const h = await accepted(); const previous = structuredClone(h.ws.project);
    h.projectStore.failure = true;
    await expect(h.ws.undoAcceptance(h.review.id, h.proposal.id)).rejects.toThrow('disk full');
    expect(h.ws.project).toEqual(previous); expect(h.projectStore.value?.draft).toBe(previous.draft);
  });
  it('loads older projects and can undo their accepted suggestions without erasing their prior decision', async () => {
    const h = await accepted();
    const old = JSON.parse(JSON.stringify(h.ws.project));
    delete old.reviews[0].decisions;
    for (const message of old.messages) { delete message.task; delete message.question; }
    h.ws.project = ProjectSchema.parse(old);
    expect(h.ws.project.reviews[0]?.decisions).toEqual([]);
    expect(h.ws.project.messages.map(m => m.text)).toEqual(h.projectStore.value?.messages.map(m => m.text));
    await h.ws.undoAcceptance(h.review.id, h.proposal.id);
    expect(h.ws.project.draft).toBe(h.review.original);
    expect(h.ws.project.reviews[0]?.decisions.map(e => e.action)).toEqual(['accepted', 'accept-undone']);
  });
  it('rejects undoing a pending or rejected suggestion', async () => {
    const h = await accepted(); await h.ws.undoAcceptance(h.review.id, h.proposal.id);
    await expect(h.ws.undoAcceptance(h.review.id, h.proposal.id)).rejects.toThrow('수락한 제안만');
    await h.ws.decide(h.review.id, h.proposal.id, 'rejected');
    await expect(h.ws.undoAcceptance(h.review.id, h.proposal.id)).rejects.toThrow('수락한 제안만');
  });
});
