import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import ChangePasswordForm from './change-password-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin account' };

export default async function AccountPage() {
  const email = await requireAdminPage();
  return (
    <main className="mx-auto w-full max-w-xl">
      <p className="meta">
        <Link href="/admin" className="no-underline hover:underline">
          Back to all elections
        </Link>
      </p>
      <h1 className="page-title mt-2">Account</h1>
      <p className="meta mt-1">
        Signed in as <span className="font-semibold text-ink">{email}</span>
      </p>
      <hr className="rule my-6" />
      <p className="position-title">Change password</p>
      <hr className="rule mb-5 mt-2" />
      <ChangePasswordForm />
    </main>
  );
}
