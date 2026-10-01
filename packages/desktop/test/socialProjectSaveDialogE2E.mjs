import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function verifyExportRetainedAfterSaveCancel(page, { dataRoot, exportPath, record }) {
  const originalBytes = await readFile(exportPath);
  const originalSha256 = createHash("sha256").update(originalBytes).digest("hex");
  assert.equal(originalSha256, record.job.sha256);
  await page.getByRole("button", { name: "Save MP4", exact: true }).click();
  const notice = page.getByText("Save cancelled. The completed export is still available.", {
    exact: true,
  });
  await notice.waitFor();
  assert.ok(!(await notice.innerText()).includes(exportPath));
  assert.ok(!(await page.locator("body").innerText()).includes(exportPath));
  assert.deepEqual(await readFile(exportPath), originalBytes);

  const exports = JSON.parse(await readFile(join(dataRoot, "exports.json"), "utf8"));
  const retained = exports.exports.find(
    (candidate) => candidate.job.exportId === record.job.exportId,
  );
  assert.equal(retained?.job.status, "completed");
  assert.equal(retained?.job.sha256, originalSha256);
  assert.equal(retained?.job.fileSizeBytes, originalBytes.byteLength);
}
