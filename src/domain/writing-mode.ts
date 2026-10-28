import { z } from 'zod';

export const WritingModeSchema = z.enum(['linkedin', 'essay', 'marketing', 'general']);
export type WritingMode = z.infer<typeof WritingModeSchema>;
export const writingModes = {
  linkedin: { label: 'LinkedIn', description: '경험과 전문성을 독자에게 전달하는 글', labels: ['관점', '독자가 얻는 것', '근거', '반론·범위', '생각의 이동', '살릴 말·버릴 말', '개요'], guidance: 'LinkedIn: 첫 문장의 관심 유도, 전문적 경험의 구체성, 독자가 가져갈 통찰, 모바일 가독성을 살핀다. 참여 유도 문구나 해시태그를 강요하지 않는다.' },
  essay: { label: '에세이', description: '경험과 감정에서 의미를 발견하는 글', labels: ['주제와 시선', '독자에게 남길 여운', '경험·장면', '거리 두기·성찰', '감정과 서사의 흐름', '목소리·표현', '개요'], guidance: '에세이: 구체적 장면, 감정의 진실성, 화자의 목소리, 서사와 성찰의 흐름, 결말의 여운을 중심으로 질문하고 검토한다. 개인 경험을 통계로 입증하라고 강요하지 않는다. 없는 경험이나 감정은 만들지 않는다.' },
  marketing: { label: '마케팅', description: '고객의 문제와 제안을 연결하는 글', labels: ['핵심 제안', '고객과 해결할 문제', '신뢰 근거', '구매 장벽·조건', '설득 흐름·행동 유도', '브랜드 말투', '개요'], guidance: '마케팅: 타깃 고객, 문제, 가치 제안, 차별점, 입증 가능한 근거, 구매 장벽, 행동 유도의 일관성을 중심으로 질문하고 검토한다. 과장, 보장되지 않은 성과, 가짜 후기와 긴급성을 만들지 않는다. 채널과 목표가 없으면 대화로 확인한다.' },
  general: { label: '일반 글쓰기', description: '목적과 독자에 맞춰 자유롭게 쓰는 글', labels: ['목적과 주제', '독자와 전달할 가치', '자료·근거', '범위와 한계', '전개 흐름', '문체·표현', '개요'], guidance: '일반 글쓰기: 사용자가 정한 목적, 독자, 형식에 맞춰 명확성, 구성, 사실의 정확성, 문체를 검토한다. 특정 플랫폼의 길이나 마케팅 행동 유도를 강요하지 않는다.' },
} satisfies Record<WritingMode, { label: string; description: string; labels: string[]; guidance: string }>;
