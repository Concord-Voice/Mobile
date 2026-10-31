const mockInfo = jest.fn();
jest.mock('../ConcordAttest', () => ({
  nativeAttester: () => ({ info: mockInfo }),
}));
jest.mock('../ConcordCrypto', () => ({}));

import { appClient } from '../state/session';

test('retries the version lookup after a failure, then caches it', async () => {
  mockInfo
    .mockRejectedValueOnce(new Error('busy'))
    .mockResolvedValue({ version: '1.0(5)' });
  await expect(appClient()).resolves.toBeNull();
  await expect(appClient()).resolves.toEqual({
    platform: 'ios',
    version: '1.0.0',
  });
  await appClient();
  expect(mockInfo).toHaveBeenCalledTimes(2);
});
