import { afterEach, describe, expect, it, vi } from "vitest";
import { notify } from "../src/lib/notifications";

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static instances: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
  static requestPermission = vi.fn(async () => "granted" as const);
}

afterEach(() => {
  FakeNotification.instances = [];
  FakeNotification.permission = "granted";
});

describe("upload notifications", () => {
  it("shows a notification when permission is granted", () => {
    (globalThis as { Notification?: unknown }).Notification = FakeNotification;
    notify("Upload complete", "file.txt", "upload-1");
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0]!.options).toMatchObject({ body: "file.txt" });
  });

  it("does nothing when permission is denied", () => {
    FakeNotification.permission = "denied";
    (globalThis as { Notification?: unknown }).Notification = FakeNotification;
    notify("Upload complete", "file.txt");
    expect(FakeNotification.instances).toHaveLength(0);
  });
});
