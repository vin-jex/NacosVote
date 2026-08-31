import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import VoterRegistry from './registry';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Voter registry' };

export default async function VoterRegistryPage() {
  await requireAdminPage();
  return (
    <main>
      <p className="meta">
        <Link href="/admin" className="no-underline hover:underline">
          Back to all elections
        </Link>
      </p>
      <h1 className="page-title mt-2">Voter registry</h1>
      <p className="meta mt-1 max-w-2xl">
        The master list of NACOS students. Deciding who can vote in a given election is done per
        election, under its Eligible voters tab.
      </p>
      <hr className="rule my-6" />
      <VoterRegistry />
    </main>
  );
}
