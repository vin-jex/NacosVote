import { requireAdminPage } from '@/lib/auth';
import NewElectionForm from './new-election-form';

export const dynamic = 'force-dynamic';

export default async function NewElectionPage() {
  await requireAdminPage();
  return (
    <main className="narrow">
      <h1>Create election</h1>
      <NewElectionForm />
    </main>
  );
}
