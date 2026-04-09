import { getApiBase, fetchWithAuth, handleResponse } from './base';
import type { SpendStats } from '@/lib/types';

export async function getSpendStats(days?: number): Promise<SpendStats> {
  const params = days ? `?days=${days}` : '';
  const res = await fetchWithAuth(`${getApiBase()}/api/stats/spend${params}`);
  return handleResponse<SpendStats>(res);
}
