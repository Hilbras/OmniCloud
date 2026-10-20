# M5 streaming benchmark evidence

Two independent measurements, because the first one alone could not answer the
question it was meant to answer.

## 1. Throughput and round-trip — `bench-streaming-1gb.json`

`packages/sdk/scripts/bench-streaming.ts`, Node v24.21.0, single process
containing the client _and_ the test HTTP server _and_ the generated fixtures.

| Phase                         | 1 GiB   | Result                                    |
| ----------------------------- | ------- | ----------------------------------------- |
| Streaming upload              | 258 s   | 4.0 MiB/s                                 |
| Streaming download + decrypt  | 142 s   | 7.2 MiB/s, round-trip `roundTripOk: true` |
| In-memory upload (prior path) | 256 MiB | 0.40 s                                    |

Correctness is established here: the 1 GiB file decrypts byte-identically
(sha256 match), and the stored envelope begins with the `OCE1` magic.

Throughput varies several-fold between runs on the same machine depending on
cache state and background load (earlier runs of this same script measured
17.4 MiB/s upload and 14.9 MiB/s download). Treat throughput as indicative only;
the `roundTripOk` result is the durable signal.

**This script reports no memory figures.** An earlier version emitted
`peakRssMb` / `peakRssDeltaMb` fields that read like client measurements but
sampled one process holding the client, the server and the fixtures at once, so
they could not be attributed to the SDK — the `+1021 MB` upload figure was the
server-side write path, not client buffering. Those fields have been removed and
client memory is measured below instead.

## 2. Client memory — `packages/sdk/test/streaming-memory.test.ts`

To measure the client honestly, the HTTP server runs in the parent process and
the SDK client runs in a **child process** that reports only its own peak RSS.

| File size | baseline | spool-only (no network) | upload | download |
| --------- | -------- | ----------------------- | ------ | -------- |
| 32 MiB    | 121 MB   | 286 MB                  | 231 MB | 275 MB   |
| 128 MiB   | 120 MB   | 298 MB                  | 271 MB | 329 MB   |

A 4× increase in file size raises upload peak RSS by 17% and download peak by
20%, not by 4×. A client that buffered plaintext or ciphertext would show peak
RSS tracking file size proportionally.

Supporting probe (`encryptChunks` → file, `--expose-gc`, identical harness):

| File size | Peak RSS | After forced GC | `heapUsed` |
| --------- | -------- | --------------- | ---------- |
| 64 MiB    | 195 MB   | 140 MB          | 7 MB       |
| 256 MiB   | 207 MB   | 203 MB          | 7 MB       |
| 512 MiB   | 212 MB   | 165 MB          | 7 MB       |

`heapUsed` is a constant 7 MB at every size, and peak RSS is flat across an 8×
size range. The ~200 MB residual is V8 and Node Buffer-pool high-water
retention, not accumulated data.

## Conclusion

The M5 exit criterion — peak memory bounded by chunk size (4 MiB), not file
size — holds for the SDK/CLI path. Absolute peak RSS is allocator-dependent, so
the automated assertion is the **ratio between file sizes**, which is durable
across machines; absolute numbers are recorded above for reference.

## Not verified

- No recorded browser benchmark. `apps/web/src/api/encrypt-stream.ts` ships an
  OPFS spool with a documented 1 GiB buffered fallback ceiling, but the
  "Web 500 MB on Chromium" target has not been measured.
- Peak RSS on other platforms (macOS, Windows) has not been sampled; the
  allocator behaviour above is Linux/Node 24 specific.
