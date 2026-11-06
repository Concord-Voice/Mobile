import {
  AccessibilityInfo,
  Alert,
  FlatList,
  NativeModules,
  Platform,
  Share,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import type { Attachment, ConcordApi } from '../src/core/ConcordApi';
import { useSession } from '../src/state/session';
import type { ChatLine } from '../src/state/conversation';
import { Chat } from '../src/ui/Chat';

// Renders as a host element, so tests read its props.
jest.mock('react-native-video', () => 'Video');

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

/**
 * The native calls Chat makes itself. An image's pixel size comes from `pixels` and a text
 * file's contents from `texts`, by URI; a URI missing from `texts` fails to read.
 */
const pixels = new Map<string, { width: number; height: number }>();
const texts = new Map<string, string>();
const nativeFiles = {
  readAttachmentText: jest.fn(async (uri: string, _maxBytes: number) => {
    const read = texts.get(uri);
    if (read === undefined) throw new Error('auth');
    return read;
  }),
  attachmentImageSize: jest.fn(
    async (uri: string) => pixels.get(uri) ?? { width: 0, height: 0 },
  ),
  deleteAttachment: jest.fn(async (_uri: string) => null),
  shareAttachment: jest.fn(async (_uri: string) => null),
  previewAttachment: jest.fn(async (_uri: string) => true),
  saveAttachment: jest.fn(async (_uri: string) => true),
};
const modules = NativeModules as { ConcordCryptoModule?: object };

afterEach(async () => {
  await ReactTestRenderer.act(() => mounted?.unmount());
  mounted = null;
  delete modules.ConcordCryptoModule;
  pixels.clear();
  texts.clear();
  Object.values(nativeFiles).forEach(f => f.mockClear());
  nativeFiles.previewAttachment.mockImplementation(async () => true);
  nativeFiles.saveAttachment.mockImplementation(async () => true);
  useSession.setState({
    ...actions,
    stage: { kind: 'signed_out' },
    api: null,
    identity: null,
    error: null,
    canResume: false,
  });
});

const pressText = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  let node = tree.root
    .findAllByType('Text' as never)
    .find(t => t.props.children === label) as
    | ReactTestRenderer.ReactTestInstance
    | null
    | undefined;
  while (node && !node.props.onPress) node = node.parent;
  await ReactTestRenderer.act(async () => node?.props.onPress());
};

test('shows nothing while starting, then offers Face ID for a saved session', async () => {
  const restore = jest.fn(async () => {});
  useSession.setState({ stage: { kind: 'starting' }, restore });
  const tree = await render();
  expect(restore).toHaveBeenCalledTimes(1);
  expect(text(tree)).not.toContain('Log in');
  await ReactTestRenderer.act(async () =>
    useSession.setState({ stage: { kind: 'signed_out' }, canResume: true }),
  );
  await pressText(tree, 'Unlock with Face ID');
  expect(restore).toHaveBeenCalledTimes(2);
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

test('opens a conversation from the list and comes back', async () => {
  const api = {
    wsReconnect: {
      active: true,
      assertCanOpen: jest.fn(),
      recordOverload: jest.fn(),
      retire: jest.fn(),
    },
    conversations: jest.fn(async () => [
      { id: 'd1', title: 'Peer', unreadCount: 0, lastActivity: 'now' },
    ]),
    dmHistory: jest.fn(async () => []),
    markDmRead: jest.fn(async () => {}),
    wsTicket: jest.fn(async () => {
      throw new Error('offline');
    }),
  } as unknown as ConcordApi;
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api,
    identity: 'HANDLE' as never,
  });
  const tree = await render();
  const press = async (label: string) => {
    let node = tree.root
      .findAllByType('Text' as never)
      .find(t => t.props.children === label) as
      | ReactTestRenderer.ReactTestInstance
      | null
      | undefined;
    while (node && !node.props.onPress) node = node.parent;
    await ReactTestRenderer.act(async () => node?.props.onPress());
  };
  await press('Peer');
  expect(api.wsTicket).toHaveBeenCalled();
  expect(text(tree)).toContain('Back');
  expect(text(tree)).toContain('Could not reach the server');
  await press('‹ Back');
  expect(text(tree)).toContain('Messages');
});

test('keeps edits made while a send is in flight and restores a failed draft', async () => {
  let finish!: (ok: boolean) => void;
  const fake = {
    lines: [],
    dropped: false,
    onChange: null,
    start: jest.fn(async () => {}),
    send: jest.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = ok => (ok ? resolve() : reject(new Error('offline')));
        }),
    ),
    close: jest.fn(),
    openAttachment: jest.fn(),
  };
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api: {} as ConcordApi,
    identity: 'HANDLE' as never,
  });
  const dm = { id: 'd1', title: 'Peer', unreadCount: 0, lastActivity: 'now' };
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <Chat dm={dm} onBack={() => {}} open={() => fake} />,
    );
  });
  const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
  const input = () => tree.root.findByProps({ accessibilityLabel: 'Message' });
  const pressSend = () =>
    tree.root
      .findAll(
        n => n.props.accessibilityLabel === 'Send' && !!n.props.onPress,
      )[0]
      .props.onPress();
  await ReactTestRenderer.act(async () => input().props.onChangeText('one'));
  let sending!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    sending = pressSend();
  });
  await ReactTestRenderer.act(async () => input().props.onChangeText('two'));
  await ReactTestRenderer.act(async () => {
    finish(true);
    await sending;
  });
  expect(input().props.value).toBe('two');

  await ReactTestRenderer.act(async () => input().props.onChangeText('three'));
  await ReactTestRenderer.act(async () => {
    sending = pressSend();
  });
  await ReactTestRenderer.act(async () => {
    finish(false);
    await sending;
  });
  expect(input().props.value).toBe('three');

  // A new draft typed while a send fails is kept, not replaced by the failed text.
  await ReactTestRenderer.act(async () => {
    sending = pressSend();
  });
  await ReactTestRenderer.act(async () => input().props.onChangeText('four'));
  await ReactTestRenderer.act(async () => {
    finish(false);
    await sending;
  });
  expect(input().props.value).toBe('four');
});

test('sends a message and shows decrypted lines', async () => {
  const fake = {
    lines: [
      { id: 'm1', userId: 'peer', sender: 'Peer', text: 'hi' },
      {
        id: 'm2',
        userId: 'peer',
        sender: '',
        text: 'This message could not be decrypted.',
        unreadable: true,
      },
    ],
    dropped: true,
    onChange: null,
    start: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    close: jest.fn(),
    openAttachment: jest.fn(),
  };
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api: {} as ConcordApi,
    identity: 'HANDLE' as never,
  });
  const dm = { id: 'd1', title: 'Peer', unreadCount: 0, lastActivity: 'now' };
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <Chat dm={dm} onBack={() => {}} open={() => fake} />,
    );
  });
  const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
  expect(text(tree)).toContain('hi');
  expect(text(tree)).toContain('could not be decrypted');
  expect(text(tree)).toContain('Disconnected');
  const input = tree.root.findByProps({ accessibilityLabel: 'Message' });
  await ReactTestRenderer.act(async () => input.props.onChangeText(' yo '));
  const send = tree.root.findAll(
    n => n.props.accessibilityLabel === 'Send' && !!n.props.onPress,
  )[0];
  await ReactTestRenderer.act(async () => send.props.onPress());
  expect(fake.send).toHaveBeenCalledWith('yo');
  expect(
    tree.root.findByProps({ accessibilityLabel: 'Message' }).props.value,
  ).toBe('');
  await ReactTestRenderer.act(() => mounted?.unmount());
  mounted = null;
  expect(fake.close).toHaveBeenCalled();
});

function gifApi(auto: boolean | Error) {
  const gif = jest.fn(async (slug: string) => {
    if (slug === 'boom') throw new Error('offline');
    return slug === 'cat'
      ? {
          uri: 'https://api.example.test/klipy/media?url=a',
          width: 480,
          height: 270,
        }
      : slug === 'tiny'
      ? { uri: 'https://api.example.test/klipy/media?url=b' }
      : null;
  });
  const api = {
    gif,
    mediaSource: jest.fn(async (uri: string) => ({
      uri,
      headers: { Authorization: 'Bearer t' },
    })),
    loadGifsAutomatically: jest.fn(async () => {
      if (auto instanceof Error) throw auto;
      return auto;
    }),
  } as unknown as ConcordApi;
  return { api, gif };
}

/** Resolves to the decrypted file, or to its URI when it is as large as the server said. */
type OpenAttachment = (
  a: Attachment,
  limit: number,
) => Promise<string | { uri: string; size: number }>;

function chatWith(
  lines: ChatLine[],
  openAttachment: OpenAttachment = jest.fn(async () => {
    throw new Error('offline');
  }),
) {
  return {
    lines,
    dropped: false,
    onChange: null,
    start: jest.fn(async () => {}),
    send: jest.fn(async () => {}),
    close: jest.fn(),
    openAttachment: async (a: Attachment, limit: number) => {
      const opened = await openAttachment(a, limit);
      return typeof opened === 'string'
        ? { uri: opened, size: a.fileSize }
        : opened;
    },
  };
}

/** The list reports which messages are on screen; the test renderer never lays out. */
async function onScreen(
  tree: ReactTestRenderer.ReactTestRenderer,
  ids: string[],
) {
  await ReactTestRenderer.act(async () =>
    tree.root.findByType(FlatList).props.onViewableItemsChanged({
      viewableItems: ids.map(key => ({ key })),
      changed: [],
    }),
  );
}

test('plays GIFs through the proxy and names attachments', async () => {
  const { api, gif } = gifApi(true);
  const fake = chatWith([
    { id: 'm1', userId: 'peer', sender: 'Peer', text: '', gifSlug: 'cat' },
    { id: 'm2', userId: 'peer', sender: 'Peer', text: '', gifSlug: 'gone' },
    { id: 'm3', userId: 'peer', sender: 'Peer', text: '', gifSlug: 'boom' },
    { id: 'm4', userId: 'u', sender: '', text: '', gifSlug: 'tiny' },
    {
      id: 'm5',
      userId: 'peer',
      sender: 'Peer',
      text: '',
      attachments: [
        { id: 'a1', fileType: 'photo', fileSize: 2048, mimeType: 'image/png' },
        { id: 'a2', fileType: 'file', fileSize: 3 * 1024 * 1024, mimeType: '' },
        { id: 'a3', fileType: 'audio', fileSize: 12, mimeType: '' },
        { id: 'a5', fileType: 'constructor', fileSize: 2, mimeType: '' },
      ],
    },
    {
      id: 'm6',
      userId: 'peer',
      sender: 'Peer',
      text: 'caption',
      attachments: [
        { id: 'a4', fileType: 'video', fileSize: 1536, mimeType: 'video/mp4' },
      ],
    },
    { id: 'm7', userId: 'peer', sender: 'Peer', text: '', gifSlug: '' },
  ]);
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api,
    identity: 'HANDLE' as never,
  });
  const dm = { id: 'd1', title: 'Peer', unreadCount: 0, lastActivity: 'now' };
  const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try {
    await ReactTestRenderer.act(async () => {
      mounted = ReactTestRenderer.create(
        <Chat dm={dm} onBack={() => {}} open={() => fake} />,
      );
    });
    const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
    // Nothing is fetched for a message that has not been on screen.
    expect(gif).not.toHaveBeenCalled();
    await onScreen(tree, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    const images = () =>
      tree.root.findAll(
        n => n.props.accessibilityLabel === 'GIF' && !!n.props.onError,
      );
    // The list is newest first, so pick each GIF by its URL.
    const image = (id: string) =>
      images().find(n =>
        n.props.source.uri.endsWith(id),
      ) as ReactTestRenderer.ReactTestInstance;
    const [cat, tiny] = [image('=a'), image('=b')];
    expect(cat.props.source).toEqual({
      uri: 'https://api.example.test/klipy/media?url=a',
      headers: { Authorization: 'Bearer t' },
    });
    // 480 x 270 fits 240 wide; a GIF with no size gets a default frame.
    expect(cat.props.style).toContainEqual({ width: 240, height: 135 });
    expect(tiny.props.style).toContainEqual({ width: 200, height: 150 });
    const shown = text(tree);
    // A missing or failed GIF says what it was instead of an empty bubble.
    expect(shown.split('|').filter(t => t === 'GIF')).toHaveLength(2);
    expect(shown).toContain('Photo, 2.0 KB');
    expect(shown).toContain('File, 3.0 MB');
    expect(shown).toContain('Audio, 12 B');
    expect(shown).toContain('File, 2 B');
    expect(shown).toContain('caption|Video, 1.5 KB');
    // A message with nothing to show still says so.
    expect(shown).toContain('Empty message');
    await ReactTestRenderer.act(async () => cat.props.onError());
    expect(
      text(tree)
        .split('|')
        .filter(t => t === 'GIF'),
    ).toHaveLength(3);

    // Found GIFs are looked up once and keep their size while they reload; a failed
    // lookup is tried again after a minute.
    const remount = async () => {
      await ReactTestRenderer.act(() => mounted?.unmount());
      await ReactTestRenderer.act(async () => {
        mounted = ReactTestRenderer.create(
          <Chat dm={dm} onBack={() => {}} open={() => fake} />,
        );
      });
      return mounted as unknown as ReactTestRenderer.ReactTestRenderer;
    };
    let again = await remount();
    expect(
      again.root.findAll(
        n =>
          Array.isArray(n.props.style) &&
          n.props.style.some(
            (s: { width?: number; height?: number } | null) =>
              s?.width === 240 && s?.height === 135,
          ),
      ).length,
    ).toBeGreaterThan(0);
    await onScreen(again, ['m1', 'm3']);
    expect(gif.mock.calls.filter(([s]) => s === 'cat')).toHaveLength(1);
    expect(gif.mock.calls.filter(([s]) => s === 'boom')).toHaveLength(1);
    now.mockReturnValue(1_000_000 + 61_000);
    again = await remount();
    await onScreen(again, ['m3']);
    expect(gif.mock.calls.filter(([s]) => s === 'boom')).toHaveLength(2);
  } finally {
    now.mockRestore();
  }
});

test.each([
  ['is off', false],
  ['cannot be read', new Error('offline')],
] as const)(
  'waits for a tap when automatic GIF loading %s',
  async (_, auto) => {
    const { api, gif } = gifApi(auto);
    const fake = chatWith([
      { id: 'm1', userId: 'peer', sender: 'Peer', text: 'hi', gifSlug: 'tiny' },
    ]);
    useSession.setState({
      stage: { kind: 'signed_in', userId: 'u' },
      api,
      identity: 'HANDLE' as never,
    });
    const dm = { id: 'd2', title: 'Peer', unreadCount: 0, lastActivity: 'now' };
    await ReactTestRenderer.act(async () => {
      mounted = ReactTestRenderer.create(
        <Chat dm={dm} onBack={() => {}} open={() => fake} />,
      );
    });
    const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
    await onScreen(tree, ['m1']);
    expect(text(tree)).toContain('hi|Tap to load GIF');
    expect(gif).not.toHaveBeenCalled();
    const [tap] = tree.root.findAll(
      n =>
        n.props.accessibilityRole === 'button' &&
        !!n.props.onPress &&
        n
          .findAllByType('Text' as never)
          .some(t => t.props.children === 'Tap to load GIF'),
    );
    await ReactTestRenderer.act(async () => tap.props.onPress());
    expect(gif).toHaveBeenCalledWith('tiny');
    expect(
      tree.root.findAll(
        n =>
          n.props.accessibilityLabel === 'GIF' &&
          n.props.source?.uri === 'https://api.example.test/klipy/media?url=b',
      ).length,
    ).toBeGreaterThan(0);
  },
);

const MIB = 1024 * 1024;
const file = (
  id: string,
  fileType: string,
  fileSize: number,
  mimeType = '',
): Attachment => ({ id, fileType, fileSize, mimeType });

/** Mounts a chat whose one message carries `attachments`, and puts it on screen. */
async function chatWithFiles(
  attachments: Attachment[],
  openAttachment: OpenAttachment,
  auto: boolean | Error = true,
) {
  const { api, gif } = gifApi(auto);
  modules.ConcordCryptoModule = nativeFiles;
  const fake = chatWith(
    [
      { id: 'm1', userId: 'peer', sender: 'Peer', text: '', attachments },
      { id: 'm2', userId: 'peer', sender: 'Peer', text: '', gifSlug: 'tiny' },
    ],
    openAttachment,
  );
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api,
    identity: 'HANDLE' as never,
  });
  const dm = { id: 'd3', title: 'Peer', unreadCount: 0, lastActivity: 'now' };
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <Chat dm={dm} onBack={() => {}} open={() => fake} />,
    );
  });
  const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
  return { tree, gif, show: () => onScreen(tree, ['m1', 'm2']) };
}

const imageOf = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    n => n.props.accessibilityLabel === label && !!n.props.onError,
  )[0]?.props.source?.uri;

const button = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      !!n.props.onPress &&
      n.findAllByType('Text' as never).some(t => t.props.children === label),
  )[0];

/** The element that a long press on the text `label` reaches, if any. */
const holdTarget = (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  let node = tree.root
    .findAllByType('Text' as never)
    .find(t => t.props.children === label) as
    | ReactTestRenderer.ReactTestInstance
    | null
    | undefined;
  while (node && !node.props.onLongPress) node = node.parent;
  return node ?? undefined;
};

/** Long-presses `label` and lets the share or save it starts finish. */
const hold = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const target = holdTarget(tree, label);
  expect(target?.props.delayLongPress).toBe(500);
  await ReactTestRenderer.act(async () => {
    target?.props.onLongPress();
    await new Promise<void>(resolve => setImmediate(resolve));
  });
};

test('views files in the app on a tap and shares only on a hold', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  let finishPhoto!: () => void;
  let pdfTries = 0;
  const openAttachment = jest.fn(async (a: Attachment, _limit: number) => {
    if (a.id === 'p1')
      await new Promise<void>(resolve => {
        finishPhoto = resolve;
      });
    if (a.id === 'f1' && ++pdfTries === 1)
      throw Object.assign(new Error('auth'), {
        code: 'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED',
      });
    return `file:///c/${a.id}`;
  });
  try {
    const { tree, show } = await chatWithFiles(
      [
        file('p1', 'photo', 2048, 'image/png'),
        file('g1', 'animated', 1024, 'image/gif'),
        file('p2', 'photo', 70 * MIB, 'image/jpeg'),
        file('f1', 'file', 3 * MIB, 'application/pdf'),
        file('f2', 'file', 300 * MIB),
      ],
      openAttachment,
    );
    // Nothing downloads before its message is on screen.
    expect(openAttachment).not.toHaveBeenCalled();
    await show();
    // Small photos and animated images load on their own, one download at a time, held to
    // the 64 MiB auto-load limit plus envelope overhead.
    expect(
      openAttachment.mock.calls.map(([a, limit]) => [a.id, limit]),
    ).toEqual([['p1', 64 * MIB + 4096]]);
    await ReactTestRenderer.act(async () => finishPhoto());
    expect(openAttachment.mock.calls.map(([a]) => a.id)).toEqual(['p1', 'g1']);
    expect(imageOf(tree, 'Photo, 2.0 KB')).toBe('file:///c/p1');
    expect(imageOf(tree, 'Animated image, 1.0 KB')).toBe('file:///c/g1');
    // A photo takes its shape once it has loaded.
    const photo = () =>
      tree.root.findAll(
        n => n.props.accessibilityLabel === 'Photo, 2.0 KB' && !!n.props.onLoad,
      )[0];
    await ReactTestRenderer.act(async () =>
      photo().props.onLoad({
        nativeEvent: { source: { width: 480, height: 270 } },
      }),
    );
    expect(photo().props.style).toContainEqual({ width: 240, height: 135 });
    // A large photo and every other file wait for a tap.
    const shown = text(tree);
    expect(shown).toContain('Photo, 70.0 MB, tap to load');
    expect(shown).toContain('File, 3.0 MB|Hold to share or save');
    expect(shown).toContain('File, 300.0 MB|Too large to open on this phone');
    expect(button(tree, 'File, 300.0 MB').props.disabled).toBe(true);
    // Past what the phone opens there is nothing to hold, so nothing downloads.
    expect(holdTarget(tree, 'File, 300.0 MB')).toBeUndefined();
    // A GIF message has no hold; a photo is held, or shared through the screen reader.
    const gif = tree.root.findAll(
      n => n.props.accessibilityLabel === 'GIF' && !!n.props.onError,
    )[0];
    let up: ReactTestRenderer.ReactTestInstance | null = gif;
    while (up && !up.props.onLongPress) up = up.parent;
    expect(up).toBeNull();
    const held = tree.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Photo, 2.0 KB' &&
        !!n.props.onAccessibilityAction,
    )[0];
    expect(held.props.accessibilityActions).toEqual([
      { name: 'share', label: 'Share or save' },
    ]);
    await ReactTestRenderer.act(async () => {
      held.props.onAccessibilityAction({
        nativeEvent: { actionName: 'share' },
      });
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    expect(share).toHaveBeenLastCalledWith({ url: 'file:///c/p1' });
    share.mockClear();
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 70.0 MB, tap to load').props.onPress(),
    );
    expect(openAttachment).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'p2' }),
      256 * MIB + 4096,
    );
    expect(imageOf(tree, 'Photo, 70.0 MB')).toBe('file:///c/p2');

    // A failed open says why and tries again on the next tap; a tap shows the file in the
    // previewer, never the share sheet, and an opened file is not downloaded twice.
    const pdf = () => button(tree, 'File, 3.0 MB');
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    expect(text(tree)).toContain(
      "File, 3.0 MB|Can't open: the file is damaged or was changed",
    );
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    expect(nativeFiles.previewAttachment.mock.calls).toEqual([
      ['file:///c/f1'],
      ['file:///c/f1'],
    ]);
    expect(share).not.toHaveBeenCalled();
    expect(pdfTries).toBe(2);
    expect(text(tree)).toContain('File, 3.0 MB|Hold to share or save');
    // Only a hold shares it.
    await hold(tree, 'File, 3.0 MB');
    expect(share).toHaveBeenCalledWith({ url: 'file:///c/f1' });
    expect(pdfTries).toBe(2);
    // A file the previewer cannot show says so.
    nativeFiles.previewAttachment.mockResolvedValueOnce(false);
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    expect(text(tree)).toContain(
      "File, 3.0 MB|Can't preview this file. Hold to share or save",
    );
  } finally {
    share.mockRestore();
  }
});

test('a hold while a file downloads shares that download, once', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  let finish!: () => void;
  const openAttachment = jest.fn(async (a: Attachment) => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    return `file:///c/${a.id}`;
  });
  try {
    const { tree, show } = await chatWithFiles(
      [file('p1', 'photo', 2048, 'image/png')],
      openAttachment,
    );
    await show();
    expect(openAttachment).toHaveBeenCalledTimes(1);
    // Held while it loads, then held again: the second hold is ignored, and the share waits
    // for the download already running rather than starting another.
    await hold(tree, 'Photo, 2.0 KB');
    await hold(tree, 'Photo, 2.0 KB');
    expect(share).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => finish());
    await ReactTestRenderer.act(
      async () => new Promise<void>(resolve => setImmediate(resolve)),
    );
    expect(openAttachment).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url: 'file:///c/p1' });
    // Once that share ends, a hold on the photo itself works again.
    const photo = tree.root.findAll(
      n =>
        n.props.accessibilityLabel === 'Photo, 2.0 KB' && !!n.props.onLongPress,
    )[0];
    expect(photo.props.accessibilityRole).toBe('image');
    await ReactTestRenderer.act(async () => {
      photo.props.onLongPress();
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    expect(share).toHaveBeenCalledTimes(2);
  } finally {
    share.mockRestore();
  }
});

test('a share that never ends blocks holds on that file only', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockReturnValueOnce(new Promise(() => {}))
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  try {
    const { tree, show } = await chatWithFiles(
      // Ids no other test uses: the held one stays held for the rest of the run.
      [
        file('stuck', 'file', 1024, 'application/pdf'),
        file('free', 'file', 2048, 'application/pdf'),
      ],
      async (a: Attachment) => `file:///c/${a.id}`,
    );
    await show();
    await hold(tree, 'File, 1.0 KB');
    await hold(tree, 'File, 1.0 KB');
    expect(share.mock.calls).toEqual([[{ url: 'file:///c/stuck' }]]);
    await hold(tree, 'File, 2.0 KB');
    expect(share).toHaveBeenLastCalledWith({ url: 'file:///c/free' });
    expect(share).toHaveBeenCalledTimes(2);
  } finally {
    share.mockRestore();
  }
});

test('explains a failed photo, retries it, and opens oversized ones from a card', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  pixels.set('file:///c/p3', { width: 10000, height: 10000 });
  let photoTries = 0;
  let finishFile!: () => void;
  const openAttachment = jest.fn(async (a: Attachment, _limit: number) => {
    if (a.id === 'p1' && ++photoTries === 1)
      throw Object.assign(new Error('auth'), {
        code: 'E_CONCORD_CRYPTO_AUTHENTICATIONFAILED',
      });
    if (a.id === 'f1')
      await new Promise<void>(resolve => {
        finishFile = resolve;
      });
    return `file:///c/${a.id}`;
  });
  try {
    const { tree, show } = await chatWithFiles(
      [
        file('p1', 'photo', 2048, 'image/png'),
        file('p2', 'photo', 300 * MIB, 'image/png'),
        file('p3', 'photo', MIB, 'image/png'),
        file('f1', 'file', 10, 'application/zip'),
      ],
      openAttachment,
    );
    await show();
    // A failed photo says why, and a tap tries again.
    expect(text(tree)).toContain(
      "Photo, 2.0 KB|Can't open: the file is damaged or was changed",
    );
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 2.0 KB').props.onPress(),
    );
    expect(photoTries).toBe(2);
    expect(imageOf(tree, 'Photo, 2.0 KB')).toBe('file:///c/p1');
    // Too large to download, or too many pixels to draw: a card instead of an image.
    expect(text(tree)).toContain(
      'Photo, 300.0 MB|Too large to open on this phone',
    );
    expect(button(tree, 'Photo, 300.0 MB').props.disabled).toBe(true);
    expect(imageOf(tree, 'Photo, 1.0 MB')).toBeUndefined();
    expect(text(tree)).toContain('Photo, 1.0 MB|Hold to share or save');
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 1.0 MB').props.onPress(),
    );
    // Already downloaded, so the card previews the same file.
    expect(nativeFiles.previewAttachment).toHaveBeenCalledWith('file:///c/p3');
    expect(share).not.toHaveBeenCalled();
    expect(
      openAttachment.mock.calls.filter(([a]) => a.id === 'p3'),
    ).toHaveLength(1);
    // A file being opened cannot be tapped again.
    const zip = () => button(tree, 'File, 10 B');
    await ReactTestRenderer.act(async () => {
      zip().props.onPress();
    });
    expect(text(tree)).toContain('File, 10 B|Opening…');
    expect(zip().props.disabled).toBe(true);
    await ReactTestRenderer.act(async () => finishFile());
    expect(text(tree)).toContain('File, 10 B|Hold to share or save');
  } finally {
    share.mockRestore();
  }
});

test('keeps at most 256 MiB of opened files, deleting the oldest', async () => {
  const openAttachment = jest.fn(async (a: Attachment) => `file:///c/${a.id}`);
  const { tree, show } = await chatWithFiles(
    ['q1', 'q2', 'q3'].map(id => file(id, 'photo', 100 * MIB, 'image/png')),
    openAttachment,
  );
  await show();
  for (let i = 0; i < 3; i++)
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 100.0 MB, tap to load').props.onPress(),
    );
  expect(openAttachment.mock.calls.map(([a]) => a.id)).toEqual([
    'q1',
    'q2',
    'q3',
  ]);
  expect(nativeFiles.deleteAttachment.mock.calls).toEqual([['file:///c/q1']]);
});

test("counts opened files by their decrypted size, not the server's", async () => {
  // Each photo claims 1 B but decrypts to 100 MiB: the third still evicts the first.
  const openAttachment = jest.fn(async (a: Attachment) => ({
    uri: `file:///c/${a.id}`,
    size: 100 * MIB,
  }));
  const { show } = await chatWithFiles(
    ['q1', 'q2', 'q3'].map(id => file(id, 'photo', 1, 'image/png')),
    openAttachment,
  );
  await show();
  expect(openAttachment).toHaveBeenCalledTimes(3);
  expect(nativeFiles.deleteAttachment.mock.calls).toEqual([['file:///c/q1']]);
});

test('offers share and save on a hold on Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  type Button = { text: string; onPress?: () => void };
  type Menu = { buttons: Button[]; dismiss?: () => void };
  const menus: Menu[] = [];
  const alert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((_title, _message, buttons, options) => {
      if (buttons)
        menus.push({
          buttons: buttons as Button[],
          dismiss: options?.onDismiss,
        });
    });
  // Back or a tap outside dismisses the menu.
  const pick = async (choice: string) =>
    ReactTestRenderer.act(async () => {
      const menu = menus.pop();
      if (choice === 'dismiss') menu?.dismiss?.();
      else menu?.buttons.find(b => b.text === choice)?.onPress?.();
      await new Promise<void>(resolve => setImmediate(resolve));
    });
  const failures = ['E_CONCORD_CRYPTO_UNSUPPORTEDFORMAT', undefined];
  const openAttachment = jest.fn(async () => {
    if (failures.length)
      throw Object.assign(new Error('failed'), { code: failures.shift() });
    return 'file:///c/f1';
  });
  try {
    const { tree, show } = await chatWithFiles(
      [file('f1', 'file', 10, 'application/zip')],
      openAttachment,
    );
    await show();
    // No previewer yet, so a tap does nothing.
    expect(text(tree)).toContain(
      'File, 10 B|No preview on Android yet. Hold to share or save',
    );
    expect(button(tree, 'File, 10 B')).toBeUndefined();
    // The menu comes first; a cancel downloads nothing.
    await hold(tree, 'File, 10 B');
    expect(menus[0].buttons.map(b => b.text)).toEqual([
      'Share…',
      'Save to phone…',
    ]);
    await pick('dismiss');
    expect(openAttachment).not.toHaveBeenCalled();
    // A failed open says why.
    await hold(tree, 'File, 10 B');
    await pick('Share…');
    expect(alert).toHaveBeenLastCalledWith(
      'File, 10 B',
      'Update the app to open this file',
    );
    await hold(tree, 'File, 10 B');
    await pick('Share…');
    expect(alert).toHaveBeenLastCalledWith(
      'File, 10 B',
      "Couldn't open. Hold to try again",
    );
    // Native code types the share by the file's own extension, not the sender's type.
    await hold(tree, 'File, 10 B');
    await pick('Share…');
    expect(nativeFiles.shareAttachment).toHaveBeenCalledWith('file:///c/f1');
    await hold(tree, 'File, 10 B');
    await pick('Save to phone…');
    expect(nativeFiles.saveAttachment).toHaveBeenCalledWith('file:///c/f1');
    // Cancelling the save picker shows nothing.
    nativeFiles.saveAttachment.mockResolvedValueOnce(false);
    const alerts = alert.mock.calls.length;
    await hold(tree, 'File, 10 B');
    await pick('Save to phone…');
    expect(alert).toHaveBeenCalledTimes(alerts + 1);
    expect(nativeFiles.previewAttachment).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
  }
});

test('plays videos inline up to 64 MiB and asks before larger ones', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  let finishLarge!: () => void;
  let tries = 0;
  const openAttachment = jest.fn<
    ReturnType<OpenAttachment>,
    Parameters<OpenAttachment>
  >(async a => {
    if (a.id === 'v2')
      await new Promise<void>(resolve => {
        finishLarge = resolve;
      });
    if (a.id === 'v5' && tries++ === 0) throw new Error('offline');
    return `file:///c/${a.id}`;
  });
  const { tree, show } = await chatWithFiles(
    [
      file('v1', 'video', 5 * MIB, 'video/mp4'),
      file('v2', 'video', 70 * MIB, 'video/mp4'),
      file('v3', 'video', 300 * MIB, 'video/mp4'),
      file('v4', 'video', 1024, 'video/webm'),
      file('v5', 'video', 2048, 'video/mp4'),
      file('v6', 'video', 4096, 'video/x-flv'),
    ],
    openAttachment,
  );
  const video = (label: string) =>
    tree.root.findAll(
      n => n.props.accessibilityLabel === label && !!n.props.onLoad,
    )[0]?.props;
  expect(openAttachment).not.toHaveBeenCalled();
  await show();
  // Small videos preload, held to the auto-load limit, and wait paused for play.
  expect(openAttachment.mock.calls.map(([a, limit]) => [a.id, limit])).toEqual([
    ['v1', 64 * MIB + 4096],
    ['v4', 64 * MIB + 4096],
    ['v5', 64 * MIB + 4096],
    ['v6', 64 * MIB + 4096],
  ]);
  // Android buffers only seconds of each, and nothing goes to AirPlay.
  expect(video('Video, 5.0 MB')).toMatchObject({
    source: { uri: 'file:///c/v1', bufferConfig: { maxBufferMs: 5000 } },
    controls: true,
    paused: true,
    allowsExternalPlayback: false,
  });
  // A size the player cannot read keeps the default box.
  await ReactTestRenderer.act(async () =>
    video('Video, 1.0 KB').onLoad({ naturalSize: { width: 0, height: 0 } }),
  );
  expect(video('Video, 1.0 KB').style).toContainEqual({
    width: 200,
    height: 150,
  });
  await ReactTestRenderer.act(async () =>
    video('Video, 5.0 MB').onLoad({
      naturalSize: { width: 1920, height: 1080 },
    }),
  );
  expect(video('Video, 5.0 MB').style).toContainEqual({
    width: 240,
    height: 135,
  });
  // A large video asks first; one past the phone's limit is a card.
  const shown = text(tree);
  expect(shown).toContain('Large video, 70.0 MB. Tap to play');
  expect(shown).toContain('Video, 300.0 MB|Too large to open on this phone');
  await ReactTestRenderer.act(async () =>
    button(tree, 'Large video, 70.0 MB. Tap to play').props.onPress(),
  );
  expect(openAttachment).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'v2' }),
    256 * MIB + 4096,
  );
  expect(text(tree)).toContain('Video, 70.0 MB|Downloading…');
  await ReactTestRenderer.act(async () => finishLarge());
  expect(video('Video, 70.0 MB').source).toMatchObject({
    uri: 'file:///c/v2',
  });
  // One that failed to download says so, and a tap tries again.
  expect(text(tree)).toContain("Video, 2.0 KB|Couldn't open. Tap to try again");
  await ReactTestRenderer.act(async () =>
    button(tree, 'Video, 2.0 KB').props.onPress(),
  );
  expect(video('Video, 2.0 KB').source).toMatchObject({
    uri: 'file:///c/v5',
  });
  // A video the phone cannot play says so, naming its format, and never becomes a card.
  await ReactTestRenderer.act(async () => video('Video, 1.0 KB').onError());
  expect(text(tree)).toContain(
    "Video, 1.0 KB|This phone can't play this video (WEBM)|Hold to share or save",
  );
  await hold(tree, 'Video, 1.0 KB');
  expect(share).toHaveBeenLastCalledWith({ url: 'file:///c/v4' });
  // A type with no known extension is named by its MIME subtype.
  await ReactTestRenderer.act(async () => video('Video, 4.0 KB').onError());
  expect(text(tree)).toContain("This phone can't play this video (X-FLV)");
  // A playing video is held by its label, and shares the file it plays.
  await hold(tree, 'Video, 5.0 MB');
  expect(share).toHaveBeenLastCalledWith({ url: 'file:///c/v1' });
  expect(openAttachment.mock.calls.filter(([a]) => a.id === 'v1')).toHaveLength(
    1,
  );
  share.mockRestore();
});

test("keeps a video's file while it is on screen", async () => {
  // Each file decrypts to 100 MiB, so the photos push the cache past its limit. They open
  // straight after the video, before React renders it, so the hold must not wait for a render.
  const openAttachment = jest.fn(async (a: Attachment) => ({
    uri: `file:///c/${a.id}`,
    size: 100 * MIB,
  }));
  const { show } = await chatWithFiles(
    [
      file('v1', 'video', 1, 'video/mp4'),
      ...['q1', 'q2', 'q3'].map(id => file(id, 'photo', 1, 'image/png')),
    ],
    openAttachment,
  );
  await show();
  expect(openAttachment).toHaveBeenCalledTimes(4);
  // The oldest file is the video's, which a player still reads, so photos go instead.
  expect(nativeFiles.deleteAttachment.mock.calls).toEqual([
    ['file:///c/q1'],
    ['file:///c/q2'],
  ]);
});

test('previews text and Markdown files, collapsed, as plain text', async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  const long = Array.from({ length: 12 }, (_, i) => `# line ${i}`).join('\n');
  const wide = 'word '.repeat(60);
  const huge = 'x'.repeat(70 * 1024);
  texts.set('file:///c/long', long);
  texts.set('file:///c/short', 'hi');
  texts.set('file:///c/wide', wide);
  texts.set('file:///c/huge', huge);
  const { readAttachmentText } = nativeFiles;
  const openAttachment = jest.fn(async (a: Attachment) => {
    if (a.id === 'gone') throw new Error('offline');
    return `file:///c/${a.id}`;
  });
  try {
    const { tree, show } = await chatWithFiles(
      [
        file('long', 'file', 2048, 'text/markdown; charset=utf-8'),
        file('short', 'file', 2, 'text/plain'),
        file('bad', 'file', 3, 'text/plain'),
        file('big', 'file', 2 * MIB, 'text/plain'),
        file('wide', 'file', 300, 'text/plain'),
        file('huge', 'file', 70 * 1024, 'text/plain'),
        file('gone', 'file', 4, 'text/plain'),
      ],
      openAttachment,
    );
    // Only a name and size until the message is on screen.
    expect(text(tree)).toContain('File, 2.0 KB');
    expect(openAttachment).not.toHaveBeenCalled();
    await show();
    // Text up to 1 MiB preloads; a larger file waits for a tap like any other.
    expect(openAttachment.mock.calls.map(([a]) => a.id)).toEqual([
      'long',
      'short',
      'bad',
      'wide',
      'huge',
      'gone',
    ]);
    expect(openAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'long' }),
      MIB + 4096,
    );
    expect(readAttachmentText).toHaveBeenCalledWith('file:///c/long', MIB);
    const preview = (shown: string) =>
      tree.root
        .findAllByType('Text' as never)
        .find(n => n.props.children === shown);
    // Markdown shows as written, collapsed to nine lines, under the file's label.
    expect(preview(long)?.props.numberOfLines).toBe(9);
    expect(text(tree)).toContain(`File, 2.0 KB|Hold to share or save|${long}`);
    await ReactTestRenderer.act(async () =>
      button(tree, 'Expand (2.0 KB)').props.onPress(),
    );
    expect(preview(long)?.props.numberOfLines).toBeUndefined();
    await ReactTestRenderer.act(async () =>
      button(tree, 'Collapse').props.onPress(),
    );
    expect(preview(long)?.props.numberOfLines).toBe(9);
    // A tap on the label expands it too.
    await ReactTestRenderer.act(async () =>
      button(tree, 'File, 2.0 KB').props.onPress(),
    );
    expect(preview(long)?.props.numberOfLines).toBeUndefined();
    // A hold shares the whole file from the copy already decrypted.
    await hold(tree, 'File, 2.0 KB');
    expect(share).toHaveBeenCalledWith({ url: 'file:///c/long' });
    expect(
      openAttachment.mock.calls.filter(([a]) => a.id === 'long'),
    ).toHaveLength(1);
    const shown = text(tree);
    // Short text needs no toggle; an unreadable or undownloadable one is only a card.
    expect(shown).toContain('File, 2 B|Hold to share or save|hi');
    expect(shown).not.toContain('Expand (2 B)');
    expect(button(tree, 'File, 2 B')).toBeUndefined();
    expect(shown).toContain('File, 3 B|Hold to share or save');
    expect(shown).toContain('File, 4 B|Hold to share or save');
    expect(shown).toContain('File, 2.0 MB|Hold to share or save');
    // One line that wraps still gets a toggle.
    expect(shown).toContain('Expand (300 B)');
    // A long file hands layout only a bounded slice, collapsed or expanded.
    expect(preview(huge.slice(0, 2048))?.props.numberOfLines).toBe(9);
    await ReactTestRenderer.act(async () =>
      button(tree, 'Expand (70.0 KB)').props.onPress(),
    );
    expect(preview(huge.slice(0, 64 * 1024))).toBeDefined();
    expect(text(tree)).toContain(
      'Showing the first 64 KB. Hold to share or save the whole file.',
    );
  } finally {
    share.mockRestore();
  }
});

test('reads no text once the chat has closed', async () => {
  let finish!: () => void;
  texts.set('file:///c/slow', 'secret');
  const openAttachment = jest.fn(async (a: Attachment) => {
    await new Promise<void>(resolve => {
      finish = resolve;
    });
    return `file:///c/${a.id}`;
  });
  const { tree, show } = await chatWithFiles(
    [file('slow', 'file', 6, 'text/plain')],
    openAttachment,
  );
  await show();
  expect(openAttachment).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => tree.unmount());
  await ReactTestRenderer.act(async () => finish());
  expect(nativeFiles.readAttachmentText).not.toHaveBeenCalled();
});

test('holds animation for a tap while the phone asks for reduced motion', async () => {
  let changed!: (on: boolean) => void;
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((_event, handler) => {
      changed = handler as (on: boolean) => void;
      return { remove: jest.fn() };
    });
  const openAttachment = jest.fn(async (a: Attachment) => `file:///c/${a.id}`);
  try {
    const { tree, gif, show } = await chatWithFiles(
      [file('g1', 'animated', 1024, 'image/gif')],
      openAttachment,
    );
    await show();
    // Both a GIF message and an animated attachment wait.
    expect(
      text(tree)
        .split('|')
        .filter(t => t === 'Tap to play GIF'),
    ).toHaveLength(2);
    expect(gif).not.toHaveBeenCalled();
    expect(openAttachment).not.toHaveBeenCalled();
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function),
    );
    // Turning the setting off lets them play.
    await ReactTestRenderer.act(async () => changed(false));
    expect(gif).toHaveBeenCalledWith('tiny');
    expect(imageOf(tree, 'Animated image, 1.0 KB')).toBe('file:///c/g1');
  } finally {
    jest.restoreAllMocks();
  }
});

test('waits for a tap on an animated attachment when GIFs load on tap', async () => {
  const openAttachment = jest.fn(async (a: Attachment) => `file:///c/${a.id}`);
  const { tree, show } = await chatWithFiles(
    [file('g1', 'animated', 1024, 'image/gif')],
    openAttachment,
    false,
  );
  await show();
  expect(openAttachment).not.toHaveBeenCalled();
  const taps = tree.root.findAll(
    n =>
      n.props.accessibilityRole === 'button' &&
      !!n.props.onPress &&
      n
        .findAllByType('Text' as never)
        .some(t => t.props.children === 'Tap to load GIF'),
  );
  // The GIF message and the attachment each ask.
  expect(taps.length).toBeGreaterThanOrEqual(2);
  await ReactTestRenderer.act(async () =>
    button(tree, 'Tap to load GIF').props.onPress(),
  );
  await ReactTestRenderer.act(async () =>
    button(tree, 'Tap to load GIF').props.onPress(),
  );
  expect(imageOf(tree, 'Animated image, 1.0 KB')).toBe('file:///c/g1');
});

test.each(['late error', 'late success'] as const)(
  'ignores %s from an old Chat start after replacing the conversation',
  async outcome => {
    let settleOld!: (error?: Error) => void;
    let finishNew!: () => void;
    const old = {
      lines: [],
      dropped: false,
      onChange: null,
      start: jest.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            settleOld = error => (error ? reject(error) : resolve());
          }),
      ),
      send: jest.fn(async () => {}),
      close: jest.fn(),
      openAttachment: jest.fn(),
    };
    const replacement = {
      lines: [],
      dropped: false,
      onChange: null,
      start: jest.fn(
        () =>
          new Promise<void>(resolve => {
            finishNew = resolve;
          }),
      ),
      send: jest.fn(async () => {}),
      close: jest.fn(),
      openAttachment: jest.fn(),
    };
    useSession.setState({
      stage: { kind: 'signed_in', userId: 'u' },
      api: {} as ConcordApi,
      identity: 'HANDLE' as never,
    });
    const firstDm = {
      id: 'd1',
      title: 'First',
      unreadCount: 0,
      lastActivity: 'now',
    };
    const nextDm = {
      id: 'd2',
      title: 'Second',
      unreadCount: 0,
      lastActivity: 'now',
    };
    const open = (
      ...args: ConstructorParameters<
        typeof import('../src/state/conversation').Conversation
      >
    ) => (args[2] === 'd1' ? old : replacement);
    await ReactTestRenderer.act(async () => {
      mounted = ReactTestRenderer.create(
        <Chat dm={firstDm} onBack={() => {}} open={open} />,
      );
    });
    const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
    expect(text(tree)).toContain('Decrypting messages');
    await ReactTestRenderer.act(async () => {
      mounted?.update(<Chat dm={nextDm} onBack={() => {}} open={open} />);
    });
    expect(old.close).toHaveBeenCalledTimes(1);
    expect(replacement.start).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      settleOld(
        outcome === 'late error' ? new Error('old server secret') : undefined,
      );
      await Promise.resolve();
    });
    expect(text(tree)).toContain('Second');
    expect(text(tree)).toContain('Decrypting messages');
    expect(text(tree)).not.toContain('Could not reach the server');
    expect(text(tree)).not.toContain('old server secret');
    expect(text(tree)).not.toContain('No messages yet');

    await ReactTestRenderer.act(async () => {
      finishNew();
      await Promise.resolve();
    });
    expect(text(tree)).toContain('No messages yet');
  },
);

test('an old Chat send failure cannot restore its draft, error or sending state over a replacement', async () => {
  let rejectOld!: (error: Error) => void;
  let finishNew!: () => void;
  const old = {
    lines: [],
    dropped: false,
    onChange: null,
    start: jest.fn(async () => {}),
    send: jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    ),
    close: jest.fn(),
    openAttachment: jest.fn(),
  };
  const replacement = {
    lines: [],
    dropped: false,
    onChange: null,
    start: jest.fn(async () => {}),
    send: jest.fn(
      () =>
        new Promise<void>(resolve => {
          finishNew = resolve;
        }),
    ),
    close: jest.fn(),
    openAttachment: jest.fn(),
  };
  useSession.setState({
    stage: { kind: 'signed_in', userId: 'u' },
    api: {} as ConcordApi,
    identity: 'HANDLE' as never,
  });
  const firstDm = {
    id: 'd1',
    title: 'First',
    unreadCount: 0,
    lastActivity: 'now',
  };
  const nextDm = {
    id: 'd2',
    title: 'Second',
    unreadCount: 0,
    lastActivity: 'now',
  };
  const open = (
    ...args: ConstructorParameters<
      typeof import('../src/state/conversation').Conversation
    >
  ) => (args[2] === 'd1' ? old : replacement);
  await ReactTestRenderer.act(async () => {
    mounted = ReactTestRenderer.create(
      <Chat dm={firstDm} onBack={() => {}} open={open} />,
    );
  });
  const tree = mounted as unknown as ReactTestRenderer.ReactTestRenderer;
  const input = () => tree.root.findByProps({ accessibilityLabel: 'Message' });
  const sendButton = () =>
    tree.root.findAll(
      n => n.props.accessibilityLabel === 'Send' && !!n.props.onPress,
    )[0];
  await ReactTestRenderer.act(async () =>
    input().props.onChangeText('old draft'),
  );
  let oldPending!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    oldPending = sendButton().props.onPress();
  });
  expect(old.send).toHaveBeenCalledWith('old draft');

  await ReactTestRenderer.act(async () => {
    mounted?.update(<Chat dm={nextDm} onBack={() => {}} open={open} />);
  });
  expect(old.close).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () =>
    input().props.onChangeText('new draft'),
  );
  // Invoke the controlled handler to stage a successor send while its predecessor
  // is still pending; this isolates stale completion from button disable policy.
  let newPending!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    newPending = sendButton().props.onPress();
  });
  expect(replacement.send).toHaveBeenCalledWith('new draft');

  await ReactTestRenderer.act(async () => {
    rejectOld(new Error('old server text must stay private'));
    await oldPending;
  });
  expect(input().props.value).toBe('');
  expect(text(tree)).not.toContain('Could not reach the server');
  expect(text(tree)).not.toContain('old server text');
  await ReactTestRenderer.act(async () =>
    input().props.onChangeText('later edit'),
  );
  expect(sendButton().props.disabled).toBe(true);

  await ReactTestRenderer.act(async () => {
    finishNew();
    await newPending;
  });
  expect(input().props.value).toBe('later edit');
  expect(sendButton().props.disabled).toBe(false);
});
