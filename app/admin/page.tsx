import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import ElectionsList from './elections-list';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  await requireAdminPage();
  return (
    <main>
      <div className="row between">
        <h1>Elections</h1>
        <nav className="row">
          <Link href="/admin/voters">Voter registry</Link>
          <Link href="/admin/elections/new" className="btnlink">
            + Create election
          </Link>
        </nav>
      </div>
      <ElectionsList />
    </main>
  );
}
