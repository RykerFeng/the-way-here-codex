import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeUrl, validatePublicUrl, type DnsResolver } from "../src/import/network-policy.js";

const publicResolver: DnsResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("accepts ordinary public HTTP URLs and canonicalizes fragments", async () => {
  const parsed = await validatePublicUrl("https://Example.com/docs/#part", publicResolver);
  assert.equal(parsed.href, "https://example.com/docs/#part");
  assert.equal(canonicalizeUrl(parsed), "https://example.com/docs/");
});

test("rejects credentials, unusual ports, loopback, private, link-local, and metadata addresses", async () => {
  const cases: Array<[string, DnsResolver]> = [
    ["file:///etc/passwd", publicResolver],
    ["https://me:secret@example.com/", publicResolver],
    ["https://example.com:8443/", publicResolver],
    ["http://127.0.0.1/", publicResolver],
    ["http://10.0.0.1/", publicResolver],
    ["http://169.254.169.254/latest/meta-data", publicResolver],
    ["http://internal.test/", async () => [{ address: "192.168.1.2", family: 4 }]],
    ["http://v6.test/", async () => [{ address: "::1", family: 6 }]],
  ];
  for (const [url, resolver] of cases) {
    await assert.rejects(validatePublicUrl(url, resolver), (error: { code?: string }) => error.code === "UNSAFE_URL");
  }
});
