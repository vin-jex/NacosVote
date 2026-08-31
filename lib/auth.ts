import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { rateLimit } from './redis';
import { log } from './log';

type AdminRecord = { email: string; hash: string };

function admins(): AdminRecord[] {
  return [
    { email: process.env.ADMIN_1_EMAIL, hash: process.env.ADMIN_1_PASSWORD_HASH },
    { email: process.env.ADMIN_2_EMAIL, hash: process.env.ADMIN_2_PASSWORD_HASH },
  ].filter((a): a is AdminRecord => Boolean(a.email && a.hash));
}

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

        const admin = admins().find((a) => a.email.toLowerCase() === email);
        // Always run a bcrypt compare so timing doesn't distinguish unknown
        // emails from wrong passwords.
        const hash =
          admin?.hash ?? '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
        const ok = await bcrypt.compare(password, hash);
        if (!admin || !ok) {
          log.info('admin_login_failed', {});
          return null;
        }

        return { id: admin.email, email: admin.email };
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
