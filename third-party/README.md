# Third-party materials and release checks

`inventory.json` is the source of truth for pinned third-party components,
runtime tools, notice hashes, and materials that still require review. The
inventory scope is not a per-installer SBOM or a legal certification.

## Local checks

Run these commands from the repository root:

```sh
node scripts/licenses.mjs notices
node scripts/licenses.mjs check
node scripts/licenses.mjs check --strict
```

The Desktop validation workflow also runs
`node --test scripts/third-party-review-scope.test.mjs` to pin the rules that
keep application dependencies in the release gate and development-only tools
outside it.

`notices` regenerates `THIRD-PARTY-NOTICES.md` and refreshes the inventory's
input and notice hashes. Review both generated files before accepting the
change. The regular `check` validates installed package license identifiers
and verifies that notices and recorded inputs are current. It does not mean
all source, build, or distribution obligations are complete.

The strict check also requires `reviewRequired` in `inventory.json` to be
empty. Each entry must be closed with version-specific source evidence,
license materials, and build provenance as applicable; do not remove an entry
only to make the check pass. Current open items include FFmpeg corresponding
source and reproducible build materials, platform-specific native dependency
provenance, original notices for several pinned packages and skills, and
complete provenance for the Rust standard library component. Consult the
`reviewRequired` array for the exact item list and rationale.

An npm override that is present only in the workspace development dependency
graph remains recorded in `developmentReviewRequired` with its unresolved
notice evidence, but does not block the production release check or appear as
an npm package in the production notice list. Build-time assets copied into the
application remain listed separately under `copied`, with source hashes and
their applicable notices. Copied components default to the application release
scope. A `distributionScope: "development-only"` record is allowed only for
files that remain in `.agents/skills/` and are outside the Desktop package's
file list; its unresolved material appears in `developmentReviewRequired`, not
the application release gate. Internal diagnostic packages that are not
dependencies of a shipped app or Agent artifact must also declare their
runtime packages as development dependencies; ordinary developer installs
still provide them when the diagnostic tool is run. Keep these source and
review records in the inventory. The generator determines npm scope from the
workspace dependency graph; do not manually relabel or delete an unresolved
record to make strict mode pass. If a package later enters the production
graph, its record moves back into `reviewRequired` automatically.

## Release gate

Before publishing an installer, verify the exact native components included
for each target platform. Include the matching notices and, where required,
corresponding source and reproducible build materials. In particular, the
bundled GPL FFmpeg builds require their matching source/build materials; a
license notice alone does not close that obligation. Re-run the strict check
after all evidence and generated notices are updated, and retain platform
package smoke results with the release record.

Runtime license inputs and archive inspection evidence are recorded in
`runtime/sources.json`. Target-specific release URLs, source revisions, archive
hashes and staged asset hashes are pinned in
`scripts/social-media-tools-config.mjs` and each staged runtime's `SOURCES.json`.
Copied source mappings are recorded in `copied-components.json`; native
dependency and notice evidence is in `embedded-components.json` and
`inventory.json`.

Each staged FFmpeg `SOURCES.json` records the FFmpeg source commit separately
from the provider's build-script source archive and hash. The BtbN build-script
revision is the immutable commit behind its pinned release tag. The Martin
Riedl build-script revision is recorded as a candidate because the build-server
asset does not attest that revision; this remains an open release review. These
manifests improve traceability but do not replace the complete corresponding
source bundle, exact per-platform dependency provenance, or license aggregate.

On 2026-09-30, all eight pinned FFmpeg/ffprobe archives were downloaded and
matched against their configured byte sizes and SHA-256 values. The four BtbN
Linux and Windows archives contain 238 or 256 entries and only one
license-named path, `LICENSE.txt`; its SHA-256 matches the pinned FFmpeg GPLv3
text. The four Martin Riedl macOS archives each contain only the corresponding
`ffmpeg` or `ffprobe` executable, with no license or source path. Per-asset
hashes, entry counts, paths and license hashes are recorded in
`runtime/sources.json`. This inspection confirms that the archives do not
provide a separate license aggregate for linked third-party libraries. The
complete corresponding-source bundle, reproducible build materials, exact
per-platform linked-library provenance, and Riedl build-script attestation
remain release requirements.

The Rust source paths embedded in the pinned ripgrep binaries identify three
toolchain revisions. The Linux and macOS `14.1.1-1` assets contain upstream
revision `6b00bc3880198600130e1cf62b8f8a93494488cc` (Rust 1.88.0); its MIT,
Apache-2.0 and COPYRIGHT snapshots are retained in the native inventory. The
remote macOS `13.0.0-10` assets contain `fc594f15669680fa70d255faec3ca3fb507c3405`
(Rust 1.67.0), also with matching upstream snapshots. Both archive checksum
sets match the pinned entries in `native-search/sources.json`.

The Windows `14.1.1-1` x64 and arm64 assets instead embed
`6a6eaca656978778f7c1c750ee0c3db87f8bffb2` and identify Microsoft's
`rust.tools-x86_64-pc-windows-msvc.1.88.0-ms-20250913.5` toolchain. The public
`microsoft/ripgrep-prebuilt` build recipe pins that Windows toolchain, but its
RustTools package feed requires authentication and the embedded revision is
not available from the public `rust-lang/rust` repository. On 2026-10-01, the
exact revision returned HTTP 404 from public `rust-lang/rust`, and an
unauthenticated GET to the feed index returned HTTP 401. Keep this review item
open until the exact Microsoft toolchain's original license materials are
verified; do not substitute the upstream 1.88.0 snapshot without confirming
that it covers the Microsoft toolchain's notice text.

On 2026-09-30, the `quickjs-wasi@2.2.0` registry archive was verified against
its published SRI and SHA-256. Its exact Git tag and QuickJS-NG submodule were
checked out with the recorded commits. The official WASI SDK 32.0 Linux x64
release asset matched GitHub's published size and SHA-256; its source tree pins
the WASI libc and LLVM runtime commits whose notices are retained in the
inventory. An unmodified build reproduced the package's `quickjs.wasm` and all
six extension `.so` files byte-for-byte. The artifact hashes and build inputs
are recorded in `upstream/quickjs-wasi-2.2.0-reproduction.json`, closing the
embedded QuickJS/WASI link-provenance review. The separate npm package notice
review stays open because its published archive does not supply a complete
original MIT copyright and license notice.

Also on 2026-09-30, the exact npm archives for twelve packages with open notice
reviews were inspected by SRI and file inventory. None contains a path named
`LICENSE`, `LICENCE`, `COPYING`, or `NOTICE`; the package-level notice reviews
remain open until complete original publisher notices are obtained. The
integrities and archive entry counts are recorded in
`upstream/npm-package-notice-scan-2026-09-30.json`. This negative archive scan
does not establish that README files lack license references and is not itself
a license notice.

On 2026-10-01, a follow-up content inspection re-downloaded each exact archive,
verified its SHA-512 SRI against npm's version metadata, and inspected its
README and package manifest. The README sections for `react-remove-scroll-bar@2.3.8`,
`@hono/node-ws@1.3.0`, and `strict-event-emitter@0.5.1` state only `MIT`;
`quickjs-wasi@2.2.0` only identifies QuickJS-NG as MIT-licensed. None of the
twelve exact package archives supplies a complete original package-level
copyright/license notice in its README or manifest. Keep all twelve strict
reviews open and do not invent copyright lines; the exact findings are recorded
in `upstream/npm-package-notice-scan-2026-09-30.json`.

An additional 2026-10-01 source-repository inspection checked immutable npm
`gitHead` commits or exact release tags where the package metadata identified
them. It found no complete publisher notice for any of the twelve packages;
some exact commits were unavailable in the declared public repository, and
three `@arms/rum-*` packages have no repository URL in npm metadata. This is
negative attribution evidence, not a replacement notice. All twelve package
reviews remain open until complete original publisher materials are available.
The recursive source trees for the exact Hono middleware, strict-event-emitter,
and deferred-promise commits were also checked and contain no license-named
path; these additional checks are recorded in the scan JSON.

On 2026-10-03, publisher history inspection found the original `boolbase`
ISC notice in immutable merge revision
`b566b40fabb9310c9e1e8bd5719afb6eece98425`, whose manifest still declares
`boolbase@1.0.0`. A fresh download of the exact npm archive matched its registry
SHA-512 SRI and the earlier recorded SHA-256. The shipped `index.js` and
`README.md` match this source revision byte-for-byte. The manifest differs only
in its development test script; identity, runtime entry point, dependencies,
author and license are unchanged. The complete publisher copyright/permission
notice is retained with its immutable URL and hash. Exact comparisons and both
manifest hashes are recorded in
`upstream/boolbase-1.0.0-source-notice-evidence.json`. This closes only the
`boolbase@1.0.0` notice review and supersedes the earlier negative tag-only
attribution finding for this package. The other records remain open. See
`specs/social-harness-release-materials.md` for the verification boundary.

The same follow-up established a notice attribution chain for
`react-remove-scroll-bar@2.3.8` without recovering its unavailable `gitHead`.
Both 2.3.7 and 2.3.8 archives match their registry SHA-512 SRI. All 26 shipped
non-manifest files are byte-identical, including every compiled code file,
type declaration and README. Their manifests differ only in version and the
`react-style-singleton` minimum range (`^2.2.1` to `^2.2.2`); that dependency's
actual installed version and its separate notice are unchanged. The resolvable
2.3.7 `gitHead` is the parent of the publisher's accepted license addition;
comparison with merge `8ca9ba5ea52de03308fe8ced94f7b159a44d28ff` reports only
the original `LICENSE` file. Its complete MIT copyright/permission text is
retained verbatim. Archive/file hashes, manifest differences and the immutable
source comparison are recorded in
`upstream/react-remove-scroll-bar-2.3.8-source-notice-evidence.json`. This closes
the notice review for the proven unchanged shipped software; it does not
claim that the missing 2.3.8 release commit was recovered or that unrelated
release obligations are complete.

The 2026-10-03 publisher follow-up also found Hono's original repository MIT
notice, added by merge `a8e2af4d857aa7fabf290cdf6f67307678e50409` on
2026-09-29. Maintainer Yusuke Wada supplied that notice in response to issue
2157, which identifies `@hono/node-ws@1.3.0` and its exact published `gitHead`.
Fresh 1.3.0 and 1.3.1 npm archives match their registry SRIs. All seven compiled
implementation, declaration and source-map files are byte-identical. Both
implementation sources embedded in the published 1.3.0 JavaScript source map
also match the original `gitHead` and the licensed publisher revision exactly.
Their README, changelog and manifest differ; the manifest differences concern
version, development scripts/dependencies and peer ranges, and are retained
explicitly. No package upgrade was performed. The complete original notice,
immutable URLs and archive/source comparisons are retained in
`upstream/hono-node-ws-1.3.0-source-notice-evidence.json`. This closes that
notice review through the unchanged implementation and publisher's resolution
of the exact-version request, superseding the earlier negative tree scan.

QuickJS-WASI added its wrapper's original MIT notice in publisher merge
`066475d399936cd40a38cabde6935d5f7b080dec`. The maintainer confirmation on
PR 51 covers version 3.6.0 at `54c4d2dd4be2445409aeab603ecfc3bb209c7310`.
It does not identify the shipped 2.2.0 wrapper, whose implementation, native
sources and QuickJS-NG revision differ. The candidate notice and this boundary
are retained in `upstream/quickjs-wasi-2.2.0-candidate-notice-evidence.json`.
The 2.2.0 review remains open; a notice supplied for a changed version is not
silently treated as version-specific evidence for the installed package.
