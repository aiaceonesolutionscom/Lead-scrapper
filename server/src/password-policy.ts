// Server-side password strength policy.  Mirrors src/lib/password-policy.ts
// but with zero frontend imports so it works in the backend.

export const MIN_PASSWORD_LENGTH = 10;

/** Check that the password meets the strong-password policy. */
export function isStrongPassword(pw: string): boolean {
  return (
    pw.length >= MIN_PASSWORD_LENGTH &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

/** Returns the first failing rule message, or null if strong. */
export function passwordValidationMessage(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter';
  if (!/\d/.test(pw)) return 'Password must contain at least one digit';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must contain at least one special character (!@#$...)';
  return null;
}
