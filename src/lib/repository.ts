import { db } from "../db";
import type {
  ArtifactRecord,
  DatasetDraft,
  Slot,
  TaskRecord,
  TemplateRecord,
  TemplateVersionRecord,
} from "../types";
import { makeId } from "./id";
import { toIsoNow } from "./time";

export async function getLatestTemplateVersion(templateId: string) {
  const versions = await db.templateVersions.where("templateId").equals(templateId).sortBy("version");
  return versions.at(-1) ?? null;
}

export async function saveTemplateVersion(input: {
  templateId?: string;
  name: string;
  sourceDocxBlob: Blob;
  sourceDocxName: string;
  slots: Slot[];
}) {
  const now = toIsoNow();

  return db.transaction("rw", db.templates, db.templateVersions, async () => {
    let templateId = input.templateId;
    let currentVersion = 0;

    if (!templateId) {
      templateId = makeId("template");
      const template: TemplateRecord = {
        id: templateId,
        name: input.name,
        currentVersion: 0,
        latestVersionId: "",
        slotCount: input.slots.length,
        createdAt: now,
        updatedAt: now,
      };
      await db.templates.add(template);
    } else {
      const current = await db.templates.get(templateId);
      currentVersion = current?.currentVersion ?? 0;
    }

    const versionRecord: TemplateVersionRecord = {
      id: makeId("template_version"),
      templateId,
      name: input.name,
      version: currentVersion + 1,
      sourceDocxBlob: input.sourceDocxBlob,
      sourceDocxName: input.sourceDocxName,
      slots: input.slots,
      createdAt: now,
    };

    await db.templateVersions.add(versionRecord);
    await db.templates.update(templateId, {
      name: input.name,
      currentVersion: versionRecord.version,
      latestVersionId: versionRecord.id,
      slotCount: input.slots.length,
      updatedAt: now,
    });

    return versionRecord;
  });
}

export async function duplicateTemplate(templateId: string) {
  const latest = await getLatestTemplateVersion(templateId);
  if (!latest) {
    throw new Error("找不到可复制的模板版本。");
  }

  const duplicatedSlots = latest.slots.map((slot) => {
    const nextSlotId = makeId("slot");
    return {
      ...slot,
      id: nextSlotId,
      occurrences: slot.occurrences.map((occurrence) => ({
        ...occurrence,
        id: makeId("occurrence"),
        slotId: nextSlotId,
      })),
    };
  });

  return saveTemplateVersion({
    name: `${latest.name} 副本`,
    sourceDocxBlob: latest.sourceDocxBlob,
    sourceDocxName: latest.sourceDocxName,
    slots: duplicatedSlots,
  });
}

export async function deleteTemplate(templateId: string) {
  await db.transaction("rw", db.templates, db.templateVersions, async () => {
    await db.templates.delete(templateId);
    const versions = await db.templateVersions.where("templateId").equals(templateId).primaryKeys();
    await db.templateVersions.bulkDelete(versions);
  });
}

export async function saveDataset(dataset: DatasetDraft) {
  const record = {
    ...dataset,
    updatedAt: toIsoNow(),
  };
  await db.datasets.put(record);
  return record;
}

export async function createTask(task: TaskRecord, artifacts: ArtifactRecord[]) {
  await db.transaction("rw", db.tasks, db.artifacts, async () => {
    await db.tasks.put(task);
    if (artifacts.length > 0) {
      await db.artifacts.bulkPut(artifacts);
    }
  });
}

export async function updateTask(taskId: string, update: Partial<TaskRecord>) {
  await db.tasks.update(taskId, update);
}

export async function replaceTaskArtifacts(taskId: string, artifacts: ArtifactRecord[]) {
  await db.transaction("rw", db.artifacts, async () => {
    const existing = await db.artifacts.where("taskId").equals(taskId).primaryKeys();
    await db.artifacts.bulkDelete(existing);
    if (artifacts.length > 0) {
      await db.artifacts.bulkPut(artifacts);
    }
  });
}

export async function deleteTask(taskId: string) {
  await db.transaction("rw", db.tasks, db.artifacts, async () => {
    await db.tasks.delete(taskId);
    const artifactIds = await db.artifacts.where("taskId").equals(taskId).primaryKeys();
    await db.artifacts.bulkDelete(artifactIds);
  });
}

export async function clearAllHistoryData() {
  await db.transaction(
    "rw",
    [db.templates, db.templateVersions, db.datasets, db.tasks, db.artifacts],
    async () => {
      await db.artifacts.clear();
      await db.tasks.clear();
      await db.datasets.clear();
      await db.templateVersions.clear();
      await db.templates.clear();
    },
  );
}
