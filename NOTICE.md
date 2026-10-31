# Third-party notices

This inventory covers the Mobile application's production npm dependencies,
its locked CocoaPods components, its resolved Android runtime dependencies,
and the reference Argon2 code vendored in the native crypto module.
Development tools and other Concord applications are outside this inventory.

## JavaScript dependencies

Generated from the installed production graph using Alpha's pinned license-checker.
Run `python3 scripts/update-mobile-notice.py --check` to verify the table.

<!-- mobile-npm:start -->

| Package | Version | License | Repository |
| --- | --- | --- | --- |
| @babel/code-frame | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/compat-data | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/core | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/generator | 7.29.8 | MIT | https://github.com/babel/babel |
| @babel/helper-annotate-as-pure | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-compilation-targets | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-create-class-features-plugin | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-create-regexp-features-plugin | 7.29.10 | MIT | https://github.com/babel/babel |
| @babel/helper-define-polyfill-provider | 0.6.8 | MIT | https://github.com/babel/babel-polyfills |
| @babel/helper-globals | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-member-expression-to-functions | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-module-imports | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-module-transforms | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-optimise-call-expression | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-plugin-utils | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-remap-async-to-generator | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-replace-supers | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-skip-transparent-expression-wrappers | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-string-parser | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-validator-identifier | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-validator-option | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helper-wrap-function | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/helpers | 7.29.10 | MIT | https://github.com/babel/babel |
| @babel/parser | 7.29.9 | MIT | https://github.com/babel/babel |
| @babel/plugin-proposal-export-default-from | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-syntax-dynamic-import | 7.8.3 | MIT | https://github.com/babel/babel/tree/master/packages/babel-plugin-syntax-dynamic-import |
| @babel/plugin-syntax-export-default-from | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-syntax-flow | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-syntax-jsx | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-syntax-nullish-coalescing-operator | 7.8.3 | MIT | https://github.com/babel/babel/tree/master/packages/babel-plugin-syntax-nullish-coalescing-operator |
| @babel/plugin-syntax-optional-chaining | 7.8.3 | MIT | https://github.com/babel/babel/tree/master/packages/babel-plugin-syntax-optional-chaining |
| @babel/plugin-syntax-typescript | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-async-generator-functions | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-async-to-generator | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-block-scoping | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-class-properties | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-classes | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-destructuring | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-flow-strip-types | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-for-of | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-modules-commonjs | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-named-capturing-groups-regex | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-nullish-coalescing-operator | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-optional-catch-binding | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-optional-chaining | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-private-methods | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-private-property-in-object | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-react-display-name | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-react-jsx-self | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-react-jsx-source | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-react-jsx | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-regenerator | 7.29.8 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-runtime | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-typescript | 7.29.9 | MIT | https://github.com/babel/babel |
| @babel/plugin-transform-unicode-regex | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/runtime | 7.29.10 | MIT | https://github.com/babel/babel |
| @babel/template | 7.29.7 | MIT | https://github.com/babel/babel |
| @babel/traverse | 7.29.10 | MIT | https://github.com/babel/babel |
| @babel/types | 7.29.8 | MIT | https://github.com/babel/babel |
| @hapi/hoek | 9.3.0 | BSD-3-Clause | https://github.com/hapijs/hoek |
| @hapi/topo | 5.1.0 | BSD-3-Clause | https://github.com/hapijs/topo |
| @isaacs/ttlcache | 1.4.1 | ISC | https://github.com/isaacs/ttlcache |
| @jest/schemas | 29.6.3 | MIT | https://github.com/jestjs/jest |
| @jest/types | 29.6.3 | MIT | https://github.com/jestjs/jest |
| @jridgewell/gen-mapping | 0.3.13 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/remapping | 2.3.5 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/resolve-uri | 3.1.2 | MIT | https://github.com/jridgewell/resolve-uri |
| @jridgewell/source-map | 0.3.11 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | https://github.com/jridgewell/sourcemaps |
| @jridgewell/trace-mapping | 0.3.31 | MIT | https://github.com/jridgewell/sourcemaps |
| @nodable/entities | 3.1.0 | MIT | https://github.com/nodable/val-parsers |
| @nodelib/fs.scandir | 2.1.5 | MIT | https://github.com/nodelib/nodelib/tree/master/packages/fs/fs.scandir |
| @nodelib/fs.stat | 2.0.5 | MIT | https://github.com/nodelib/nodelib/tree/master/packages/fs/fs.stat |
| @nodelib/fs.walk | 1.2.8 | MIT | https://github.com/nodelib/nodelib/tree/master/packages/fs/fs.walk |
| @react-native-community/cli-clean | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-config-android | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-config-apple | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-config | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-doctor | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-platform-android | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-platform-apple | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-platform-ios | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-server-api | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-tools | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli-types | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native-community/cli | 20.2.0 | MIT | https://github.com/react-native-community/cli |
| @react-native/asset-utils | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/babel-plugin-codegen | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/babel-preset | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/codegen | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/community-cli-plugin | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/debugger-frontend | 0.88.0 | BSD-3-Clause | https://github.com/react/react-native |
| @react-native/debugger-shell | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/dev-middleware | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/gradle-plugin | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/js-polyfills | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/metro-babel-transformer | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/metro-config | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/normalize-colors | 0.88.0 | MIT | https://github.com/react/react-native |
| @react-native/virtualized-lists | 0.88.0 | MIT | https://github.com/react/react-native |
| @sideway/address | 4.1.5 | BSD-3-Clause | https://github.com/sideway/address |
| @sideway/formula | 3.0.1 | BSD-3-Clause | https://github.com/sideway/formula |
| @sideway/pinpoint | 2.0.0 | BSD-3-Clause | https://github.com/sideway/pinpoint |
| @sinclair/typebox | 0.27.12 | MIT | https://github.com/sinclairzx81/sinclair-typebox |
| @types/istanbul-lib-coverage | 2.0.6 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/istanbul-lib-report | 3.0.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/istanbul-reports | 3.0.4 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | 26.6.5 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/yargs-parser | 21.0.3 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/yargs | 17.0.35 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @vscode/sudo-prompt | 9.3.2 | MIT | https://github.com/microsoft/vscode-sudo-prompt |
| accepts | 1.3.8 | MIT | https://github.com/jshttp/accepts |
| accepts | 2.0.0 | MIT | https://github.com/jshttp/accepts |
| acorn | 8.19.0 | MIT | https://github.com/acornjs/acorn |
| agent-base | 7.1.4 | MIT | https://github.com/TooTallNate/proxy-agents |
| anser | 1.4.10 | MIT | https://github.com/IonicaBizau/anser |
| ansi-fragments | 0.2.1 | MIT | https://github.com/zamotany/ansi-fragments |
| ansi-regex | 4.1.1 | MIT | https://github.com/chalk/ansi-regex |
| ansi-regex | 5.0.1 | MIT | https://github.com/chalk/ansi-regex |
| ansi-styles | 3.2.1 | MIT | https://github.com/chalk/ansi-styles |
| ansi-styles | 4.3.0 | MIT | https://github.com/chalk/ansi-styles |
| ansi-styles | 5.2.0 | MIT | https://github.com/chalk/ansi-styles |
| anynum | 1.0.1 | MIT | https://github.com/NaturalIntelligence/anynum |
| appdirsjs | 1.2.8 | MIT | https://github.com/codingjerk/appdirsjs |
| argparse | 2.0.1 | Python-2.0 | https://github.com/nodeca/argparse |
| asap | 2.0.6 | MIT | https://github.com/kriskowal/asap |
| astral-regex | 1.0.0 | MIT | https://github.com/kevva/astral-regex |
| async-limiter | 1.0.1 | MIT | https://github.com/strml/async-limiter |
| babel-plugin-polyfill-corejs2 | 0.4.17 | MIT | https://github.com/babel/babel-polyfills |
| babel-plugin-polyfill-corejs3 | 0.13.0 | MIT | https://github.com/babel/babel-polyfills |
| babel-plugin-polyfill-regenerator | 0.6.8 | MIT | https://github.com/babel/babel-polyfills |
| babel-plugin-transform-flow-enums | 0.0.2 | MIT | https://github.com/facebook/flow |
| base64-js | 1.5.1 | MIT | https://github.com/beatgammit/base64-js |
| baseline-browser-mapping | 2.11.32 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping |
| bl | 4.1.0 | MIT | https://github.com/rvagg/bl |
| body-parser | 2.4.0 | MIT | https://github.com/expressjs/body-parser |
| braces | 3.0.3 | MIT | https://github.com/micromatch/braces |
| browserslist | 4.29.4 | MIT | https://github.com/browserslist/browserslist |
| bser | 2.1.2 | MIT | https://github.com/facebook/watchman |
| buffer-from | 1.1.2 | MIT | https://github.com/LinusU/buffer-from |
| buffer | 5.7.1 | MIT | https://github.com/feross/buffer |
| bytes | 3.1.2 | MIT | https://github.com/visionmedia/bytes.js |
| call-bind-apply-helpers | 1.0.2 | MIT | https://github.com/ljharb/call-bind-apply-helpers |
| call-bound | 1.0.4 | MIT | https://github.com/ljharb/call-bound |
| callsites | 3.1.0 | MIT | https://github.com/sindresorhus/callsites |
| camelcase | 5.3.1 | MIT | https://github.com/sindresorhus/camelcase |
| camelcase | 6.3.0 | MIT | https://github.com/sindresorhus/camelcase |
| caniuse-lite | 1.0.30001819 | CC-BY-4.0 | https://github.com/browserslist/caniuse-lite |
| chalk | 4.1.2 | MIT | https://github.com/chalk/chalk |
| ci-info | 3.9.0 | MIT | https://github.com/watson/ci-info |
| cli-cursor | 3.1.0 | MIT | https://github.com/sindresorhus/cli-cursor |
| cli-spinners | 2.9.2 | MIT | https://github.com/sindresorhus/cli-spinners |
| cliui | 6.0.0 | ISC | https://github.com/yargs/cliui |
| cliui | 8.0.1 | ISC | https://github.com/yargs/cliui |
| clone | 1.0.4 | MIT | https://github.com/pvorb/node-clone |
| color-convert | 1.9.3 | MIT | https://github.com/Qix-/color-convert |
| color-convert | 2.0.1 | MIT | https://github.com/Qix-/color-convert |
| color-name | 1.1.3 | MIT | https://github.com/dfcreative/color-name |
| color-name | 1.1.4 | MIT | https://github.com/colorjs/color-name |
| colorette | 1.4.0 | MIT | https://github.com/jorgebucaran/colorette |
| command-exists | 1.2.9 | MIT | https://github.com/mathisonian/command-exists |
| commander | 12.1.0 | MIT | https://github.com/tj/commander.js |
| commander | 2.20.3 | MIT | https://github.com/tj/commander.js |
| commander | 9.5.0 | MIT | https://github.com/tj/commander.js |
| compressible | 2.0.18 | MIT | https://github.com/jshttp/compressible |
| compression | 1.8.2 | MIT | https://github.com/expressjs/compression |
| connect | 3.7.0 | MIT | https://github.com/senchalabs/connect |
| content-type | 2.1.0 | MIT | https://github.com/jshttp/content-type |
| convert-source-map | 2.0.0 | MIT | https://github.com/thlorenz/convert-source-map |
| core-js-compat | 3.51.0 | MIT | https://github.com/zloirock/core-js |
| cosmiconfig | 9.0.2 | MIT | https://github.com/cosmiconfig/cosmiconfig |
| cross-spawn | 7.0.6 | MIT | https://github.com/moxystudio/node-cross-spawn |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype |
| dayjs | 1.11.23 | MIT | https://github.com/iamkun/dayjs |
| debug | 2.6.9 | MIT | https://github.com/visionmedia/debug |
| debug | 4.4.3 | MIT | https://github.com/debug-js/debug |
| decamelize | 1.2.0 | MIT | https://github.com/sindresorhus/decamelize |
| deepmerge | 4.3.1 | MIT | https://github.com/TehShrike/deepmerge |
| defaults | 1.0.4 | MIT | https://github.com/sindresorhus/node-defaults |
| define-lazy-prop | 2.0.0 | MIT | https://github.com/sindresorhus/define-lazy-prop |
| depd | 2.0.0 | MIT | https://github.com/dougwilson/nodejs-depd |
| destroy | 1.2.0 | MIT | https://github.com/stream-utils/destroy |
| dunder-proto | 1.0.1 | MIT | https://github.com/es-shims/dunder-proto |
| ee-first | 1.1.1 | MIT | https://github.com/jonathanong/ee-first |
| electron-to-chromium | 1.5.464 | ISC | https://github.com/Kilian/electron-to-chromium |
| emoji-regex | 8.0.0 | MIT | https://github.com/mathiasbynens/emoji-regex |
| encodeurl | 1.0.2 | MIT | https://github.com/pillarjs/encodeurl |
| encodeurl | 2.0.0 | MIT | https://github.com/pillarjs/encodeurl |
| env-paths | 2.2.1 | MIT | https://github.com/sindresorhus/env-paths |
| envinfo | 7.21.0 | MIT | https://github.com/tabrindle/envinfo |
| error-ex | 1.3.4 | MIT | https://github.com/qix-/node-error-ex |
| error-stack-parser | 2.1.4 | MIT | https://github.com/stacktracejs/error-stack-parser |
| errorhandler | 1.5.2 | MIT | https://github.com/expressjs/errorhandler |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| es-object-atoms | 1.1.2 | MIT | https://github.com/ljharb/es-object-atoms |
| escalade | 3.2.0 | MIT | https://github.com/lukeed/escalade |
| escape-html | 1.0.3 | MIT | https://github.com/component/escape-html |
| etag | 1.8.1 | MIT | https://github.com/jshttp/etag |
| execa | 5.1.1 | MIT | https://github.com/sindresorhus/execa |
| exponential-backoff | 3.1.3 | Apache-2.0 | https://github.com/coveooss/exponential-backoff |
| fast-glob | 3.3.3 | MIT | https://github.com/mrmlnc/fast-glob |
| fast-xml-builder | 1.3.1 | MIT | https://github.com/NaturalIntelligence/fast-xml-builder |
| fast-xml-parser | 5.11.2 | MIT | https://github.com/NaturalIntelligence/fast-xml-parser |
| fastq | 1.20.3 | ISC | https://github.com/mcollina/fastq |
| fb-dotslash | 0.5.8 | (MIT OR Apache-2.0) | https://github.com/facebook/dotslash |
| fb-watchman | 2.0.4 | MIT | https://github.com/facebook/watchman |
| fdir | 6.5.0 | MIT | https://github.com/thecodrr/fdir |
| fill-range | 7.1.1 | MIT | https://github.com/jonschlinkert/fill-range |
| finalhandler | 1.1.2 | MIT | https://github.com/pillarjs/finalhandler |
| find-up | 4.1.0 | MIT | https://github.com/sindresorhus/find-up |
| find-up | 5.0.0 | MIT | https://github.com/sindresorhus/find-up |
| flow-enums-runtime | 0.0.6 | MIT | https://github.com/facebook/flow |
| flow-estree | 0.327.0 | MIT | https://github.com/facebook/flow |
| flow-estree | 0.331.0 | MIT | https://github.com/facebook/flow |
| flow-parser | 0.327.0 | MIT | https://github.com/facebook/flow |
| flow-parser | 0.331.0 | MIT | https://github.com/facebook/flow |
| fresh | 0.5.2 | MIT | https://github.com/jshttp/fresh |
| fs-extra | 8.1.0 | MIT | https://github.com/jprichardson/node-fs-extra |
| function-bind | 1.1.2 | MIT | https://github.com/Raynos/function-bind |
| gensync | 1.0.0-beta.2 | MIT | https://github.com/loganfsmyth/gensync |
| get-caller-file | 2.0.5 | ISC | https://github.com/stefanpenner/get-caller-file |
| get-intrinsic | 1.3.0 | MIT | https://github.com/ljharb/get-intrinsic |
| get-proto | 1.0.1 | MIT | https://github.com/ljharb/get-proto |
| get-stream | 6.0.1 | MIT | https://github.com/sindresorhus/get-stream |
| glob-parent | 5.1.2 | ISC | https://github.com/gulpjs/glob-parent |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| graceful-fs | 4.2.11 | ISC | https://github.com/isaacs/node-graceful-fs |
| has-flag | 4.0.0 | MIT | https://github.com/sindresorhus/has-flag |
| has-symbols | 1.1.0 | MIT | https://github.com/inspect-js/has-symbols |
| hasown | 2.0.4 | MIT | https://github.com/inspect-js/hasOwn |
| hermes-compiler | 260318099.0.4 | MIT | https://github.com/facebook/hermes |
| http-errors | 2.0.1 | MIT | https://github.com/jshttp/http-errors |
| https-proxy-agent | 7.0.6 | MIT | https://github.com/TooTallNate/proxy-agents |
| human-signals | 2.1.0 | Apache-2.0 | https://github.com/ehmicky/human-signals |
| iconv-lite | 0.7.3 | MIT | https://github.com/pillarjs/iconv-lite |
| ieee754 | 1.2.1 | BSD-3-Clause | https://github.com/feross/ieee754 |
| import-fresh | 3.3.1 | MIT | https://github.com/sindresorhus/import-fresh |
| inherits | 2.0.4 | ISC | https://github.com/isaacs/inherits |
| invariant | 2.2.4 | MIT | https://github.com/zertosh/invariant |
| is-arrayish | 0.2.1 | MIT | https://github.com/qix-/node-is-arrayish |
| is-core-module | 2.17.0 | MIT | https://github.com/inspect-js/is-core-module |
| is-docker | 2.2.1 | MIT | https://github.com/sindresorhus/is-docker |
| is-extglob | 2.1.1 | MIT | https://github.com/jonschlinkert/is-extglob |
| is-fullwidth-code-point | 2.0.0 | MIT | https://github.com/sindresorhus/is-fullwidth-code-point |
| is-fullwidth-code-point | 3.0.0 | MIT | https://github.com/sindresorhus/is-fullwidth-code-point |
| is-glob | 4.0.3 | MIT | https://github.com/micromatch/is-glob |
| is-interactive | 1.0.0 | MIT | https://github.com/sindresorhus/is-interactive |
| is-number | 7.0.0 | MIT | https://github.com/jonschlinkert/is-number |
| is-stream | 2.0.1 | MIT | https://github.com/sindresorhus/is-stream |
| is-unicode-supported | 0.1.0 | MIT | https://github.com/sindresorhus/is-unicode-supported |
| is-unsafe | 2.0.2 | MIT | https://github.com/NaturalIntelligence/is-unsafe |
| is-wsl | 1.1.0 | MIT | https://github.com/sindresorhus/is-wsl |
| is-wsl | 2.2.0 | MIT | https://github.com/sindresorhus/is-wsl |
| isexe | 2.0.0 | ISC | https://github.com/isaacs/isexe |
| jest-get-type | 29.6.3 | MIT | https://github.com/jestjs/jest |
| jest-util | 29.7.0 | MIT | https://github.com/jestjs/jest |
| jest-validate | 29.7.0 | MIT | https://github.com/jestjs/jest |
| jest-worker | 29.7.0 | MIT | https://github.com/jestjs/jest |
| joi | 17.13.8 | BSD-3-Clause | https://github.com/hapijs/joi |
| js-tokens | 4.0.0 | MIT | https://github.com/lydell/js-tokens |
| js-yaml | 4.3.2 | MIT | https://github.com/nodeca/js-yaml |
| jsc-safe-url | 0.2.4 | 0BSD | https://github.com/robhogan/jsc-safe-url |
| jsesc | 3.1.0 | MIT | https://github.com/mathiasbynens/jsesc |
| json-parse-even-better-errors | 2.3.1 | MIT | https://github.com/npm/json-parse-even-better-errors |
| json5 | 2.2.3 | MIT | https://github.com/json5/json5 |
| jsonfile | 4.0.0 | MIT | https://github.com/jprichardson/node-jsonfile |
| kleur | 3.0.3 | MIT | https://github.com/lukeed/kleur |
| launch-editor | 2.14.2 | MIT | https://github.com/vitejs/launch-editor |
| leven | 3.1.0 | MIT | https://github.com/sindresorhus/leven |
| lines-and-columns | 1.2.4 | MIT | https://github.com/eventualbuddha/lines-and-columns |
| locate-path | 5.0.0 | MIT | https://github.com/sindresorhus/locate-path |
| locate-path | 6.0.0 | MIT | https://github.com/sindresorhus/locate-path |
| lodash.debounce | 4.0.8 | MIT | https://github.com/lodash/lodash |
| lodash.throttle | 4.1.1 | MIT | https://github.com/lodash/lodash |
| log-symbols | 4.1.0 | MIT | https://github.com/sindresorhus/log-symbols |
| logkitty | 0.7.1 | MIT | https://github.com/zamotany/logkitty |
| loose-envify | 1.4.0 | MIT | https://github.com/zertosh/loose-envify |
| lru-cache | 5.1.1 | ISC | https://github.com/isaacs/node-lru-cache |
| math-intrinsics | 1.1.0 | MIT | https://github.com/es-shims/math-intrinsics |
| media-typer | 1.1.1 | MIT | https://github.com/jshttp/media-typer |
| memoize-one | 5.2.1 | MIT | https://github.com/alexreardon/memoize-one |
| merge-stream | 2.0.0 | MIT | https://github.com/grncdr/merge-stream |
| merge2 | 1.4.1 | MIT | https://github.com/teambition/merge2 |
| metro-babel-transformer | 0.87.1 | MIT | https://github.com/react/metro |
| metro-cache-key | 0.87.1 | MIT | https://github.com/react/metro |
| metro-cache | 0.87.1 | MIT | https://github.com/react/metro |
| metro-config | 0.87.1 | MIT | https://github.com/react/metro |
| metro-core | 0.87.1 | MIT | https://github.com/react/metro |
| metro-file-map | 0.87.1 | MIT | https://github.com/react/metro |
| metro-minify-terser | 0.87.1 | MIT | https://github.com/react/metro |
| metro-resolver | 0.87.1 | MIT | https://github.com/react/metro |
| metro-runtime | 0.87.1 | MIT | https://github.com/react/metro |
| metro-source-map | 0.87.1 | MIT | https://github.com/react/metro |
| metro-symbolicate | 0.87.1 | MIT | https://github.com/react/metro |
| metro-transform-plugins | 0.87.1 | MIT | https://github.com/react/metro |
| metro-transform-worker | 0.87.1 | MIT | https://github.com/react/metro |
| metro | 0.87.1 | MIT | https://github.com/react/metro |
| micromatch | 4.0.8 | MIT | https://github.com/micromatch/micromatch |
| mime-db | 1.52.0 | MIT | https://github.com/jshttp/mime-db |
| mime-db | 1.54.0 | MIT | https://github.com/jshttp/mime-db |
| mime-types | 2.1.35 | MIT | https://github.com/jshttp/mime-types |
| mime-types | 3.0.2 | MIT | https://github.com/jshttp/mime-types |
| mime | 1.6.0 | MIT | https://github.com/broofa/node-mime |
| mime | 2.6.0 | MIT | https://github.com/broofa/mime |
| mimic-fn | 2.1.0 | MIT | https://github.com/sindresorhus/mimic-fn |
| ms | 2.0.0 | MIT | https://github.com/zeit/ms |
| ms | 2.1.3 | MIT | https://github.com/vercel/ms |
| negotiator | 0.6.3 | MIT | https://github.com/jshttp/negotiator |
| negotiator | 0.6.4 | MIT | https://github.com/jshttp/negotiator |
| negotiator | 1.1.0 | MIT | https://github.com/jshttp/negotiator |
| nocache | 3.0.4 | MIT | https://github.com/helmetjs/nocache |
| node-int64 | 0.4.0 | MIT | https://github.com/broofa/node-int64 |
| node-releases | 2.0.60 | MIT | https://github.com/chicoxyzzy/node-releases |
| node-stream-zip | 1.16.0 | MIT | https://github.com/antelle/node-stream-zip |
| npm-run-path | 4.0.1 | MIT | https://github.com/sindresorhus/npm-run-path |
| nullthrows | 1.1.1 | MIT | https://github.com/zertosh/nullthrows |
| ob1 | 0.87.1 | MIT | https://github.com/react/metro |
| object-inspect | 1.13.4 | MIT | https://github.com/inspect-js/object-inspect |
| on-finished | 2.3.0 | MIT | https://github.com/jshttp/on-finished |
| on-finished | 2.4.2 | MIT | https://github.com/jshttp/on-finished |
| on-headers | 1.1.0 | MIT | https://github.com/jshttp/on-headers |
| onetime | 5.1.2 | MIT | https://github.com/sindresorhus/onetime |
| open | 6.4.0 | MIT | https://github.com/sindresorhus/open |
| open | 8.4.2 | MIT | https://github.com/sindresorhus/open |
| ora | 5.4.1 | MIT | https://github.com/sindresorhus/ora |
| p-limit | 2.3.0 | MIT | https://github.com/sindresorhus/p-limit |
| p-limit | 3.1.0 | MIT | https://github.com/sindresorhus/p-limit |
| p-locate | 4.1.0 | MIT | https://github.com/sindresorhus/p-locate |
| p-locate | 5.0.0 | MIT | https://github.com/sindresorhus/p-locate |
| p-try | 2.2.0 | MIT | https://github.com/sindresorhus/p-try |
| parent-module | 1.0.1 | MIT | https://github.com/sindresorhus/parent-module |
| parse-json | 5.2.0 | MIT | https://github.com/sindresorhus/parse-json |
| parseurl | 1.3.3 | MIT | https://github.com/pillarjs/parseurl |
| path-exists | 4.0.0 | MIT | https://github.com/sindresorhus/path-exists |
| path-expression-matcher | 1.6.2 | MIT | https://github.com/NaturalIntelligence/path-expression-matcher |
| path-key | 3.1.1 | MIT | https://github.com/sindresorhus/path-key |
| path-parse | 1.0.7 | MIT | https://github.com/jbgutierrez/path-parse |
| picocolors | 1.1.1 | ISC | https://github.com/alexeyraspopov/picocolors |
| picomatch | 2.3.2 | MIT | https://github.com/micromatch/picomatch |
| picomatch | 4.0.7 | MIT | https://github.com/micromatch/picomatch |
| pretty-format | 29.7.0 | MIT | https://github.com/jestjs/jest |
| promise | 8.3.0 | MIT | https://github.com/then/promise |
| prompts | 2.4.2 | MIT | https://github.com/terkelg/prompts |
| qs | 6.16.1 | BSD-3-Clause | https://github.com/ljharb/qs |
| queue-microtask | 1.2.3 | MIT | https://github.com/feross/queue-microtask |
| range-parser | 1.2.1 | MIT | https://github.com/jshttp/range-parser |
| raw-body | 3.0.2 | MIT | https://github.com/stream-utils/raw-body |
| react-devtools-core | 6.1.5 | MIT | https://github.com/facebook/react |
| react-is | 18.3.1 | MIT | https://github.com/facebook/react |
| react-native | 0.88.0 | MIT | https://github.com/react/react-native |
| react-refresh | 0.14.2 | MIT | https://github.com/facebook/react |
| react | 19.3.1 | MIT | https://github.com/react/react |
| readable-stream | 3.6.2 | MIT | https://github.com/nodejs/readable-stream |
| regenerate-unicode-properties | 10.3.0 | MIT | https://github.com/mathiasbynens/regenerate-unicode-properties |
| regenerate | 1.5.0 | MIT | https://github.com/mathiasbynens/regenerate |
| regenerator-runtime | 0.13.11 | MIT | https://github.com/facebook/regenerator/tree/main/packages/runtime |
| regexpu-core | 6.5.3 | MIT | https://github.com/mathiasbynens/regexpu-core |
| regjsgen | 0.8.0 | MIT | https://github.com/bnjmnt4n/regjsgen |
| regjsparser | 0.13.4 | BSD-2-Clause | https://github.com/jviereck/regjsparser |
| require-directory | 2.1.1 | MIT | https://github.com/troygoode/node-require-directory |
| require-main-filename | 2.0.0 | ISC | https://github.com/yargs/require-main-filename |
| resolve-from | 4.0.0 | MIT | https://github.com/sindresorhus/resolve-from |
| resolve | 1.22.13 | MIT | https://github.com/browserify/resolve |
| restore-cursor | 3.1.0 | MIT | https://github.com/sindresorhus/restore-cursor |
| reusify | 1.1.0 | MIT | https://github.com/mcollina/reusify |
| run-parallel | 1.2.0 | MIT | https://github.com/feross/run-parallel |
| safe-buffer | 5.2.1 | MIT | https://github.com/feross/safe-buffer |
| safer-buffer | 2.1.2 | MIT | https://github.com/ChALkeR/safer-buffer |
| scheduler | 0.28.0 | MIT | https://github.com/react/react |
| semver | 6.3.1 | ISC | https://github.com/npm/node-semver |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver |
| send | 0.19.2 | MIT | https://github.com/pillarjs/send |
| serialize-error | 2.1.0 | MIT | https://github.com/sindresorhus/serialize-error |
| serve-static | 1.16.3 | MIT | https://github.com/expressjs/serve-static |
| set-blocking | 2.0.0 | ISC | https://github.com/yargs/set-blocking |
| setprototypeof | 1.2.0 | ISC | https://github.com/wesleytodd/setprototypeof |
| shebang-command | 2.0.0 | MIT | https://github.com/kevva/shebang-command |
| shebang-regex | 3.0.0 | MIT | https://github.com/sindresorhus/shebang-regex |
| shell-quote | 1.12.0 | MIT | https://github.com/ljharb/shell-quote |
| side-channel-list | 1.0.1 | MIT | https://github.com/ljharb/side-channel-list |
| side-channel-map | 1.0.1 | MIT | https://github.com/ljharb/side-channel-map |
| side-channel-weakmap | 1.0.2 | MIT | https://github.com/ljharb/side-channel-weakmap |
| side-channel | 1.1.1 | MIT | https://github.com/ljharb/side-channel |
| signal-exit | 3.0.7 | ISC | https://github.com/tapjs/signal-exit |
| sisteransi | 1.0.5 | MIT | https://github.com/terkelg/sisteransi |
| slice-ansi | 2.1.0 | MIT | https://github.com/chalk/slice-ansi |
| source-map-support | 0.5.21 | MIT | https://github.com/evanw/node-source-map-support |
| source-map | 0.5.7 | BSD-3-Clause | https://github.com/mozilla/source-map |
| source-map | 0.6.1 | BSD-3-Clause | https://github.com/mozilla/source-map |
| stackframe | 1.3.4 | MIT | https://github.com/stacktracejs/stackframe |
| stacktrace-parser | 0.1.11 | MIT | https://github.com/errwischt/stacktrace-parser |
| statuses | 1.5.0 | MIT | https://github.com/jshttp/statuses |
| statuses | 2.0.2 | MIT | https://github.com/jshttp/statuses |
| string-width | 4.2.3 | MIT | https://github.com/sindresorhus/string-width |
| string_decoder | 1.3.0 | MIT | https://github.com/nodejs/string_decoder |
| strip-ansi | 5.2.0 | MIT | https://github.com/chalk/strip-ansi |
| strip-ansi | 6.0.1 | MIT | https://github.com/chalk/strip-ansi |
| strip-final-newline | 2.0.0 | MIT | https://github.com/sindresorhus/strip-final-newline |
| strnum | 2.5.1 | MIT | https://github.com/NaturalIntelligence/strnum |
| supports-color | 7.2.0 | MIT | https://github.com/chalk/supports-color |
| supports-color | 8.1.1 | MIT | https://github.com/chalk/supports-color |
| supports-preserve-symlinks-flag | 1.0.0 | MIT | https://github.com/inspect-js/node-supports-preserve-symlinks-flag |
| terser | 5.51.2 | BSD-2-Clause | https://github.com/terser/terser |
| throat | 5.0.0 | MIT | https://github.com/ForbesLindesay/throat |
| tinyglobby | 0.2.17 | MIT | https://github.com/SuperchupuDev/tinyglobby |
| to-regex-range | 5.0.1 | MIT | https://github.com/micromatch/to-regex-range |
| toidentifier | 1.0.1 | MIT | https://github.com/component/toidentifier |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) | https://github.com/sindresorhus/type-fest |
| type-is | 2.1.0 | MIT | https://github.com/jshttp/type-is |
| typescript | 6.0.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| undici-types | 8.9.0 | MIT | https://github.com/nodejs/undici |
| unicode-canonical-property-names-ecmascript | 2.0.1 | MIT | https://github.com/mathiasbynens/unicode-canonical-property-names-ecmascript |
| unicode-match-property-ecmascript | 2.0.0 | MIT | https://github.com/mathiasbynens/unicode-match-property-ecmascript |
| unicode-match-property-value-ecmascript | 2.2.1 | MIT | https://github.com/mathiasbynens/unicode-match-property-value-ecmascript |
| unicode-property-aliases-ecmascript | 2.2.0 | MIT | https://github.com/mathiasbynens/unicode-property-aliases-ecmascript |
| universalify | 0.1.2 | MIT | https://github.com/RyanZim/universalify |
| unpipe | 1.0.0 | MIT | https://github.com/stream-utils/unpipe |
| update-browserslist-db | 1.3.4 | MIT | https://github.com/browserslist/update-db |
| util-deprecate | 1.0.2 | MIT | https://github.com/TooTallNate/util-deprecate |
| utils-merge | 1.0.1 | MIT | https://github.com/jaredhanson/utils-merge |
| vary | 1.1.2 | MIT | https://github.com/jshttp/vary |
| vlq | 1.0.1 | MIT | https://github.com/Rich-Harris/vlq |
| wcwidth | 1.0.1 | MIT | https://github.com/timoxley/wcwidth |
| whatwg-fetch | 3.6.20 | MIT | https://github.com/github/fetch |
| which-module | 2.0.1 | ISC | https://github.com/nexdrew/which-module |
| which | 2.0.2 | ISC | https://github.com/isaacs/node-which |
| wrap-ansi | 6.2.0 | MIT | https://github.com/chalk/wrap-ansi |
| wrap-ansi | 7.0.0 | MIT | https://github.com/chalk/wrap-ansi |
| ws | 6.2.6 | MIT | https://github.com/websockets/ws |
| ws | 7.5.13 | MIT | https://github.com/websockets/ws |
| xml-naming | 0.3.0 | MIT | https://github.com/NaturalIntelligence/xml-naming |
| y18n | 4.0.3 | ISC | https://github.com/yargs/y18n |
| y18n | 5.0.8 | ISC | https://github.com/yargs/y18n |
| yallist | 3.1.1 | ISC | https://github.com/isaacs/yallist |
| yaml | 2.9.1 | ISC | https://github.com/eemeli/yaml |
| yargs-parser | 18.1.3 | ISC | https://github.com/yargs/yargs-parser |
| yargs-parser | 21.1.1 | ISC | https://github.com/yargs/yargs-parser |
| yargs | 15.4.1 | MIT | https://github.com/yargs/yargs |
| yargs | 17.7.3 | MIT | https://github.com/yargs/yargs |
| yocto-queue | 0.1.0 | MIT | https://github.com/sindresorhus/yocto-queue |
| zustand | 5.0.16 | MIT | https://github.com/pmndrs/zustand |

<!-- mobile-npm:end -->

## iOS dependencies

Versions come from `ios/Podfile.lock`; license declarations come from the
corresponding React Native 0.87.1 podspecs and upstream license files.
React Native's React, RCT, FBLazyVector, ReactCommon and generated bridge pods
are components of the same MIT-licensed React Native distribution.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| React Native and its React/RCT bridge pods | 0.87.1 | MIT | https://github.com/facebook/react-native |
| ReactNativeDependencies | 0.87.1 | MIT wrapper; component licenses below | https://github.com/facebook/react-native |
| Boost | 1.84.0 | BSL-1.0 | https://www.boost.org/LICENSE_1_0.txt |
| DoubleConversion | 1.1.6 | BSD-3-Clause | https://github.com/google/double-conversion/blob/v1.1.6/LICENSE |
| fast_float | 8.0.0 | MIT | https://github.com/fastfloat/fast_float |
| fmt | 12.1.0 | MIT | https://github.com/fmtlib/fmt |
| glog | 0.3.5 | BSD-3-Clause | https://github.com/google/glog |
| Hermes | 250829098.0.17 | MIT | https://github.com/facebook/hermes |
| RCT-Folly | 2024.11.18.00 | Apache-2.0 | https://github.com/facebook/folly |
| SocketRocket | 0.7.1 | BSD-3-Clause | https://github.com/facebookincubator/SocketRocket |
| Yoga | 0.0.0 pod version, React Native 0.87.1 source | MIT | https://github.com/facebook/yoga |

## Android runtime dependencies

The React Native Gradle plugin maps the app declarations to
`com.facebook.react:react-android:0.87.1` and
`com.facebook.hermes:hermes-android:250829098.0.17`.
Hermes is enabled; the optional JSC branch is not part of this inventory.

The table records 85 resolved runtime library components, including transitive
dependencies. Resolution used Gradle 9.4.1, the release/runtime Android JVM
attributes and the app's Kotlin 2.2.0 declaration; dependency constraints resolve
the Kotlin standard library to 2.2.10. The coroutines BOM is dependency metadata,
so it is omitted from the code attribution table. License names and links come
from the resolved upstream POMs; `javax.inject:1` has no POM license declaration,
so its Apache-2.0 attribution was verified in the published source JAR.
This metadata inventory does not claim a built or signed release artifact.

<!-- mobile-android:start -->

| Maven library | Resolved version | Upstream license |
| --- | --- | --- |
| androidx.activity:activity | 1.7.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.annotation:annotation-experimental | 1.4.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.annotation:annotation-jvm | 1.9.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.annotation:annotation | 1.9.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.appcompat:appcompat-resources | 1.7.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.appcompat:appcompat | 1.7.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.arch.core:core-common | 2.2.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.arch.core:core-runtime | 2.2.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.autofill:autofill | 1.3.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.collection:collection-jvm | 1.4.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.collection:collection | 1.4.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.concurrent:concurrent-futures | 1.1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.core:core-ktx | 1.13.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.core:core | 1.13.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.cursoradapter:cursoradapter | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.customview:customview | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.drawerlayout:drawerlayout | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.emoji2:emoji2-views-helper | 1.3.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.emoji2:emoji2 | 1.3.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.fragment:fragment | 1.5.4 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.interpolator:interpolator | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-common | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-livedata-core | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-livedata | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-process | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-runtime | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-viewmodel-savedstate | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.lifecycle:lifecycle-viewmodel | 2.6.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.loader:loader | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.profileinstaller:profileinstaller | 1.3.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.resourceinspection:resourceinspection-annotation | 1.0.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.savedstate:savedstate | 1.2.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.startup:startup-runtime | 1.1.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.swiperefreshlayout:swiperefreshlayout | 1.1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.tracing:tracing | 1.1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.vectordrawable:vectordrawable-animated | 1.1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.vectordrawable:vectordrawable | 1.1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.versionedparcelable:versionedparcelable | 1.1.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.viewpager:viewpager | 1.0.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.window:window-core-jvm | 1.5.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.window:window-core | 1.5.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| androidx.window:window | 1.5.1 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| com.facebook.fbjni:fbjni | 0.7.0 | [APACHE-2](https://github.com/facebookincubator/fbjni/blob/main/LICENSE) |
| com.facebook.fresco:drawee | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:fbcore | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:fresco | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:imagepipeline-base | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:imagepipeline-native | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:imagepipeline-okhttp3 | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:imagepipeline | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:memory-type-ashmem | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:memory-type-java | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:memory-type-native | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:middleware | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:nativeimagefilters | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:nativeimagetranscoder | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:soloader | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:ui-common | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:ui-core | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:urimod | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.fresco:vito-source | 3.7.0 | [MIT](https://github.com/facebook/fresco/blob/main/LICENSE) |
| com.facebook.hermes:hermes-android | 250829098.0.17 | [MIT License](https://github.com/facebook/hermes/blob/HEAD/LICENSE) |
| com.facebook.infer.annotation:infer-annotation | 0.18.0 | [MIT license](https://github.com/facebook/infer/blob/master/LICENSE) |
| com.facebook.react:react-android | 0.87.1 | [MIT License](https://github.com/facebook/react-native/blob/HEAD/LICENSE) |
| com.facebook.soloader:annotation | 0.12.1 | [Apache-2](https://github.com/facebook/soloader/blob/main/LICENSE) |
| com.facebook.soloader:nativeloader | 0.12.1 | [Apache-2](https://github.com/facebook/soloader/blob/main/LICENSE) |
| com.facebook.soloader:soloader | 0.12.1 | [Apache-2](https://github.com/facebook/soloader/blob/main/LICENSE) |
| com.facebook.yoga:proguard-annotations | 1.19.0 | [MIT License](https://github.com/facebook/yoga/blob/master/LICENSE) |
| com.google.code.findbugs:jsr305 | 3.0.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| com.google.guava:listenablefuture | 1.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| com.parse.bolts:bolts-tasks | 1.4.0 | [BSD License](https://github.com/BoltsFramework/Bolts-Android/blob/master/LICENSE) |
| com.squareup.okhttp3:okhttp-urlconnection | 4.9.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| com.squareup.okhttp3:okhttp | 4.9.2 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| com.squareup.okio:okio | 2.9.0 | [The Apache Software License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| javax.inject:javax.inject | 1 | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| org.jetbrains.kotlin:kotlin-annotations-jvm | 1.3.72 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlin:kotlin-stdlib-common | 2.2.10 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlin:kotlin-stdlib-jdk7 | 1.8.0 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlin:kotlin-stdlib-jdk8 | 1.8.0 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlin:kotlin-stdlib | 2.2.10 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlinx:kotlinx-coroutines-android | 1.8.1 | [The Apache Software License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm | 1.8.1 | [The Apache Software License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains.kotlinx:kotlinx-coroutines-core | 1.8.1 | [The Apache Software License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jetbrains:annotations | 23.0.0 | [The Apache Software License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| org.jspecify:jspecify | 1.0.0 | [The Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.txt) |

<!-- mobile-android:end -->

React Native's Android native sources also incorporate the following components,
whose versions are pinned by its native dependency catalog. Their licenses apply
in addition to the Maven wrapper's license.

| Native component | Android catalog version | License | Source |
| --- | --- | --- | --- |
| Boost | 1.83.0 | BSL-1.0 | https://www.boost.org/LICENSE_1_0.txt |
| DoubleConversion | 1.1.6 | BSD-3-Clause | https://github.com/google/double-conversion/blob/v1.1.6/LICENSE |
| fast_float | 8.0.0 | MIT | https://github.com/fastfloat/fast_float |
| fmt | 12.1.0 | MIT | https://github.com/fmtlib/fmt |
| Folly | 2024.11.18.00 | Apache-2.0 | https://github.com/facebook/folly |
| glog | 0.3.5 | BSD-3-Clause | https://github.com/google/glog |
| gflags | 2.2.0 | BSD-3-Clause | https://github.com/gflags/gflags |
| nlohmann/json | 3.11.2 | MIT | https://github.com/nlohmann/json |
| Yoga | React Native 0.87.1 source | MIT | https://github.com/facebook/yoga |


## Vendored native cryptography

`native/ConcordCrypto/Vendor/argon2/` includes the portable Argon2 reference
implementation and its BLAKE2 support, obtained from the `argon2@0.41.1` npm
tarball. It is dual-licensed under CC0-1.0 or Apache-2.0. The complete upstream
license is preserved at `native/ConcordCrypto/Vendor/argon2/LICENSE`, and source
hashes and provenance are recorded in the adjacent `Vendor/README.md`.
Apple CryptoKit and Security.framework are platform APIs, not vendored libraries.
