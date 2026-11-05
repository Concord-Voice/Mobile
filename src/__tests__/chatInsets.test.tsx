import { Keyboard, Platform, StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Chat } from '../ui/Chat';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 30, left: 0, right: 0 }),
}));
jest.mock('../ConcordCrypto', () => ({}));
jest.mock('../state/session', () => ({
  useSession: () => ({
    api: null,
    identity: null,
    stage: { kind: 'signed_out' },
  }),
  describeError: String,
}));

type Listener = () => void;

function render(os: 'ios' | 'android') {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  Platform.OS = os;
  jest.spyOn(Keyboard, 'addListener').mockImplementation(((
    event: string,
    cb: Listener,
  ) => {
    listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    return { remove: () => removed.push(event) };
  }) as never);
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <Chat
        dm={{ id: 'd', title: 'Dm', unreadCount: 0, lastActivity: '' }}
        onBack={() => {}}
      />,
    );
  });
  const composerPadding = () => {
    const input = tree.root.findByProps({ placeholder: 'Message' });
    const style = StyleSheet.flatten(input.parent?.props.style);
    return style.paddingBottom;
  };
  return { tree, listeners, removed, composerPadding };
}

afterEach(() => jest.restoreAllMocks());

it.each([
  ['ios', 'keyboardWillShow', 'keyboardWillHide'],
  ['android', 'keyboardDidShow', 'keyboardDidHide'],
] as const)(
  'drops the bottom inset while the keyboard is open on %s',
  (os, showEvent, hideEvent) => {
    const { tree, listeners, removed, composerPadding } = render(os);
    expect(composerPadding()).toBe(38);
    act(() => listeners.get(showEvent)?.forEach(cb => cb()));
    expect(composerPadding()).toBe(8);
    act(() => listeners.get(hideEvent)?.forEach(cb => cb()));
    expect(composerPadding()).toBe(38);
    act(() => tree.unmount());
    expect(removed).toEqual(expect.arrayContaining([showEvent, hideEvent]));
  },
);
