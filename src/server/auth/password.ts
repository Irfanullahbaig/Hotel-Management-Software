import bcrypt from "bcryptjs";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export function passwordProblems(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

let dummyHash: string | null = null;
/** Spend the same time as a real check when the account does not exist. */
export async function dummyVerify(plain: string) {
  dummyHash ??= await bcrypt.hash("timing-equaliser", 12);
  await bcrypt.compare(plain, dummyHash);
}
