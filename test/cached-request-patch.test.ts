import { runInAction } from 'mobx';
import CachedRequest from '../src/stores/lib/CachedRequest';

it('awaits the cache patch without waiting on or assimilating another API request', async () => {
  const request = new CachedRequest({}, 'all');
  runInAction(() => {
    request.result = [{ id: 'existing' }];
  });
  await request.patch(items => {
    items.push({ id: 'created' });
  });
  expect(request.result.map(item => item.id)).toEqual(['existing', 'created']);
});
