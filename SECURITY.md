# Security

> **Reporting a vulnerability?** Do not open a public issue. Follow the
> [Concord Voice disclosure policy](https://github.com/Concord-Voice/.github/blob/main/SECURITY.md).

## Threat model summary

- This repository is the Concord Voice app for iOS and Android. It is pre-alpha and not in any app store.
- The app signs in to a server the user chooses, and encrypts and decrypts messages and attachments on the device.
- Keys stay in a native module on each platform. JavaScript holds opaque handles only, but it is inside the trust boundary.
- The most valuable assets are the identity private key, the account password, and decrypted content.
- The main adversaries are a hostile server operator, a compromised dependency, a network attacker, a malicious peer, and the holder of a lost device.
- The thinnest ground is the key-wrap design, the JavaScript bundle's reach into native crypto, server-asserted key material, and transport trust without pinning.
- Android has fewer protective layers than iOS today. There is no release signing or store pipeline yet.

The full model, with the attack surface, trust boundaries, security objectives and ranked hardening actions, is in [docs/threat-model.md](docs/threat-model.md).

## Guidance for automated review

This section is review guidance for people, AI agents and code scanners that read this repository. It is not the disclosure scope; the disclosure policy linked above defines that.

### Report

- Key bytes, the password, tokens or message plaintext that reach JavaScript, logs, error text, backups, or storage outside the paths the model names.
- A network request that sends session headers to a host other than the signed-in server, follows a redirect with them, or uses plain http outside loopback.
- A decrypt path that leaves unauthenticated plaintext, accepts a key for the wrong epoch, or falls back to another algorithm.
- A file operation in the native module that reaches outside the attachment cache folder.
- A new exported Android component, URL scheme, intent filter, permission or entitlement.
- A weaker access-control flag on a Keychain item or Keystore key.
- A workflow that runs pull-request code with a secret, an action not pinned by commit hash, or a change that lets a pull request alter scanner policy.

### Do not report

- Findings in `node_modules`, vendored dependency copies, build output or lockfile formatting.
- Test fixtures, canary files under `.semgrep/tests/`, and the test-only entry under `scripts/native-runtime-probe/`.
- The debug keystore password and the development bundle server, which exist in debug builds only.
- The absence of features the model lists as not built, such as push notifications and deep links.
- Structural limits that the model already records under "Weakest ground", unless you have found a concrete defect in them.

### Severity

- **Critical:** code execution in the app from server or peer input; a bypass of the biometric gate on the stored identity key; session or account takeover that needs no action by the victim; exposure of the identity private key, the account password or message plaintext to anyone other than the device user.
- **High:** access to a user's data, or session takeover, that needs the victim's action; session headers sent to another host; a pull-request path to a CI secret.
- **Medium:** metadata exposure; plaintext left on disk after sign-out; a denial of service that needs a hostile server.
- **Low:** hardening gaps with no direct path to an asset.
