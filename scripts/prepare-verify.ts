/**
 * 검증 준비 — npm run verify가 매번 깨끗하고 같은 상태에서 시작하게 한다.
 *
 * 개발용 prisma/dev.db는 건드리지 않는다. 검증 전용 prisma/verify.db를
 * 지우고 → 스키마 적용 → 시드 순서로 새로 만든다.
 * verify의 테스트 단계(verify:test)는 이 DB를 쓰므로, 로컬 DB에 무엇이 쌓여 있든 같은 시드 위에서 돈다.
 */
import { rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

// package.json의 verify:test와 같은 경로를 쓴다
const VERIFY_DB = 'prisma/verify.db'
const env = { ...process.env, DATABASE_URL: `file:./${VERIFY_DB}` }

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit', env })

console.log(`\n▸ 검증용 DB를 새로 만듭니다 (${VERIFY_DB})\n`)
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  rmSync(`${VERIFY_DB}${suffix}`, { force: true })
}
run('npx prisma generate') // 시드가 생성 클라이언트를 쓴다 — 새로 clone한 상태 대비
run('npx prisma migrate deploy')
run('npx tsx prisma/seed.ts')
console.log(`\n▸ 준비 완료 — 테스트는 ${VERIFY_DB}에서 돈다 (dev.db는 그대로)\n`)
