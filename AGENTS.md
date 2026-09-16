# AGENTS.md — 재고관리 PoC 진입점

이 파일이 모든 작업의 시작점이다. **문서를 한꺼번에 읽지 않는다.**
질문 유형을 아래 표에서 고르고, 1차 문서의 **해당 절만** 읽는다. 거기서 판단할 수 없을 때만 한 단계씩 넓힌다.

규칙의 원본은 [docs/harness/01-ssot.md](docs/harness/01-ssot.md)(이하 SSOT)다.
**파일을 수정하는 작업이면 SSOT §0(충돌 정책 · 보호 정책)을 먼저 읽는다.**

## 라우팅

| 질문 유형                                        | 1차                                                    | 2차 (판단 안 될 때)                                                                               | 3차                                                                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 충돌·권한 — "이거 고쳐도 돼?", 문서끼리 다름                 | SSOT §0                                               | — (넓히지 않고 `NEEDS_HUMAN` 선언)                                                                 | —                                                                                                                                                                           |
| 기능 요구·범위 — "이 기능 해야 해?", "범위 밖이야?"           | SSOT §1                                               | `docs/01-requirements.md` §3 해당 F · §6                                                      | `docs/03-scenarios.md` 해당 S                                                                                                                                                 |
| 재고 도메인 규칙 — 로트, FEFO/LEFO, 사유, 팝업 정산, 폐기, 취소 | SSOT §1 · §2                                          | `01-requirements.md` §2 · F5-1 · F7 / `06-architecture.md` §4                               | `src/lib/stock.ts` · `fefo.ts` · `popup.ts`                                                                                                                                 |
| 구조·기술 선택·데이터 흐름·인증                           | SSOT §2 (원문 정정 포함)                                    | `docs/06-architecture.md` 해당 절 (§1 스택 · §3 모델 · §5 흐름 · §6 인증 · §8 동시성)                     | `prisma/schema.prisma`, `src/`                                                                                                                                              |
| 검증·테스트·완료 기준                                 | SSOT §3                                               | `docs/harness/02-verification.md` 해당 절 (§2 파이프라인 · §3 아키텍처 규칙 B1~B6 · §4 알려진 빈틈 · §5 예정·미정) | `01-requirements.md` §7 · `06-architecture.md` §9 / `tests/` · `scripts/check-architecture.ts` · `scripts/prepare-verify.ts` · `scripts/verify-*.ts` |
| 루프·시도 횟수·세션 복구 — "몇 번까지 해?", "이어서 하려면?"  | `docs/harness/03-loop.md` 해당 절 (§1 규칙 · §3 기록 양식 · §4 복구 절차) | 해당 Issue의 코멘트 이력 (시도 횟수의 원본)                                                       | SSOT §4 (검증과의 경계)                                                                                                                                                           |
| UI·디자인·접근성                                   | `docs/05-design.md` 해당 절                              | `mockups/final.html` · `03-scenarios.md` §6 (설계 원칙)                                         | `src/components/`                                                                                                                                                           |
| 사용자·시나리오                                     | `docs/03-scenarios.md` 해당 S                           | `docs/02-personas.md`                                                                       | —                                                                                                                                                                           |
| 실행·명령어·환경 설정                                 | `README.md`                                           | `package.json` · `.env.example`                                                             | —                                                                                                                                                                           |
| Next.js 16 API 사용법                           | 아래 Next.js 블록 → `node_modules/next/dist/docs/` 해당 가이드 | —                                                                                           | —                                                                                                                                                                           |

## 탐색 범위를 넓히는 규칙

1. 1차 문서에서 답이 나오면 **거기서 멈춘다.**
2. 넓힐 때는 표의 **다음 칸 하나씩**만 넓힌다. 원문은 파일 전체가 아니라 해당 절만 읽는다.
3. 표에 없는 질문은 SSOT §1 · §2에서 시작해 가장 가까운 행을 따른다.
4. 3차까지 봐도 판단할 수 없으면 추측하지 않고 `NEEDS_HUMAN`을 선언한다. SSOT의 **미정** 항목이면 "미정"이라고 답한다.
5. 읽은 문서끼리 또는 문서와 코드가 다르면 SSOT §0 충돌 정책을 따르고, 거기 없는 경우는 `NEEDS_HUMAN`을 선언한다.
6. 답할 때는 근거로 삼은 문서와 절을 밝힌다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
