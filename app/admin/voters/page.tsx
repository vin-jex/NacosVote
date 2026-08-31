import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import VoterRegistry from './registry';

export const dynamic = 'force-dynamic';

export default async function VoterRegistryPage() {
  await requireAdminPage();
  return (
    <main>
      <p className="muted">
        <Link href="/admin">← All elections</Link>
      </p>
      <h1>Voter registry</h1>
      <p className="muted">
        The master list of NACOS students. Assigning who can vote in a given election is done per
        election, under its “Eligible voters” tab.
      </p>
      <VoterRegistry />
    </main>
  );
}
