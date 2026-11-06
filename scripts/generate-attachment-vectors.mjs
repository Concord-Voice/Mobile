#!/usr/bin/env node
// Writes native/ConcordCrypto/Tests/attachment-vectors.json from desktop's own attachment
// crypto, so the iOS and Android decoders are tested against the code that writes real files.
//
// Usage (Node 22.10 or later, synthetic keys only):
//   node --experimental-strip-types scripts/generate-attachment-vectors.mjs <desktop-crypto-dir>
// where <desktop-crypto-dir> holds desktop's attachmentChunkedCrypto.ts and attachmentCrypto.ts
// (Desktop repo: src/renderer/utils/crypto). Both are copied to a temp dir, because Node needs
// the explicit .ts extension on the one relative import.
import { createHash, createSecretKey } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = process.argv[2];
if (!source) throw new Error('usage: generate-attachment-vectors.mjs <desktop-crypto-dir>');
const work = mkdtempSync(join(tmpdir(), 'attachment-vectors-'));
for (const name of ['attachmentChunkedCrypto.ts', 'attachmentCrypto.ts'])
  copyFileSync(join(source, name), join(work, name));
const chunked = join(work, 'attachmentChunkedCrypto.ts');
writeFileSync(
  chunked,
  readFileSync(chunked, 'utf8').replace("from './attachmentCrypto'", "from './attachmentCrypto.ts'"),
);
const desk = await import(join(work, 'attachmentChunkedCrypto.ts'));
const legacy = await import(join(work, 'attachmentCrypto.ts'));

// Desktop draws IVs from crypto.getRandomValues; queued values make chosen IVs reproducible.
const queued = [];
const realRandom = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = array => {
  const next = queued.shift();
  if (!next) return realRandom(array);
  if (next.length !== array.length) throw new Error('queued random value has the wrong length');
  array.set(next);
  return array;
};

const bytes = (length, at) => Uint8Array.from({ length }, (_, i) => at(i));
const b64 = data => Buffer.from(data).toString('base64');
const sha256 = data => createHash('sha256').update(data).digest('hex');
// The synthetic keys become CryptoKeys here; every encryption runs in desktop's own modules.
const importKey = raw =>
  createSecretKey(raw).toCryptoKey('AES-GCM', false, ['encrypt', 'decrypt']);

// Synthetic keys, never used outside tests. They are not written to the fixture: the iOS and
// Android tests rebuild them from these same formulas.
const keyBytes = bytes(32, i => (i * 7 + 3) & 0xff);
const wrongKeyBytes = bytes(32, i => (i * 13 + 5) & 0xff);
const key = await importKey(keyBytes);
const wrongKey = await importKey(wrongKeyBytes);
const plain = bytes(300, i => (i * 31 + 1) & 0xff);
const nonce = bytes(16, i => 0xa0 + i);

async function chunkedBlob(version, plaintext, ivs, fileNonce = nonce) {
  const header = {
    version,
    flags: 0,
    chunkSize: desk.CHUNK_PLAINTEXT_BYTES,
    totalChunks: desk.totalChunksFor(plaintext.length, version),
    fileNonce,
  };
  const source = desk.bufferChunkSource(plaintext);
  const parts = [];
  for (let i = 0; i < header.totalChunks; i++) {
    if (ivs) queued.push(ivs[i]);
    parts.push(await desk.buildUploadPart(source, key, header, i));
  }
  return Buffer.concat(parts);
}

// What desktop itself does with a blob: the expected result for every native decoder.
async function outcome(blob, useKey) {
  try {
    const out = await desk.decryptAttachmentBlob(new Uint8Array(blob), useKey, 'application/octet-stream');
    return { expect: 'ok', plaintext: Buffer.from(await out.arrayBuffer()) };
  } catch (error) {
    if (error instanceof desk.AttachmentIntegrityError) return { expect: 'integrity' };
    if (error instanceof desk.UnsupportedAttachmentFormatError) return { expect: 'unsupported' };
    throw error;
  }
}

const edit = (blob, change) => {
  const copy = Buffer.from(blob);
  change(copy);
  return copy;
};

const v2 = await chunkedBlob(2, plain);
const v3 = await chunkedBlob(3, plain);
const otherFile = await chunkedBlob(2, plain, null, bytes(16, i => 0x50 + i));
queued.push(bytes(12, i => (i === 0 ? 0x43 : i === 1 ? 0x56 : 0x30 + i)));
const legacyCv = Buffer.from(await legacy.encryptFile(plain.slice().buffer, key));
const cases = {
  'legacy-ok': Buffer.from(await legacy.encryptFile(plain.slice().buffer, key)),
  // About 1 in 65,536 legacy IVs start with "CV"; the length arithmetic keeps them legacy.
  'legacy-starts-with-magic': legacyCv,
  'legacy-shorter-than-iv-and-tag': Buffer.from(bytes(20, i => i)),
  'v2-ok': v2,
  'v3-ok': v3,
  'v2-relabelled-v3': edit(v2, b => (b[2] = 3)),
  'v3-relabelled-v2': edit(v3, b => (b[2] = 2)),
  'v2-flags-set': edit(v2, b => (b[3] = 1)),
  'v2-future-version': edit(v2, b => (b[2] = 4)),
  'v2-other-chunk-size': edit(v2, b => b.writeUInt32BE(4 * 1024 * 1024, 4)),
  'v2-claims-two-chunks': edit(v2, b => b.writeUInt32BE(2, 8)),
  'v2-header-nonce-changed': edit(v2, b => (b[12] ^= 1)),
  'v2-iv-changed': edit(v2, b => (b[28] ^= 1)),
  'v2-ciphertext-changed': edit(v2, b => (b[40] ^= 1)),
  'v2-tag-changed': edit(v2, b => (b[b.length - 1] ^= 1)),
  'v2-truncated-by-one': v2.subarray(0, v2.length - 1),
  // File A's header in front of file B's chunk: the nonce in the AAD no longer matches.
  'v2-chunk-from-other-file': Buffer.concat([v2.subarray(0, 28), otherFile.subarray(28)]),
};

const out = { cases: [], twoChunk: [] };
for (const [id, blob] of Object.entries(cases)) {
  const result = await outcome(blob, key);
  out.cases.push({
    id,
    key: 'right',
    expect: result.expect,
    blobBase64: b64(blob),
    ...(result.plaintext ? { plaintextBase64: b64(result.plaintext) } : {}),
  });
}
for (const id of ['legacy-ok', 'v2-ok', 'v3-ok']) {
  const result = await outcome(cases[id], wrongKey);
  out.cases.push({ id: `${id}-wrong-key`, key: 'wrong', expect: result.expect, blobBase64: b64(cases[id]) });
}

// Two-chunk files are over 8 MiB, so only their recipe and hash are committed: each native test
// rebuilds the blob with these IVs and must reach the same SHA-256 before it decrypts it.
const bigLength = desk.CHUNK_PLAINTEXT_BYTES + 1000;
const big = bytes(bigLength, i => i % 251);
for (const version of [2, 3]) {
  const ivs = [0, 1].map(i => bytes(12, () => 0x10 + i));
  const blob = await chunkedBlob(version, big, ivs);
  const result = await outcome(blob, key);
  if (result.expect !== 'ok' || !result.plaintext.equals(Buffer.from(big)))
    throw new Error(`two-chunk v${version} did not round-trip`);
  out.twoChunk.push({
    version,
    plaintextLength: bigLength,
    plaintextRule: 'byte i is i % 251',
    nonceHex: Buffer.from(nonce).toString('hex'),
    ivRule: 'chunk i uses 12 bytes of 0x10 + i',
    blobLength: blob.length,
    blobSha256: sha256(blob),
  });
}

const target = resolve(import.meta.dirname, '../native/ConcordCrypto/Tests/attachment-vectors.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(
  out.cases.map(c => `${c.id}: ${c.expect}`).join('\n'),
  `\n${out.twoChunk.length} two-chunk recipes -> ${target}`,
);
