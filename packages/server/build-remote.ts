import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { validateRemoteServerBundle } from "./buildRemoteValidation.js";
import { loadBuiltinProviderConfig } from "../../scripts/builtin-provider-config.mjs";
import { stageThirdPartyNotices } from "../../scripts/third-party-notices.mjs";

const { version } = JSON.parse(readFileSync("../../package.json", "utf-8"));
const { content: zcodeBuiltinProviderConfigJson } = await loadBuiltinProviderConfig();

const buildResult = await build({
  entryPoints: ["src/entry-stdio.ts"],
  bundle: true,
  outfile: "dist/remote/zcode-server.cjs",
  platform: "node",
  format: "cjs",
  target: "node22",
  // CJS 环境没有 import.meta.url，通过 banner 注入等价变量，
  // 再用 define 全局替换，这样源码无需关心最终打包格式。
  banner: {
    js: 'var __import_meta_url = require("url").pathToFileURL(__filename).href; var __import_meta_dirname = __dirname;',
  },
  define: {
    "import.meta.url": "__import_meta_url",
    "import.meta.dirname": "__import_meta_dirname",
    __SOCIAL_HARNESS_VERSION__: JSON.stringify(version),
    __SOCIAL_HARNESS_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(zcodeBuiltinProviderConfigJson),
  },
  metafile: true,
});

const remoteBundleSource = readFileSync("dist/remote/zcode-server.cjs", "utf-8");
const bundledInputs = Object.keys(buildResult.metafile.inputs);
validateRemoteServerBundle({ bundledInputs, source: remoteBundleSource });
// 修复：remote 单文件 bundle 内联第三方代码，dist/remote 也必须附完整声明。
await stageThirdPartyNotices("dist/remote");

console.log("Built dist/remote/zcode-server.cjs");
