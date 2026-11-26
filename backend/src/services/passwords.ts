/** The client's password rules: staff 12+ characters, students 8+, both with a letter and a number. */

const COMMON = new Set(['password1234', 'password@123', 'qwerty123456', 'admin@123456', 'welcome@1234', 'laeuropa@123',
  'abcd12345678', '123456789abc', 'india@123456', 'password123', 'password1', '12345678a', 'qwerty123']);

export function passwordProblem(pw: string, kind: 'staff' | 'portal' | 'partner', personal: (string | undefined)[] = []): string | null {
  const min = kind === 'staff' ? 12 : kind === 'partner' ? 10 : 8;
  const rule = kind === 'partner' ? 'Min 10 characters, 1 letter, 1 number, 1 symbol' : `Minimum ${min} characters, with at least 1 letter and 1 number.`;
  if (pw.length < min || pw.length > 128 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) || (kind === 'partner' && !/[^A-Za-z0-9]/.test(pw))) return rule;
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (max 72 bytes).';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return 'This password is too common. Please choose another one.';
  for (const p of personal) {
    const part = String(p ?? '').toLowerCase().split('@')[0].trim();
    if (part.length >= 4 && lower.includes(part)) return 'Password cannot contain your name, username or email.';
  }
  return null;
}
