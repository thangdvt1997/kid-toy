# Deferred Items — Phase 1

Out-of-scope discoveries found during plan execution, logged rather than fixed
(per the executor's scope-boundary rule: only auto-fix issues directly caused
by the current task's changes).

## 01-09A — `pnpm --filter api lint` fails/reformats almost the entire `apps/api` tree

**Found during:** 01-09A Task 3 (separating the DB-backed pricing spec from the
default unit-test command).

**What was found:** Running `pnpm --filter api lint` (which invokes
`eslint "{src,apps,libs,test}/**/*.ts" --fix`) reformats ~55 files across
`apps/api/src` and `apps/api/test` — virtually the entire backend — via
`prettier/prettier` auto-fixable rules (multi-line argument wrapping, trailing
commas, etc.), plus a long list of genuine `@typescript-eslint/no-unsafe-*`
errors in `apps/api/test/catalog-admin.e2e-spec.ts`,
`apps/api/test/password-reset.e2e-spec.ts`,
`apps/api/test/pricing-admin.e2e-spec.ts`, and one
`@typescript-eslint/no-base-to-string` error in
`apps/api/test/utils/test-app.ts`. None of these files were modified by this
plan's actual tasks — the formatting drift and the `no-unsafe-*`/
`no-base-to-string` errors both pre-date 01-09A and are unrelated to the three
auth defects or the test-command separation this plan fixes.

**Why deferred, not fixed:** Fixing this correctly would mean reformatting/
touching essentially the entire backend source tree in a plan whose actual
scope is three specific, narrow auth/test-infrastructure defects — far outside
this plan's blast radius, and running `eslint --fix` a second time to "clean
up" would itself re-trigger the same problem (auto-fixing unrelated files) it
is trying to avoid.

**Action taken this plan:** Verified with a file-scoped, non-mutating
`npx eslint <path>` (no `--fix`) that the ONE file this plan actually touched
(`price-resolution.service.integration-spec.ts`) has no NEW problems beyond
this same pre-existing formatting drift (i.e. the rename + doc-comment edit
introduced nothing new). `pnpm --filter api lint` itself was NOT run as part
of this plan's verification (Task 4) for that reason; `pnpm --filter api
typecheck` and `pnpm --filter api test` / `test:integration` were run instead
and both pass/behave as expected.

**Suggested follow-up:** A dedicated formatting/lint-debt cleanup pass across
`apps/api`, ideally as its own small plan/PR so the diff is reviewable and
doesn't get entangled with unrelated feature work. The `no-unsafe-*` errors in
the three e2e spec files and `test-app.ts`'s `no-base-to-string` warning are
genuine (not just formatting) and should be triaged individually — most look
like `supertest`/Prisma response bodies typed as `any` needing narrower types.
