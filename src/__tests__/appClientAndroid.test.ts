jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../ConcordAttest', () => ({ nativeAttester: () => null }));
jest.mock('../ConcordCrypto', () => ({}));

import { version } from '../../package.json';
import { appClient } from '../state/session';

test('Android reports its platform and the package.json version', async () => {
  await expect(appClient()).resolves.toEqual({ platform: 'android', version });
});
