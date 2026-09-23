import type { Config } from "jest";
import nextJest from "next/jest.js";

// `dir` lets next/jest load next.config.ts, tsconfig.json path aliases
// (@/*), and .env files the same way `next build`/`next dev` would.
const createJestConfig = nextJest({ dir: "./" });

/**
 * Two projects, matching this plan's test-infrastructure requirement:
 * - "node": apps/web/src/lib/**\/*.test.ts — pure functions/clients, no DOM.
 * - "jsdom": apps/web/src/components/**\/*.test.tsx — React component
 *   rendering via @testing-library/react.
 * next/jest already mocks `server-only` as a no-op module for both
 * projects, so a "node" test importing something that transitively pulls
 * in a server-only module (e.g. api-client.ts -> session.ts) never throws.
 */
// next/jest resolves the tsconfig "@/*" path alias for SWC-transformed
// source, but NOT for Jest's own module resolver — which jest.mock() and
// require()/import() resolution both rely on. Without this, `import ... from
// "@/i18n/navigation"` transforms fine but `jest.mock("@/i18n/navigation")`
// cannot find the module. Mirrors tsconfig.json's `paths: {"@/*": ["./src/*"]}`.
const moduleNameMapper = {
  "^@/(.*)$": "<rootDir>/src/$1",
};

// `next build`'s standalone output copies this package's own package.json
// into .next/standalone/apps/web/package.json; without this, Jest's haste
// module map sees two files both named "web" and warns on every run.
const modulePathIgnorePatterns = ["<rootDir>/.next/"];

const nodeProject = createJestConfig({
  displayName: "node",
  testEnvironment: "node",
  // `src/proxy.test.ts` (01-09A Task 1) covers proxy.ts itself — it isn't
  // under src/lib/, but needs the same no-DOM "node" environment.
  testMatch: ["<rootDir>/src/lib/**/*.test.ts", "<rootDir>/src/proxy.test.ts"],
  moduleNameMapper,
  modulePathIgnorePatterns,
});

const jsdomProject = createJestConfig({
  displayName: "jsdom",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/components/**/*.test.tsx"],
  moduleNameMapper,
  modulePathIgnorePatterns,
});

const config = async (): Promise<Config> => ({
  projects: [await nodeProject(), await jsdomProject()],
});

export default config;
