import { z } from 'zod';
import { WritingModeSchema, type WritingMode } from './writing-mode';

export const ProviderSchema = z.enum(['claude', 'codex']);
export type Provider = z.infer<typeof ProviderSchema>;
export const memoKeys = ['관점', '독자가 얻는 것', '근거', '반론·범위', '생각의 이동', '살릴 말·버릴 말', '개요'] as const;
const MemoSchema = z.object({ key: z.enum(memoKeys), text: z.string().max(12000) }).strict();
const SourceSchema = z.object({
  id: z.string().min(1).max(80), title: z.string().max(500),
  url: z.string().max(3000), excerpt: z.string().max(4000),
  relation: z.enum(['supports', 'contradicts', 'unverified']),
}).strict();
const DiagnosisSchema = z.object({
  criterion: z.enum(['주장', '논리', '근거', '독자 가치', '문체']),
  severity: z.enum(['strength', 'improve', 'verify']),
  detail: z.string().max(6000), quote: z.string().max(6000),
}).strict();
const ProposalSchema = z.object({
  before: z.string().min(1).max(20000), after: z.string().max(20000),
  reason: z.string().min(1).max(6000), sourceIds: z.array(z.string()).max(20),
}).strict();
const PreferenceProposalSchema = z.object({ text: z.string().min(1).max(2000), reason: z.string().max(2000) }).strict();
export const AgentReplySchema = z.object({
  message: z.string().min(1).max(16000),
  question: z.string().max(1500),
  memo: z.array(MemoSchema).max(7),
  diagnosis: z.array(DiagnosisSchema).max(20),
  suggestions: z.array(ProposalSchema).max(12),
  sources: z.array(SourceSchema).max(20),
  preferences: z.array(PreferenceProposalSchema).max(5),
}).strict();
export type AgentReply = z.infer<typeof AgentReplySchema>;
export const replyJsonSchema = z.toJSONSchema(AgentReplySchema, { target: 'draft-7' });

export const SettingsSchema = z.object({
  draftFolder: z.string().default(''),
  draftFolders: z.array(z.string()).default([]),
  defaultMode: WritingModeSchema.default('linkedin'),
  claudePath: z.string().default(''), codexPath: z.string().default(''),
  claudeModel: z.string().default(''), codexModel: z.string().default(''),
  timeoutSeconds: z.number().int().min(30).max(1800).default(300),
}).strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const defaultSettings = SettingsSchema.parse({});
const PreferenceSchema = z.object({
  id: z.string(), text: z.string(), reason: z.string(), provider: ProviderSchema,
  status: z.enum(['pending', 'approved', 'dismissed']), createdAt: z.string(),
}).strict();
export const PreferencesSchema = z.object({ version: z.literal(1), items: z.array(PreferenceSchema) }).strict();
export type Preferences = z.infer<typeof PreferencesSchema>;
const MessageSchema = z.object({
  id: z.string(), role: z.enum(['user', 'assistant']), text: z.string(),
  provider: ProviderSchema, createdAt: z.string(),
  task: z.enum(['interview', 'outline', 'review']).optional(),
  question: z.string().optional(),
}).strict();
const ReviewSchema = z.object({
  id: z.string(), provider: ProviderSchema, createdAt: z.string(),
  original: z.string(), expected: z.string(), message: z.string(),
  diagnosis: z.array(DiagnosisSchema), sources: z.array(SourceSchema),
  suggestions: z.array(ProposalSchema.extend({
    id: z.string(), status: z.enum(['pending', 'accepted', 'rejected']),
  })),
  decisions: z.array(z.object({
    suggestionId: z.string(), action: z.enum(['accepted', 'rejected', 'accept-undone']), createdAt: z.string(),
  }).strict()).default([]),
}).strict();
export type Review = z.infer<typeof ReviewSchema>;
const RevisionSchema = z.object({
  id: z.string(), createdAt: z.string(), label: z.string(), text: z.string(),
}).strict();
export const ProjectSchema = z.object({
  version: z.literal(1), id: z.string(), path: z.string(), provider: ProviderSchema,
  writingMode: WritingModeSchema.default('linkedin'),
  base: z.string(), draft: z.string(), memo: z.array(MemoSchema),
  materials: z.string(), composer: z.string().default(''), messages: z.array(MessageSchema), reviews: z.array(ReviewSchema),
  revisions: z.array(RevisionSchema),
  pendingWrite: z.object({ before: z.string(), after: z.string(), createdAt: z.string(), targetPath: z.string().optional() }).strict().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
}).strict();
export type Project = z.infer<typeof ProjectSchema>;
export const id = () => globalThis.crypto.randomUUID();
export const now = () => new Date().toISOString();
export function createProject(path: string, text: string, writingMode: WritingMode = 'linkedin'): Project {
  return {
    version: 1, id: id(), path, writingMode, provider: 'claude', base: text, draft: text,
    memo: memoKeys.map(key => ({ key, text: '' })), materials: '', composer: '', messages: [], reviews: [],
    revisions: [{ id: id(), createdAt: now(), label: '연결한 원고', text }], pendingWrite: null,
    createdAt: now(), updatedAt: now(),
  };
}
export function safeSourceUrl(url: string): string | null {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : null; }
  catch { return null; }
}
