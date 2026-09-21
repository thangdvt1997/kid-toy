/**
 * Minimal duration-string parser for env values like "15m" / "30d" —
 * jsonwebtoken (via @nestjs/jwt) understands these natively for
 * `expiresIn`, but refresh_tokens.expiresAt is a plain DB Date column that
 * TokenService must compute itself. Deliberately hand-rolled instead of
 * pulling in the `ms` package: pnpm's strict node_modules layout does not
 * expose jsonwebtoken's transitive `ms` dependency to apps/api's own code,
 * and this project has no other need for a general-purpose duration parser.
 */
type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd';

const UNIT_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

function isDurationUnit(value: string): value is DurationUnit {
  return value in UNIT_MS;
}

export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(value.trim());
  const amount = match?.[1];
  const unit = match?.[2];
  if (!amount || !unit || !isDurationUnit(unit)) {
    throw new Error(`Invalid duration string: "${value}" (expected e.g. "15m", "30d")`);
  }
  return Number(amount) * UNIT_MS[unit];
}
