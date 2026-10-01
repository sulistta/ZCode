import { readVerifiedNotices } from "../../../scripts/third-party-notices.mjs";

export async function enforceProductionReleaseMaterialGate(productFlavor, root) {
  if (productFlavor === "preview") return;
  if (productFlavor !== "production") {
    throw new Error(
      `Unsupported desktop product flavor for release materials gate: ${productFlavor}`,
    );
  }

  // 生产安装包不得越过仍有未解决材料义务的三方清单。
  await readVerifiedNotices(root, { requireComplete: true });
}
