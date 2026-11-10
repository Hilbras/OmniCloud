import { describe, expect, it } from "vitest";
import { createPairingKeyMaterial, openPairingKeyMaterial } from "../src/lib/key-pairing";

describe("device pairing key material", () => {
  it("opens the URK on the second device without the server seeing it", () => {
    const urk = new Uint8Array(32).fill(11);
    const material = createPairingKeyMaterial(urk);
    const opened = openPairingKeyMaterial(
      {
        wrappedUrk: material.wrappedUrk,
        fileId: material.fileId,
        versionId: material.versionId,
        keyEpoch: material.keyEpoch,
      },
      material.secretBase64,
    );
    expect(Array.from(opened)).toEqual(Array.from(urk));
  });

  it("fails with the wrong link secret", () => {
    const material = createPairingKeyMaterial(new Uint8Array(32).fill(3));
    const wrong = new Uint8Array(32).fill(4);
    const wrongBase64 = Buffer.from(wrong).toString("base64");
    expect(() =>
      openPairingKeyMaterial(
        {
          wrappedUrk: material.wrappedUrk,
          fileId: material.fileId,
          versionId: material.versionId,
          keyEpoch: material.keyEpoch,
        },
        wrongBase64,
      ),
    ).toThrow();
  });
});
