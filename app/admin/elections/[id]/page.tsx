import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import ElectionDetail from './election-detail';

export const dynamic = 'force-dynamic';

export default async function ElectionDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage();
  return (
    <main>
      <p className="muted">
        <Link href="/admin">← All elections</Link>
      </p>
      <ElectionDetail electionId={Number(params.id)} />
    </main>
  );
}
