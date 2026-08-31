import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import ElectionDetail from './election-detail';

export const dynamic = 'force-dynamic';

export default async function ElectionDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage();
  return (
    <main>
      <p className="meta">
        <Link href="/admin" className="no-underline hover:underline">
          Back to all elections
        </Link>
      </p>
      <div className="mt-2">
        <ElectionDetail electionId={Number(params.id)} />
      </div>
    </main>
  );
}
