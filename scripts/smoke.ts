import { CliAgent } from '../src/providers/cli';
import { createProject, defaultSettings, type Provider } from '../src/domain/model';
import { buildPrompt } from '../src/domain/prompt';
import { validateSuggestions } from '../src/domain/review';
import { safeSourceUrl } from '../src/domain/model';
import { promises as fs } from 'node:fs';

const providers: Provider[] = process.argv.includes('--claude') ? ['claude'] : process.argv.includes('--codex') ? ['codex'] : ['claude', 'codex'];
const reviewMode = process.argv.includes('--review');
const research = process.argv.includes('--research');
const results: { provider: Provider; passed: boolean; detail: string }[] = [];
for (const provider of providers) {
  const project = createProject('synthetic-smoke.md', reviewMode ? '옵시디안의 노트는 로컬 Markdown 파일로 저장됩니다. 그래서 모든 상황에서 데이터 손실이 절대 없습니다.' : '');
  const prompt = buildPrompt(project, { version: 1, items: [] }, reviewMode ? 'review' : 'interview', reviewMode
    ? `가상 테스트 원고입니다. 과장된 두 번째 문장을 반드시 수정 제안으로 보여 주세요.${research ? ' 첫 문장은 Obsidian 공식 도움말을 웹에서 찾아 확인하고 공식 출처를 적어 주세요.' : ' 외부 검색은 하지 말고 사실 확인은 보류하세요.'}`
    : '이것은 연결 검증용 가상 대화입니다. 업무에서 배운 점을 글로 쓰고 싶습니다. 첫 질문 하나만 해 주세요. 실제 자료 검색은 하지 마세요.', research);
  const controller = new AbortController();
  const cancel = () => controller.abort(); process.once('SIGINT', cancel);
  const started = Date.now();
  try {
    const reply = await new CliAgent().run({ provider, prompt, research, signal: controller.signal, settings: { ...defaultSettings, timeoutSeconds: research ? 150 : 90 } });
    if (reviewMode) {
      if (!reply.diagnosis.length || !reply.suggestions.length) throw new Error('Review contract was not followed');
      validateSuggestions(project.draft, reply.suggestions);
      if (research && !reply.sources.some(source => safeSourceUrl(source.url))) throw new Error('No usable research citation returned');
    } else if (!reply.question.trim() || reply.suggestions.length || (reply.question.match(/[?？]/g)?.length ?? 0) > 1) throw new Error('Interview contract was not followed');
    results.push({ provider, passed: true, detail: `Structured ${reviewMode ? 'review' : 'interview'} reply validated in ${Math.round((Date.now() - started) / 1000)}s; ${reply.sources.length} sources` });
    console.log(`${provider}: PASS — structured ${reviewMode ? 'review' : 'interview'} response validated (${reply.suggestions.length} proposals, ${reply.sources.length} sources)`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ provider, passed: false, detail }); console.error(`${provider}: FAIL — ${detail}`);
  } finally { process.off('SIGINT', cancel); }
}
await fs.mkdir('.test-artifacts', { recursive: true });
await fs.writeFile(`.test-artifacts/cli-smoke-${reviewMode ? 'review' : 'interview'}${research ? '-research' : ''}.json`, JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2));
if (results.some(result => !result.passed)) process.exitCode = 1;
