import { getOpenElections } from '@/lib/queries';
import { log, safeError } from '@/lib/log';
import VoterFlow from './voter-flow';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let elections: { id: number; title: string; votingEnd: string | null }[] | null = null;

  try {
    const open = await getOpenElections();
    elections = open.map((e) => ({
      id: e.id,
      title: e.title,
      votingEnd: e.voting_end ? new Date(e.voting_end).toISOString() : null,
    }));
  } catch (err) {
    // DB unavailable: still serve the shell; the client shows a degraded state.
    log.error('home_open_elections_failed', { err: safeError(err) });
  }

  return <VoterFlow initialElections={elections} />;
}
