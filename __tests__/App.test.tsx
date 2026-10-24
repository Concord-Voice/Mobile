import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import type { ConcordApi } from '../src/core/ConcordApi';
import { useSession } from '../src/state/session';

const text = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType('Text' as never)
    .map(t => t.props.children)
    .flat()
    .join('|');

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

async function render() {
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(<App />);
  });
  return mounted as unknown as ReactTestRenderer.ReactTestRenderer;
}

const actions = useSession.getState();

afterEach(async () => {
  await ReactTestRenderer.act(() => mounted?.unmount());
  mounted = null;
  useSession.setState({
    ...actions,
    stage: { kind: 'signed_out' },
    api: null,
    error: null,
  });
});

test('starts on the sign-in screen', async () => {
  const tree = await render();
  expect(text(tree)).toContain('Log in');
  expect(
    tree.root.findAllByProps({ accessibilityLabel: 'Password' })[0].props
      .secureTextEntry,
  ).toBe(true);
});

test('offers only the code methods the account has', async () => {
  useSession.setState({
    stage: { kind: 'mfa', challengeToken: 'c', methods: ['webauthn', 'email'] },
  });
  const tree = await render();
  expect(text(tree)).toContain('Emailed code');
  expect(text(tree)).not.toContain('Authenticator code');
});

test('lets an email-only account request its code', async () => {
  const sendMfaEmail = jest.fn(async () => {});
  useSession.setState({
    stage: { kind: 'mfa', challengeToken: 'c', methods: ['email'] },
    sendMfaEmail,
  });
  const tree = await render();
  let send = tree.root
    .findAllByType('Text' as never)
    .find(t => t.props.children === 'Email me a code') as
    | ReactTestRenderer.ReactTestInstance
    | null
    | undefined;
  while (send && !send.props.onPress) send = send.parent;
  await ReactTestRenderer.act(async () => send?.props.onPress());
  expect(sendMfaEmail).toHaveBeenCalledTimes(1);
});

test('explains a passkey-only account', async () => {
  useSession.setState({
    stage: { kind: 'mfa', challengeToken: 'c', methods: ['webauthn'] },
  });
  expect(text(await render())).toContain('needs a passkey');
});

test('lists DM conversations once signed in', async () => {
  const api = {
    conversations: jest.fn(async () => [
      { id: 'd1', title: 'Peer', unreadCount: 2, lastActivity: 'now' },
    ]),
  } as unknown as ConcordApi;
  useSession.setState({ stage: { kind: 'signed_in', userId: 'u' }, api });
  const tree = await render();
  expect(text(tree)).toContain('Peer');
  expect(text(tree)).toContain('2');
  expect(text(tree)).toContain('You');
});
