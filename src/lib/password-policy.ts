// Password strength policy shared between frontend components.
//
// Rules: ≥ 10 chars, at least one uppercase letter, one lowercase letter,
// one digit, and one special character (anything not alphanumeric).

export const MIN_LENGTH = 10;

export const PASSWORD_RULES = [
  { test: (p: string) => p.length >= MIN_LENGTH, label: `At least ${MIN_LENGTH} characters` },
  { test: (p: string) => /[A-Z]/.test(p), label: 'One uppercase letter' },
  { test: (p: string) => /[a-z]/.test(p), label: 'One lowercase letter' },
  { test: (p: string) => /\d/.test(p), label: 'One digit' },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: 'One special character (!@#$...)' },
] as const;

/** Score 0–5 (number of rules passing). */
export function passwordScore(password: string): number {
  return PASSWORD_RULES.filter((r) => r.test(password)).length;
}

/** True when every rule passes. */
export function isPasswordStrong(password: string): boolean {
  return passwordScore(password) === PASSWORD_RULES.length;
}

export function passwordErrors(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.label);
}
