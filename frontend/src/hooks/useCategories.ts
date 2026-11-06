import { useQuery } from '@tanstack/react-query';
import { auctionsApi } from '../api/auctions';

/** Categories change rarely, so they are cached for a long time and shared by every page. */
export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => auctionsApi.categories(signal),
    staleTime: 10 * 60_000,
    select: (page) => page.data,
  });
}
