import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-guard";

export async function requireUserSession() {
  const session = await auth();
  if (!session?.user?.email || !isAllowedEmail(session.user.email)) {
    return null;
  }
  return session;
}
