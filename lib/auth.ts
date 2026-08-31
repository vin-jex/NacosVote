import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import CredentialsProvider from 'next-auth/providers/credentials';
import { rateLimit } from './redis';
import { log } from './log';
import { verifyAdminCredentials } from './admins';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: '/admin/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password ?? '';
        if (!email || !password) return null;

        // Throttle brute force: per-account and a coarse global backstop.
        const [perAccount, global] = await Promise.all([
          rateLimit(`login:${email}`, 5, 300),
          rateLimit('login:_global', 40, 300),
        ]);
        if (!perAccount || !global) {
          log.warn('admin_login_rate_limited', {});
          return null;
        }

        const verified = await verifyAdminCredentials(email, password);
        if (!verified) {
          log.info('admin_login_failed', {});
          return null;
        }
        return { id: verified, email: verified };
      },
    }),
  ],
};

/** For API routes: returns the admin email, or null if unauthenticated. */
export async function requireAdmin(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email ?? null;
}

/** For server components: redirects to the login page when unauthenticated. */
export async function requireAdminPage(): Promise<string> {
  const email = await requireAdmin();
  if (!email) redirect('/admin/login');
  return email;
}
