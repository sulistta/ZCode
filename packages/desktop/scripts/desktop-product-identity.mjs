/**
 * 构建期开关：为真时安装包使用 Preview 身份，而后端环境仍由 `SOCIAL_HARNESS_ENV` 单独决定。
 * 典型用法是 `SOCIAL_HARNESS_ENV=production SOCIAL_HARNESS_PREVIEW_IDENTITY=1`，得到一个连接生产后端、
 * 可与正式版并排安装的 `Social Harness Preview`。
 */
export const SOCIAL_HARNESS_PREVIEW_IDENTITY_ENV = "SOCIAL_HARNESS_PREVIEW_IDENTITY";

const PRODUCTION_IDENTITY = Object.freeze({
  flavor: "production",
  appId: "dev.socialharness.app",
  productName: "Social Harness",
  linuxExecutableName: "social-harness",
  linuxPackageName: "social-harness",
  cuaHelperInstallVariant: null,
});

const PREVIEW_IDENTITY = Object.freeze({
  flavor: "preview",
  appId: "dev.socialharness.app.preview",
  productName: "Social Harness Preview",
  linuxExecutableName: "social-harness-preview",
  linuxPackageName: "social-harness-preview",
  cuaHelperInstallVariant: "preview",
});

export const desktopProductIdentities = Object.freeze({
  production: PRODUCTION_IDENTITY,
  preview: PREVIEW_IDENTITY,
});

function normalizeDesktopSocialHarnessEnv(env) {
  return env.SOCIAL_HARNESS_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
}

/**
 * 开关只有一种开启拼写 `1`（`0` / 空 = 关闭），与 CI workflow 规则和 release 门的
 * `$SOCIAL_HARNESS_PREVIEW_IDENTITY == "1"` 精确比较保持同一套语义。其它拼写在构建期直接失败，
 * 避免 `true` 之类在 YAML 路由层漏匹配、却在脚本层被当成开启，把 Preview 包打进生产验收目录。
 */
export function isPreviewIdentityRequested(env = process.env) {
  const value = env[SOCIAL_HARNESS_PREVIEW_IDENTITY_ENV]?.trim() ?? "";
  if (value === "1") {
    return true;
  }
  if (value === "" || value === "0") {
    return false;
  }
  throw new Error(
    `invalid ${SOCIAL_HARNESS_PREVIEW_IDENTITY_ENV}=${env[SOCIAL_HARNESS_PREVIEW_IDENTITY_ENV]}; expected 1 or 0`,
  );
}

/**
 * 产品身份（flavor）与后端环境（`SOCIAL_HARNESS_ENV`）是两个轴：
 * - `SOCIAL_HARNESS_ENV=test` 一律是 Preview，测试后端不能顶着正式 Social Harness 身份覆盖用户的正式安装；
 * - `SOCIAL_HARNESS_ENV=production` 默认是正式身份，显式 `SOCIAL_HARNESS_PREVIEW_IDENTITY=1` 时改用 Preview 身份。
 * 未知 `SOCIAL_HARNESS_ENV` 继续按 test 处理，保持 fail-safe 默认值。
 */
export function resolveDesktopProductFlavor(env = process.env) {
  if (isPreviewIdentityRequested(env)) {
    return "preview";
  }
  return normalizeDesktopSocialHarnessEnv(env) === "production" ? "production" : "preview";
}

export function resolveDesktopProductIdentity(env = process.env) {
  return desktopProductIdentities[resolveDesktopProductFlavor(env)];
}

/**
 * Resolve the public Instagram bridge origin embedded in a Desktop build.
 * Legacy config validator retained for migration tests. Desktop builds no longer embed this origin;
 * each user provisions their Convex project in the app.
 */
export function resolveDesktopInstagramAuthBridgeUrl(value, { productFlavor }) {
  if (productFlavor !== "production" && productFlavor !== "preview") {
    throw new Error(
      `Unsupported desktop product flavor for Instagram bridge config: ${productFlavor}`,
    );
  }

  const bridgeUrl = typeof value === "string" ? value.trim() : "";
  if (!bridgeUrl) {
    return "";
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(bridgeUrl);
  } catch {
    parsedUrl = null;
  }

  if (
    !parsedUrl ||
    parsedUrl.protocol !== "https:" ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error(
      "SOCIAL_HARNESS_INSTAGRAM_AUTH_BRIDGE_URL must be a public HTTPS origin without credentials, path, query, or fragment",
    );
  }

  return parsedUrl.origin;
}

/**
 * Build metadata shipped in desktop installers. The maintainer contact is a release input so a
 * renamed product cannot silently keep publishing the retired ZCode address.
 */
export function resolveDesktopReleaseMetadata(env = process.env) {
  const email = env.SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL?.trim();
  const emailDomain = email?.split("@").at(-1)?.toLowerCase();
  if (
    !email ||
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email) ||
    emailDomain === "zcode.z.ai" ||
    emailDomain?.endsWith(".zcode.z.ai")
  ) {
    throw new Error(
      "SOCIAL_HARNESS_PACKAGE_MAINTAINER_EMAIL must be a valid non-ZCode contact email when packaging a desktop installer",
    );
  }

  const homepageValue = env.SOCIAL_HARNESS_PACKAGE_HOMEPAGE?.trim();
  let homepageUrl;
  try {
    homepageUrl = new URL(homepageValue ?? "");
  } catch {
    homepageUrl = null;
  }
  if (
    !homepageUrl ||
    homepageUrl.protocol !== "https:" ||
    !homepageUrl.hostname ||
    homepageUrl.username ||
    homepageUrl.password
  ) {
    throw new Error(
      "SOCIAL_HARNESS_PACKAGE_HOMEPAGE must be set to an approved HTTPS URL without credentials when packaging a desktop installer",
    );
  }

  const identity = resolveDesktopProductIdentity(env);
  return Object.freeze({
    extraMetadata: Object.freeze({
      socialHarnessProductFlavor: identity.flavor,
      desktopName: identity.productName,
      homepage: homepageUrl.toString(),
      author: Object.freeze({ name: identity.productName, email }),
    }),
    linux: Object.freeze({
      maintainer: `${identity.productName} Maintainers <${email}>`,
      vendor: identity.productName,
      syncDesktopName: true,
    }),
  });
}

/**
 * 产物文件名后缀标记的是后端环境而不是身份：`_TEST` 只出现在测试后端的安装包上。
 * 生产后端的 Preview 包靠 productName 与正式包区分。
 */
export function resolveDesktopArtifactSuffix(env = process.env) {
  return normalizeDesktopSocialHarnessEnv(env) === "test" ? "_TEST" : "";
}

/**
 * 返回 Windows Shell 使用的 AppUserModelId。
 *
 * 打包态必须复用 electron-builder 的 appId，否则快捷方式里的 AUMID、开始菜单索引
 * 和运行中的 Electron 进程会被 Windows 视为三个不同的应用。开发态继续保留旧身份，
 * 避免本地调试快捷方式和正式/Preview 安装包互相污染。
 */
export function resolveWindowsAppUserModelIdForFlavor(flavor, runtime = { isPackaged: true }) {
  if (runtime.isPackaged === false) {
    return "dev.socialharness.app.local";
  }
  return desktopProductIdentities[flavor === "preview" ? "preview" : "production"].appId;
}

export function resolveWindowsAppUserModelId(env = process.env, runtime = { isPackaged: true }) {
  return resolveWindowsAppUserModelIdForFlavor(resolveDesktopProductFlavor(env), runtime);
}
