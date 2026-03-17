import Dexie, { type Table } from "dexie";
import {
  type ArtifactRecord,
  type DatasetDraft,
  type TaskRecord,
  type TemplateRecord,
  type TemplateVersionRecord,
} from "./types";

export class ClipCapDatabase extends Dexie {
  templates!: Table<TemplateRecord, string>;
  templateVersions!: Table<TemplateVersionRecord, string>;
  datasets!: Table<DatasetDraft, string>;
  tasks!: Table<TaskRecord, string>;
  artifacts!: Table<ArtifactRecord, string>;

  constructor() {
    super("clipcap-word");

    this.version(1).stores({
      templates: "id, updatedAt, lastUsedAt",
      templateVersions: "id, templateId, version, createdAt",
      datasets: "id, createdAt, updatedAt",
      tasks: "id, status, createdAt, finishedAt",
      artifacts: "id, taskId, kind, createdAt",
    });
  }
}

export const db = new ClipCapDatabase();
