import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { Brand } from '@/app/components/brand';
import ElectionsList from './elections-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Election administration' };

export default async function AdminHome() {
  const email = await requireAdminPage();
  return (
    <main>
      <Brand title="Election administration" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="meta">
          Signed in as <span className="font-semibold text-ink">{email}</span>
        </p>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/admin/voters" className="font-semibold no-underline hover:underline">
            Voter registry
          </Link>
          <Link href="/admin/account" className="font-semibold no-underline hover:underline">
            Account
          </Link>
          <Link href="/admin/elections/new" className="btn-primary no-underline">
            <span>New election</span>
          </Link>
        </nav>
      </div>
      <hr className="rule mb-6" />
      <ElectionsList />
    </main>
  );
}
