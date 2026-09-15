import type { MemoryStore } from "./store.js";
import type { ProfileConnection } from "./profile.js";
import { markConnectionSynced } from "./profile.js";
import { importFiles } from "./import/import-files.js";
import { importWeb } from "./import/web.js";
import { importYuque } from "./import/yuque.js";
import { importGitHub } from "./import/github.js";
import type { SyncJobRecord } from "./types.js";

export async function runSyncJob(store: MemoryStore, space: string, connection: ProfileConnection, job: SyncJobRecord): Promise<SyncJobRecord> {
  store.updateSyncJob(job.id, { state: "running", error: null });
  try {
    const shared = {
      purpose: connection.purpose,
      authorship: connection.authorship,
      contentScope: connection.contentScope,
      connectionId: connection.id,
      onProgress: (progress: { completed: number; total: number | null; imported: number; unchanged: number; skipped: number }) => {
        store.updateSyncJob(job.id, { state: "running", ...progress });
      },
    };
    const result = connection.kind === "local"
      ? await importFiles(store, connection.input, shared)
      : connection.kind === "yuque"
        ? await importYuque(store, connection.input, shared)
        : connection.kind === "github"
          ? await importGitHub(store, connection.input, shared)
          : await importWeb(store, connection.input, { ...shared, scope: connection.scope });
    const imported = result.imported.filter((item) => item.sourceCreated || item.objectCreated).length;
    const unchanged = "unchanged" in result && typeof result.unchanged === "number"
      ? result.unchanged
      : result.imported.filter((item) => !item.sourceCreated && !item.objectCreated).length;
    const completed = result.imported.length + result.skipped.length;
    await markConnectionSynced(space, connection.id);
    return store.updateSyncJob(job.id, {
      state: "completed",
      completed,
      total: completed,
      imported,
      unchanged,
      skipped: result.skipped.length,
      error: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return store.updateSyncJob(job.id, { state: "failed", error: message });
  }
}
