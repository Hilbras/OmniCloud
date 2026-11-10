import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness, type TestHarness } from "./harness";

/**
 * End-to-end check with the real `rclone` binary. It is opt-in because the
 * binary is not a project dependency: set `RCLONE_BIN=/path/to/rclone`.
 *
 * Everything else — harness, WebDAV listener, token, Basic auth — is the real
 * production code path, so a pass here is evidence that a third-party WebDAV
 * client can read and write the drive.
 *
 * The calls are asynchronous on purpose: the WebDAV listener runs in this
 * process, so a synchronous child process would block the event loop and the
 * server could never answer.
 */
const rcloneBin = process.env.RCLONE_BIN;
const describeWithRclone = rcloneBin === undefined ? describe.skip : describe;
const execFileAsync = promisify(execFile);

let h: TestHarness;
let configPath: string;
let workDir: string;
let remote: string;

async function rclone(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      rcloneBin!,
      [
        "--config",
        configPath,
        "--contimeout",
        "5s",
        "--timeout",
        "15s",
        "--retries",
        "1",
        "--low-level-retries",
        "1",
        "--stats",
        "0",
        ...args,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string | Buffer }).stderr;
    throw new Error(`rclone ${args.join(" ")} failed: ${stderr?.toString() ?? String(error)}`);
  }
}

beforeAll(async () => {
  h = await createTestHarness(
    undefined,
    undefined,
    null,
    undefined,
    undefined,
    null,
    true,
    true,
    0,
  );
  const cookie = await h.login("+15551234567");
  const tokenResponse = await h.app.inject({
    method: "POST",
    url: "/api/tokens",
    headers: { cookie: `omnicloud_session=${cookie}` },
    payload: { name: "rclone-e2e" },
  });
  expect(tokenResponse.statusCode).toBe(201);
  const token = tokenResponse.json().token as string;

  workDir = mkdtempSync(join(tmpdir(), "omnicloud-rclone-"));
  configPath = join(workDir, "rclone.conf");
  const obscured = execFileSync(rcloneBin!, ["obscure", token], { encoding: "utf8" }).trim();
  writeFileSync(
    configPath,
    [
      "[omni]",
      "type = webdav",
      `url = ${h.webDavUrl}/dav/`,
      "vendor = other",
      "user = omnicloud",
      `pass = ${obscured}`,
      "",
    ].join("\n"),
  );
  remote = "omni:";
});

afterAll(async () => {
  if (h.webDavStop) await h.webDavStop();
  await h.app.close();
});

describeWithRclone("rclone against the real WebDAV listener", () => {
  it("creates a folder, uploads, reads, moves and deletes a file", async () => {
    const source = join(workDir, "hello.txt");
    writeFileSync(source, "hello from rclone\n");

    await rclone(["mkdir", `${remote}RcloneFolder`]);
    await rclone(["copyto", source, `${remote}RcloneFolder/hello.txt`]);

    expect(await rclone(["cat", `${remote}RcloneFolder/hello.txt`])).toBe("hello from rclone\n");
    expect(await rclone(["lsf", `${remote}RcloneFolder/`])).toContain("hello.txt");

    await rclone(["moveto", `${remote}RcloneFolder/hello.txt`, `${remote}RcloneFolder/moved.txt`]);
    const listing = await rclone(["lsf", `${remote}RcloneFolder/`]);
    expect(listing).toContain("moved.txt");
    expect(listing).not.toContain("hello.txt");

    await rclone(["deletefile", `${remote}RcloneFolder/moved.txt`]);
    expect((await rclone(["lsf", `${remote}RcloneFolder/`])).trim()).toBe("");
  }, 120_000);
});
