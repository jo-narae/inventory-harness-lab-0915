# 02. 검증 — 변경을 확인하는 방법

> 작성일: 2026-09-15 · 기준 커밋: `bef7596`
> [SSOT](01-ssot.md) §3의 상세다. SSOT와 다르면 SSOT를 따르고, 이 문서의 변경은 사람이 한다.
> 참고 원문: [01-requirements.md](../01-requirements.md) §7 · [06-architecture.md](../06-architecture.md) §9 · [07-plan.md](../07-plan.md) §2

---

## 1. 핵심 규칙

[SSOT](01-ssot.md) §3의 **VER-1~5**를 따른다. 규칙 원본은 SSOT다.

이 문서는 **판정만** 다룬다. 실패했을 때 몇 번까지 다시 시도하고 언제 멈추는지는 [03-loop.md](03-loop.md)가 맡는다.

---

## 2. 파이프라인

| 단계 | 스크립트 | 검사 |
|---|---|---|
| 준비 | `verify:prepare` | `verify.db` 삭제 → migrate → 시드 |
| 타입 | `typecheck` | `tsc --noEmit` |
| 린트 | `lint` | ESLint |
| 아키텍처 | `arch` | 경로 규칙 B1~B6 (§3) |
| 테스트 | `verify:test` | `verify.db`에서 vitest — 06 §9 불변식 |
| 빌드 | `build` | `next build` |

CI는 `.github/workflows/verify.yml` (ubuntu · Node 22). POSIX 셸을 전제한다.
`verify.db` 경로는 `scripts/prepare-verify.ts`와 `package.json`의 `verify:test` 두 곳에 있다.

---

## 3. 아키텍처 규칙 — `scripts/check-architecture.ts`

| # | 규칙 | 근거 |
|---|---|---|
| B1 | `'use server'`는 `src/actions/`에만 | 06 §2 |
| B2 | Server Action마다 `requireUser()` | 06 §6 |
| B3 | 클라이언트 모듈은 db · Prisma를 값으로 import하지 않는다 (간접 포함) | ARCH-5 |
| B4 | API 라우트 없음 | SSOT §2 |
| B5 | 상태관리 라이브러리 없음 | SSOT §2 |
| B6 | 정정된 경로 — `proxy.ts` · `lib/date.ts` · `globals.css`의 `@theme` | SSOT §2 |

DB 쓰기 규칙은 §5의 DB 검증 단계에서 다룬다.

---

## 4. 알려진 빈틈

- 06 §9 불변식 #4(발송 → 도착 전후 총합)는 단순 이동 1건만 테스트한다
- `expiry.test.ts`(07 M2)가 없다
- 테스트 환경이 `node`라 화면 · Server Action은 자동 검증 밖이다 → 07 §2 B~E를 사람이 확인한다
- 01 §7의 8 · 9 · 11은 M7 화면이 없어 아직 확인할 수 없다

---

## 5. 예정 · 미정

**예정 — DB 검증 단계**: `applyMovement` 단일 통로 · Movement 수정 금지 · 트랜잭션 강제 · 쓰기 위치 · raw SQL 금지 · 상태값 상수.
상태값 상수는 현재 위반 3건 — `app/inbound/page.tsx:21 · 27`, `lib/inventory.ts:113`

**미정**
- verify가 실행하는 구성 파일과 `scripts/verify-*.ts`의 보호 범위
- `npm test` 단독 실행의 DB 격리 (지금은 `dev.db`)
- `verify-m1`의 파이프라인 편입 — exit code가 결과를 반영하지 않는다
- CI 체크를 PR 병합 필수 조건으로 둘지
- 성능 기준(1초) 측정 방법 (SSOT §1)
- CI 실제 실행 결과 — 아직 push 전
