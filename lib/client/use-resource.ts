'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetWithRetry, type ApiResult } from './api';

export type ResourceState<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
  loading: boolean; // first load, no data yet
  refreshing: boolean; // background refresh, data still shown
  reload: () => void;
};

/**
 * GET-backed resource with explicit loading / success / error states and a
 * non-flashing background refresh. `pollMs` refreshes on an interval and pauses
 * while the tab is hidden. A failed refresh keeps the last good data visible.
 */
export function useResource<T>(path: string | null, opts: { pollMs?: number } = {}): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const hasData = useRef(false);

  const load = useCallback(async () => {
    if (!path) return;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);

    const res: ApiResult<T> = await apiGetWithRetry<T>(path);
    if (res.ok) {
      setData(res.data);
      hasData.current = true;
      setError(null);
    } else if (!hasData.current) {
      setError({ code: res.code, message: res.message });
    } else {
      setError({ code: res.code, message: res.message }); // shown as a subtle "couldn't refresh"
    }
    setLoading(false);
    setRefreshing(false);
  }, [path]);

  useEffect(() => {
    hasData.current = false;
    setData(null);
    setError(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    let active = true;
    const tick = () => {
      if (active && document.visibilityState === 'visible') load();
    };
    const id = setInterval(tick, opts.pollMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [opts.pollMs, path, load]);

  return { data, error, loading, refreshing, reload: load };
}
