/**
 * 아키텍처 경로 검사 — 코드가 06-architecture · SSOT §2가 정한 경로를 지키는지 확인한다.
 * 파일 위치와 import 관계만 보므로 DB 없이 돈다.
 * DB 쓰기 규칙(applyMovement 단일 통로 · 트랜잭션 등)은 DB 검증 단계에서 따로 다룬다.
 *
 *   B1  'use server'는 src/actions/에만 둔다                                  (06 §2)
 *   B2  Server Action마다 requireUser()로 세션을 확인한다                       (06 §6)
 *   B3  클라이언트 모듈은 서버 전용 모듈(db · Prisma)을 값으로 import하지 않는다   (ARCH-5 · 06 §7.5)
 *   B4  API 라우트를 만들지 않는다                                              (SSOT §2)
 *   B5  상태관리 라이브러리를 쓰지 않는다                                        (SSOT §2 · 06 §5)
 *   B6  정정된 경로를 지킨다 — proxy.ts · lib/date.ts · globals.css @theme       (SSOT §2 원문 정정)
 *
 * 하나라도 어기면 exit 1 — npm run verify가 여기서 멈춘다.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const ACTIONS = path.join(SRC, 'actions')
const GENERATED = path.join(SRC, 'generated')
const DB_MODULE = path.join(SRC, 'lib', 'db.ts')

const rel = (file: string) => path.relative(ROOT, file)

function walk(dir: string, pattern: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (full === GENERATED) continue
    if (statSync(full).isDirectory()) walk(full, pattern, out)
    else if (pattern.test(name)) out.push(full)
  }
  return out
}

// ───────── 소스 파싱

type Module = { file: string; sf: ts.SourceFile; directive: string | null }
const modules = new Map<string, Module>()

function load(file: string): Module {
  const cached = modules.get(file)
  if (cached) return cached
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
  const mod = { file, sf, directive: directiveOf(sf.statements) }
  modules.set(file, mod)
  return mod
}

/** 파일 맨 앞의 'use client' / 'use server' 지시문 */
function directiveOf(statements: ts.NodeArray<ts.Statement>): string | null {
  for (const st of statements) {
    if (!ts.isExpressionStatement(st) || !ts.isStringLiteral(st.expression)) break
    const text = st.expression.text
    if (text === 'use client' || text === 'use server') return text
  }
  return null
}

const lineOf = (sf: ts.SourceFile, node: ts.Node) =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

type Import = { spec: string; typeOnly: boolean; line: number }

function importsOf(mod: Module): Import[] {
  const out: Import[] = []
  for (const st of mod.sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause
      const named =
        clause?.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : null
      // import type { A } · import { type A, type B } — 컴파일 후 사라진다
      const typeOnly =
        !!clause &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || (!clause.name && !!named && named.length > 0 && named.every((e) => e.isTypeOnly)))
      out.push({ spec: st.moduleSpecifier.text, typeOnly, line: lineOf(mod.sf, st) })
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      out.push({ spec: st.moduleSpecifier.text, typeOnly: st.isTypeOnly, line: lineOf(mod.sf, st) })
    }
  }
  return out
}

/** '@/…'와 상대 경로만 src 안의 파일로 푼다. 패키지는 null */
function resolve(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
  if (/\.tsx?$/.test(base)) candidates.unshift(base)
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

function isServerOnly(spec: string, target: string | null) {
  return (
    spec.startsWith('@prisma/') ||
    spec.includes('generated/prisma') ||
    target === DB_MODULE ||
    (target?.startsWith(GENERATED + path.sep) ?? false)
  )
}

/**
 * 이 모듈을 값으로 불러오면 서버 전용 코드가 딸려오는가. 딸려오면 그 import 경로를, 아니면 null.
 * 'use server' 모듈은 클라이언트에서 참조(Server Action)로만 불리므로 따라가지 않는다.
 */
function serverChain(file: string, seen: Set<string>): string[] | null {
  if (seen.has(file)) return null
  seen.add(file)
  const mod = load(file)
  if (mod.directive === 'use server') return null
  for (const imp of importsOf(mod)) {
    if (imp.typeOnly) continue
    const target = resolve(file, imp.spec)
    if (isServerOnly(imp.spec, target)) return [imp.spec]
    const sub = target ? serverChain(target, seen) : null
    if (sub) return [imp.spec, ...sub]
  }
  return null
}

function calls(node: ts.Node, names: Set<string>): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.has(n.expression.text)) found = true
    else ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false)

/** 파일 최상위 함수 — function 선언과 const 화살표 함수 */
function topFunctions(sf: ts.SourceFile) {
  const out: { name: string; body: ts.Node; exported: boolean; line: number }[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      out.push({ name: st.name.text, body: st.body, exported: isExported(st), line: lineOf(sf, st) })
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer
        if (ts.isIdentifier(d.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          out.push({ name: d.name.text, body: init.body, exported: isExported(st), line: lineOf(sf, st) })
        }
      }
    }
  }
  return out
}

// ───────── 규칙

type Check = { id: string; title: string; problems: string[] }
const checks: Check[] = []
const srcFiles = walk(SRC, /\.tsx?$/)

if (srcFiles.length === 0) {
  console.log(`❌ ${rel(SRC) || 'src'}/ 에서 소스 파일을 찾지 못했습니다 — 저장소 루트에서 실행하세요`)
  process.exit(1)
}

// B1
{
  const problems: string[] = []
  for (const file of srcFiles) {
    if (file.startsWith(ACTIONS + path.sep)) continue
    const { sf } = load(file)
    const visit = (n: ts.Node) => {
      if (ts.isExpressionStatement(n) && ts.isStringLiteral(n.expression) && n.expression.text === 'use server') {
        problems.push(`${rel(file)}:${lineOf(sf, n)} — Server Action은 src/actions/에 둔다`)
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  checks.push({ id: 'B1', title: "'use server'는 src/actions/에만", problems })
}

// B2
{
  const problems: string[] = []
  let count = 0
  // auth.ts의 로그인·로그아웃은 세션이 생기기 전 단계라 제외
  const actionFiles = walk(ACTIONS, /\.ts$/).filter((f) => path.basename(f) !== 'auth.ts')
  for (const file of actionFiles) {
    const mod = load(file)
    if (mod.directive !== 'use server') continue
    const fns = topFunctions(mod.sf)
    // popup.ts의 user()처럼 requireUser()를 감싼 로컬 헬퍼도 인정한다
    const guards = new Set(['requireUser'])
    for (const f of fns) if (!f.exported && calls(f.body, guards)) guards.add(f.name)
    for (const f of fns.filter((x) => x.exported)) {
      count++
      if (!calls(f.body, guards)) problems.push(`${rel(file)}:${f.line} ${f.name}() — requireUser()를 거치지 않는다`)
    }
  }
  checks.push({ id: 'B2', title: `Server Action마다 세션 확인 (액션 ${count}개)`, problems })
}

// B3
{
  const problems: string[] = []
  const clientFiles = srcFiles.filter((f) => load(f).directive === 'use client')
  for (const file of clientFiles) {
    for (const imp of importsOf(load(file))) {
      if (imp.typeOnly) continue
      const target = resolve(file, imp.spec)
      const chain = isServerOnly(imp.spec, target) ? [] : target ? serverChain(target, new Set([file])) : null
      if (chain) problems.push(`${rel(file)}:${imp.line} → ${[imp.spec, ...chain].join(' → ')}`)
    }
  }
  checks.push({
    id: 'B3',
    title: `클라이언트 모듈은 서버 전용 모듈을 값으로 import하지 않음 (클라이언트 모듈 ${clientFiles.length}개)`,
    problems,
  })
}

// B4
{
  const app = path.join(SRC, 'app')
  const problems = walk(app, /^route\.(ts|tsx|js|mjs)$/).map((f) => `${rel(f)} — API 라우트 대신 Server Action을 쓴다`)
  if (existsSync(path.join(app, 'api'))) problems.push('src/app/api/ — API 라우트 폴더가 있다')
  checks.push({ id: 'B4', title: 'API 라우트 없음', problems })
}

// B5
{
  const STATE_LIBS = [
    'zustand', 'redux', '@reduxjs/toolkit', 'react-redux', 'jotai', 'recoil', 'mobx', 'mobx-react',
    'mobx-react-lite', 'valtio', '@tanstack/react-query', 'swr', 'xstate', '@xstate/react',
  ]
  const problems: string[] = []
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    if (STATE_LIBS.includes(name)) problems.push(`package.json — ${name}`)
  }
  for (const file of srcFiles) {
    for (const imp of importsOf(load(file))) {
      if (STATE_LIBS.some((lib) => imp.spec === lib || imp.spec.startsWith(`${lib}/`))) {
        problems.push(`${rel(file)}:${imp.line} — ${imp.spec}`)
      }
    }
  }
  checks.push({ id: 'B5', title: '상태관리 라이브러리 없음', problems })
}

// B6
{
  const problems: string[] = []
  const PROXY = 'Next.js 16은 middleware 대신 src/proxy.ts를 쓴다'
  const THEME = '색상 토큰은 src/app/globals.css의 @theme에 둔다'
  const mustNotExist: [string, string][] = [
    ['src/middleware.ts', PROXY],
    ['src/middleware.js', PROXY],
    ['src/lib/format.ts', '날짜 파싱·포맷은 src/lib/date.ts에 둔다'],
    ['tailwind.config.ts', THEME],
    ['tailwind.config.js', THEME],
    ['tailwind.config.mjs', THEME],
    ['tailwind.config.cjs', THEME],
  ]
  for (const [file, why] of mustNotExist) {
    if (existsSync(path.join(ROOT, file))) problems.push(`${file} — ${why}`)
  }
  if (!existsSync(path.join(SRC, 'proxy.ts'))) problems.push('src/proxy.ts가 없다 — 비로그인 접근 차단이 빠진다')
  const css = path.join(SRC, 'app', 'globals.css')
  if (!existsSync(css) || !readFileSync(css, 'utf8').includes('@theme')) {
    problems.push(`src/app/globals.css에 @theme가 없다 — ${THEME}`)
  }
  checks.push({ id: 'B6', title: '정정된 경로 (proxy.ts · lib/date.ts · globals.css @theme)', problems })
}

// ───────── 결과

for (const c of checks) {
  console.log(`${c.problems.length === 0 ? '✅' : '❌'} ${c.id} ${c.title}`)
  for (const p of c.problems) console.log(`     ${p}`)
}

const failed = checks.filter((c) => c.problems.length > 0)
if (failed.length > 0) {
  console.log(`\n아키텍처 규칙 위반 ${failed.length}개 — docs/06-architecture.md · SSOT §2 참고`)
  process.exit(1)
}
console.log('\n아키텍처 규칙 전부 통과')
