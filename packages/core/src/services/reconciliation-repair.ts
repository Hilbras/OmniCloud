/**
 * Repair planning for reconciliation findings. This module only plans. It returns
 * the actions a user could approve, each with the reason and whether it is safe.
 * It never performs a deletion or a write itself.
 *
 * Safety rules:
 *  - A dangling record may be repaired only by marking it, never by deleting the
 *    user's metadata silently. The plan proposes detaching the record from the
 *    missing object, and the user must approve it.
 *  - An unknown channel object is never proposed for deletion. It may be a leaked
 *    upload, or something the user stored themselves; deleting it would destroy
 *    data that cannot be proven to be OmniCloud's. The only offered action is to
 *    adopt it as a new file, which creates a record and removes nothing.
 *  - Every action carries an id. An approval names an id; nothing else is applied.
 */
import { ValidationError } from "../errors";
import type { ReconciliationReport } from "./reconciliation";

export type RepairAction =
  | {
      id: string;
      kind: "detach-dangling";
      messageId: number;
      recordedBy: "file" | "upload";
      reason: string;
      destructive: false;
    }
  | {
      id: string;
      kind: "remove-dangling-version";
      messageId: number;
      fileId: string;
      versionId: string;
      recordedBy: "version";
      reason: string;
      destructive: false;
    }
  | {
      id: string;
      kind: "adopt-unknown";
      messageId: number;
      sizeBytes: number | null;
      reason: string;
      destructive: false;
    };

export interface RepairPlan {
  actions: RepairAction[];
  /** Always empty: this plan never proposes deleting a channel object. */
  deletions: never[];
}

export function planRepairs(report: ReconciliationReport): RepairPlan {
  const actions: RepairAction[] = [];
  for (const finding of report.dangling) {
    if (finding.recordedBy === "file") {
      actions.push({
        id: `detach-file-${finding.messageId}`,
        kind: "detach-dangling",
        messageId: finding.messageId,
        recordedBy: "file",
        reason:
          "A record points at a Telegram message that is no longer in the channel. " +
          "Detaching marks the record as missing; it does not delete it.",
        destructive: false,
      });
    } else if (
      finding.recordedBy === "version" &&
      finding.fileId !== undefined &&
      finding.versionId !== undefined
    ) {
      actions.push({
        id: `remove-version-${finding.versionId}`,
        kind: "remove-dangling-version",
        messageId: finding.messageId,
        fileId: finding.fileId,
        versionId: finding.versionId,
        recordedBy: "version",
        reason:
          "A historical version points at a Telegram message that is gone. Removing it " +
          "deletes only that version row; the current file and its object are untouched.",
        destructive: false,
      });
    }
    // Upload-operation findings have no safe repair here. They stay visible in
    // the report rather than being offered as an action that always fails.
  }
  for (const finding of report.unknown) {
    actions.push({
      id: `adopt-${finding.messageId}`,
      kind: "adopt-unknown",
      messageId: finding.messageId,
      sizeBytes: finding.sizeBytes,
      reason:
        "A channel message has no record. Adopting creates a file record for it. " +
        "The message is not removed.",
      destructive: false,
    });
  }
  return { actions, deletions: [] };
}

/** Accepts only actions the plan actually offered, by id. Anything else is refused. */
export function selectApproved(plan: RepairPlan, approvedIds: string[]): RepairAction[] {
  const offered = new Map(plan.actions.map((action) => [action.id, action]));
  const selected: RepairAction[] = [];
  for (const id of new Set(approvedIds)) {
    const action = offered.get(id);
    if (!action) throw new ValidationError(`Repair '${id}' was not offered by the plan`);
    selected.push(action);
  }
  return selected;
}
