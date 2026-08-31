import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { Brand } from '@/app/components/brand';
import ElectionsList from './elections-list';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Election administration' };

export default async function AdminHome() {
  await requireAdminPage();
  return (
    <main>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Brand title="Election administration" />
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/admin/voters" className="font-semibold no-underline hover:underline">
            Voter registry
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
