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

const nodeProject = createJestConfig({
  displayName: "node",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/lib/**/*.test.ts"],
  moduleNameMapper,
});

const jsdomProject = createJestConfig({
  displayName: "jsdom",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/components/**/*.test.tsx"],
  moduleNameMapper,
});

const config = async (): Promise<Config> => ({
  projects: [await nodeProject(), await jsdomProject()],
});

export default config;
