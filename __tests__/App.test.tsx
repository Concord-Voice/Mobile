import {
  AccessibilityInfo,
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

/** The native calls Chat makes itself. An image's pixel size comes from `pixels`, by URI. */
const pixels = new Map<string, { width: number; height: number }>();
const nativeFiles = {
  attachmentImageSize: jest.fn(
    async (uri: string) => pixels.get(uri) ?? { width: 0, height: 0 },
  ),
  deleteAttachment: jest.fn(async (_uri: string) => null),
  shareAttachment: jest.fn(async (_uri: string) => null),
};
const modules = NativeModules as { ConcordCryptoModule?: object };

afterEach(async () => {
  await ReactTestRenderer.act(() => mounted?.unmount());
  mounted = null;
  delete modules.ConcordCryptoModule;
  pixels.clear();
  Object.values(nativeFiles).forEach(f => f.mockClear());
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

type OpenAttachment = (a: Attachment, limit: number) => Promise<string>;

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
    openAttachment,
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

test('shows photos inline and opens other files only on a tap', async () => {
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
    expect(shown).toContain('File, 3.0 MB|Tap to open');
    expect(shown).toContain('File, 300.0 MB|Too large to open on this phone');
    expect(button(tree, 'File, 300.0 MB').props.disabled).toBe(true);
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 70.0 MB, tap to load').props.onPress(),
    );
    expect(openAttachment).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'p2' }),
      256 * MIB + 4096,
    );
    expect(imageOf(tree, 'Photo, 70.0 MB')).toBe('file:///c/p2');

    // A failed open says why and tries again on the next tap; an opened file is not
    // downloaded twice.
    const pdf = () => button(tree, 'File, 3.0 MB');
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    expect(text(tree)).toContain(
      "File, 3.0 MB|Can't open: the file is damaged or was changed",
    );
    expect(share).not.toHaveBeenCalled();
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    await ReactTestRenderer.act(async () => pdf().props.onPress());
    expect(share).toHaveBeenCalledTimes(2);
    expect(share).toHaveBeenCalledWith({ url: 'file:///c/f1' });
    expect(pdfTries).toBe(2);
    expect(text(tree)).toContain('File, 3.0 MB|Tap to open');
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
    expect(text(tree)).toContain('Photo, 1.0 MB|Tap to open');
    await ReactTestRenderer.act(async () =>
      button(tree, 'Photo, 1.0 MB').props.onPress(),
    );
    // Already downloaded, so the card shares the same file.
    expect(share).toHaveBeenCalledWith({ url: 'file:///c/p3' });
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
    expect(text(tree)).toContain('File, 10 B|Tap to open');
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

test('opens files through the native share sheet on Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const failures = [
    ['E_CONCORD_CRYPTO_UNSUPPORTEDFORMAT', 'Update the app to open this file'],
    ['E_CONCORD_CRYPTO_TOOLARGE', 'Too large to open on this phone'],
    [undefined, "Couldn't open. Tap to try again"],
  ];
  const openAttachment = jest.fn(async () => {
    const failure = failures.shift();
    if (failure) throw Object.assign(new Error('failed'), { code: failure[0] });
    return 'file:///c/f1';
  });
  try {
    const { tree, show } = await chatWithFiles(
      [file('f1', 'file', 10, 'application/zip')],
      openAttachment,
    );
    await show();
    const messages = [
      'Update the app to open this file',
      'Too large to open on this phone',
      "Couldn't open. Tap to try again",
    ];
    for (const message of messages) {
      await ReactTestRenderer.act(async () =>
        button(tree, 'File, 10 B').props.onPress(),
      );
      expect(text(tree)).toContain(`File, 10 B|${message}`);
    }
    await ReactTestRenderer.act(async () =>
      button(tree, 'File, 10 B').props.onPress(),
    );
    // Native code types the share by the file's own extension, not the sender's type.
    expect(nativeFiles.shareAttachment).toHaveBeenCalledWith('file:///c/f1');
  } finally {
    jest.restoreAllMocks();
  }
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
