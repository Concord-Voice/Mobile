declare const manifest: {
  readonly schema: 1;
  readonly nonce: string;
  readonly sourceHead: string;
  readonly checkoutCommit: string;
  readonly runId: string;
  readonly platform: 'ios' | 'android';
  readonly rnVersion: string;
  readonly reactVersion: string;
  readonly compilerPackage: string;
  readonly nativeEnginePackage: string;
  readonly nativeSelectionSha256: string;
  readonly ossVersion: string;
  readonly compilerReleaseVersion: string;
  readonly hbcVersion: number;
  readonly syntheticPassword: string;
};
export default manifest;
