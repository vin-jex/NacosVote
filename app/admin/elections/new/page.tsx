import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import NewElectionForm from './new-election-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create election' };

export default async function NewElectionPage() {
  await requireAdminPage();
  return (
    <main className="mx-auto w-full max-w-xl">
      <p className="meta">
        <Link href="/admin" className="no-underline hover:underline">
          Back to all elections
        </Link>
      </p>
      <h1 className="page-title mt-2">Create election</h1>
      <hr className="rule my-6" />
      <NewElectionForm />
    </main>
  );
}
