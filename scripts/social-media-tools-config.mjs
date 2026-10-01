const YT_DLP_VERSION = "2026.08.19";
const YT_DLP_RELEASE_BASE_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}`;
const WHISPER_CPP_VERSION = "1.9.4";
const WHISPER_CPP_COMMIT = "927cfce34f31707e17f2bff35c349632fb9e2c3a";
const WHISPER_CPP_SOURCE_URL = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_CPP_VERSION}.tar.gz`;
const WHISPER_CPP_SOURCE_SIZE_BYTES = 9_353_438;
const WHISPER_CPP_SOURCE_SHA256 =
  "57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae";
const FFMPEG_VERSION = "9.0.1";
const FFMPEG_BUILDS_RELEASE_TAG = "autobuild-2026-09-18-13-22";
const FFMPEG_BUILDS_RELEASE_BASE_URL = `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_BUILDS_RELEASE_TAG}`;
const FFMPEG_SOURCE_COMMIT = "946fcce07b6dcd0331c8cc609192aeff5e1924f8";
const FFMPEG_BUILDS_ASSET_PREFIX = "ffmpeg-n9.0.1-84-g946fcce07b";
const BTBN_BUILD_SCRIPT_COMMIT = "3e6685eda92f9288c15ac320139622dcedca09a4";
const BTBN_BUILD_SCRIPT_SOURCE = Object.freeze({
  repositoryUrl: "https://github.com/BtbN/FFmpeg-Builds",
  revision: BTBN_BUILD_SCRIPT_COMMIT,
  revisionUrl: `https://github.com/BtbN/FFmpeg-Builds/tree/${BTBN_BUILD_SCRIPT_COMMIT}`,
  sourceArchiveUrl: `https://api.github.com/repos/BtbN/FFmpeg-Builds/tarball/${BTBN_BUILD_SCRIPT_COMMIT}`,
  sourceArchiveSizeBytes: 105_476,
  sourceArchiveSha256: "a05689f190baf57175987e9a86fae15a89dadcd41b4af576c87133eb87e6c2fe",
  revisionStatus: "release-tagged",
});
const RIEDL_BUILD_SCRIPT_COMMIT = "f63b8aab8f5ce1a067da86ba69e34a36a7e217e5";
const RIEDL_BUILD_SCRIPT_SOURCE = Object.freeze({
  repositoryUrl: "https://git.martin-riedl.de/ffmpeg/build-script",
  revision: RIEDL_BUILD_SCRIPT_COMMIT,
  revisionUrl: `https://git.martin-riedl.de/ffmpeg/build-script/commit/${RIEDL_BUILD_SCRIPT_COMMIT}`,
  sourceArchiveUrl: `https://git.martin-riedl.de/ffmpeg/build-script/archive/${RIEDL_BUILD_SCRIPT_COMMIT}.tar.gz`,
  sourceArchiveSizeBytes: 2_610_315,
  sourceArchiveSha256: "025ae571e47d09bc7fe74fceae7f7b0b3b73bf304849133e24d5c4581e592473",
  // The upstream build server does not attest the script revision for this asset.
  revisionStatus: "candidate-unverified",
});
const FFMPEG_BUILDS_WINDOWS_ASSETS = Object.freeze({
  "win32-x64": Object.freeze({
    assetName: `${FFMPEG_BUILDS_ASSET_PREFIX}-win64-gpl-shared-9.0.zip`,
    sizeBytes: 85_729_307,
    sha256: "fffbf66963fbcf061eb83ab1b3fef61feedfd260628855c1020d14b7d273b9f9",
  }),
  "win32-arm64": Object.freeze({
    assetName: `${FFMPEG_BUILDS_ASSET_PREFIX}-winarm64-gpl-shared-9.0.zip`,
    sizeBytes: 59_920_858,
    sha256: "e93ef2c7e47ca4145148400ad2df09a30c85d743dd1bc11fab540569d8b12a9c",
  }),
});
const FFMPEG_BUILDS_LINUX_ASSETS = Object.freeze({
  "linux-x64": Object.freeze({
    assetName: `${FFMPEG_BUILDS_ASSET_PREFIX}-linux64-gpl-shared-9.0.tar.xz`,
    sizeBytes: 68_332_020,
    sha256: "87b5e8e0f0fac63b41bda52f862e2649dde98ec31f1831b3ec974e68374a36dc",
    archiveRoot: `${FFMPEG_BUILDS_ASSET_PREFIX}-linux64-gpl-shared-9.0`,
  }),
  "linux-arm64": Object.freeze({
    assetName: `${FFMPEG_BUILDS_ASSET_PREFIX}-linuxarm64-gpl-shared-9.0.tar.xz`,
    sizeBytes: 57_378_344,
    sha256: "63c8f9d27ac0d69225731dc247dc6d68c5b32101f8bb872f83433513e6acf246",
    archiveRoot: `${FFMPEG_BUILDS_ASSET_PREFIX}-linuxarm64-gpl-shared-9.0`,
  }),
});
const FFMPEG_RIEDL_RELEASES = Object.freeze({
  "darwin-x64": Object.freeze({
    releaseUrl: "https://ffmpeg.martin-riedl.de/info/detail/macos/amd64/1787081194_9.0.1",
    ffmpegAssetId: "1787081194_9.0.1",
    ffmpegSha256: "5bdead62ff504ab9b447cc72b212c4fb481e3f7de5877d427a51bee8136dda40",
    ffmpegSizeBytes: 33_847_553,
    ffprobeSha256: "34511bbcf1988ad2886023bf5ace4f44cf62e6defeb3d194d6f7619e5b061f7f",
    ffprobeSizeBytes: 33_750_750,
  }),
  "darwin-arm64": Object.freeze({
    releaseUrl: "https://ffmpeg.martin-riedl.de/info/detail/macos/arm64/1787073674_9.0.1",
    ffmpegAssetId: "1787073674_9.0.1",
    ffmpegSha256: "8287a1b2229e05eb41859f073e18e6c52c60a778f2f5e6881070fe51b79407fe",
    ffmpegSizeBytes: 28_447_413,
    ffprobeSha256: "102a26b8940a053298d9929bfaae71e4b6ef65ba5f19a99a88c433108560741a",
    ffprobeSizeBytes: 28_370_930,
  }),
});

const YT_DLP_ASSETS = Object.freeze({
  "darwin-arm64": Object.freeze({
    assetName: "yt-dlp_macos",
    binaryName: "yt-dlp",
    sizeBytes: 37_146_048,
    sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  }),
  "darwin-x64": Object.freeze({
    assetName: "yt-dlp_macos",
    binaryName: "yt-dlp",
    sizeBytes: 37_146_048,
    sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  }),
  "linux-arm64": Object.freeze({
    assetName: "yt-dlp_linux_aarch64",
    binaryName: "yt-dlp",
    sizeBytes: 40_167_537,
    sha256: "b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc",
  }),
  "linux-x64": Object.freeze({
    assetName: "yt-dlp_linux",
    binaryName: "yt-dlp",
    sizeBytes: 40_446_224,
    sha256: "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
  }),
  "win32-arm64": Object.freeze({
    assetName: "yt-dlp_arm64.exe",
    binaryName: "yt-dlp.exe",
    sizeBytes: 21_159_286,
    sha256: "05b438997bafc3affdfda9d041353c9d73e04dc842207254b655b0887c4445b0",
  }),
  "win32-x64": Object.freeze({
    assetName: "yt-dlp.exe",
    binaryName: "yt-dlp.exe",
    sizeBytes: 17_840_399,
    sha256: "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
  }),
});

export function normalizeSocialMediaToolPlatform(platform) {
  const value = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (["mac", "macos", "darwin", "osx"].includes(value)) return "darwin";
  if (["win", "windows", "win32"].includes(value)) return "win32";
  if (value === "linux") return "linux";
  throw new Error(`Unsupported social media tool platform: ${platform}`);
}

export function normalizeSocialMediaToolArch(arch) {
  const value = String(arch ?? "")
    .trim()
    .toLowerCase();
  if (["x64", "amd64", "x86_64"].includes(value)) return "x64";
  if (["arm64", "aarch64"].includes(value)) return "arm64";
  throw new Error(`Unsupported social media tool architecture: ${arch}`);
}

export function resolveYtDlpReleasePlan({ platform, arch }) {
  const normalizedPlatform = normalizeSocialMediaToolPlatform(platform);
  const normalizedArch = normalizeSocialMediaToolArch(arch);
  const platformKey = `${normalizedPlatform}-${normalizedArch}`;
  const asset = YT_DLP_ASSETS[platformKey];
  if (!asset) throw new Error(`No pinned yt-dlp release asset for ${platformKey}`);
  return Object.freeze({
    platform: normalizedPlatform,
    arch: normalizedArch,
    platformKey,
    version: YT_DLP_VERSION,
    assetName: asset.assetName,
    binaryName: asset.binaryName,
    sizeBytes: asset.sizeBytes,
    sha256: asset.sha256,
    sourceUrl: `${YT_DLP_RELEASE_BASE_URL}/${asset.assetName}`,
  });
}

export function resolveWhisperCppBuildPlan({ platform, arch }) {
  const normalizedPlatform = normalizeSocialMediaToolPlatform(platform);
  const normalizedArch = normalizeSocialMediaToolArch(arch);
  return Object.freeze({
    platform: normalizedPlatform,
    arch: normalizedArch,
    platformKey: `${normalizedPlatform}-${normalizedArch}`,
    version: WHISPER_CPP_VERSION,
    commit: WHISPER_CPP_COMMIT,
    sourceUrl: WHISPER_CPP_SOURCE_URL,
    sourceSizeBytes: WHISPER_CPP_SOURCE_SIZE_BYTES,
    sourceSha256: WHISPER_CPP_SOURCE_SHA256,
    binaryName: normalizedPlatform === "win32" ? "whisper-cli.exe" : "whisper-cli",
  });
}

export function resolveFfmpegReleasePlan({ platform, arch }) {
  const normalizedPlatform = normalizeSocialMediaToolPlatform(platform);
  const normalizedArch = normalizeSocialMediaToolArch(arch);
  const platformKey = `${normalizedPlatform}-${normalizedArch}`;
  const windowsAsset = FFMPEG_BUILDS_WINDOWS_ASSETS[platformKey];
  if (windowsAsset) {
    return Object.freeze({
      platform: normalizedPlatform,
      arch: normalizedArch,
      platformKey,
      version: FFMPEG_VERSION,
      provider: "BtbN FFmpeg-Builds",
      providerReleaseUrl: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${FFMPEG_BUILDS_RELEASE_TAG}`,
      ffmpegSourceCommit: FFMPEG_SOURCE_COMMIT,
      buildScriptSource: BTBN_BUILD_SCRIPT_SOURCE,
      variant: "gpl-shared",
      expectedVersionPrefix: "ffmpeg version n9.0.1-84-g946fcce07b",
      archiveFormat: "zip",
      archiveRoot: FFMPEG_BUILDS_ASSET_PREFIX,
      assets: [
        {
          name: windowsAsset.assetName,
          url: `${FFMPEG_BUILDS_RELEASE_BASE_URL}/${windowsAsset.assetName}`,
          sizeBytes: windowsAsset.sizeBytes,
          sha256: windowsAsset.sha256,
        },
      ],
    });
  }

  const linuxAsset = FFMPEG_BUILDS_LINUX_ASSETS[platformKey];
  if (linuxAsset) {
    return Object.freeze({
      platform: normalizedPlatform,
      arch: normalizedArch,
      platformKey,
      version: FFMPEG_VERSION,
      provider: "BtbN FFmpeg-Builds",
      providerReleaseUrl: `https://github.com/BtbN/FFmpeg-Builds/releases/tag/${FFMPEG_BUILDS_RELEASE_TAG}`,
      ffmpegSourceCommit: FFMPEG_SOURCE_COMMIT,
      buildScriptSource: BTBN_BUILD_SCRIPT_SOURCE,
      variant: "gpl-shared",
      expectedVersionPrefix: "ffmpeg version n9.0.1-84-g946fcce07b",
      archiveFormat: "tar.xz",
      archiveRoot: linuxAsset.archiveRoot,
      assets: [
        {
          name: linuxAsset.assetName,
          url: `${FFMPEG_BUILDS_RELEASE_BASE_URL}/${linuxAsset.assetName}`,
          sizeBytes: linuxAsset.sizeBytes,
          sha256: linuxAsset.sha256,
        },
      ],
    });
  }

  const riedlRelease = FFMPEG_RIEDL_RELEASES[platformKey];
  if (riedlRelease) {
    const baseUrl = `https://ffmpeg.martin-riedl.de/download/macos/${normalizedArch === "x64" ? "amd64" : "arm64"}/${riedlRelease.ffmpegAssetId}`;
    return Object.freeze({
      platform: normalizedPlatform,
      arch: normalizedArch,
      platformKey,
      version: FFMPEG_VERSION,
      provider: "Martin Riedl FFmpeg Build Server",
      providerReleaseUrl: riedlRelease.releaseUrl,
      ffmpegSourceCommit: "bf1b838f2ab88b4f8fd83443325c782ea0e0f7fa",
      buildScriptSource: RIEDL_BUILD_SCRIPT_SOURCE,
      variant: "gpl-static",
      expectedVersionPrefix: "ffmpeg version 9.0.1-https://www.martin-riedl.de",
      archiveFormat: "zip",
      archiveRoot: null,
      assets: [
        {
          name: "ffmpeg.zip",
          url: `${baseUrl}/ffmpeg.zip`,
          sizeBytes: riedlRelease.ffmpegSizeBytes,
          sha256: riedlRelease.ffmpegSha256,
          binaryName: "ffmpeg",
        },
        {
          name: "ffprobe.zip",
          url: `${baseUrl}/ffprobe.zip`,
          sizeBytes: riedlRelease.ffprobeSizeBytes,
          sha256: riedlRelease.ffprobeSha256,
          binaryName: "ffprobe",
        },
      ],
    });
  }

  throw new Error(`No pinned FFmpeg release assets for ${platformKey}`);
}
