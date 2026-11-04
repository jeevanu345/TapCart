import { pathToFileURL } from "node:url";

/** NDEF URI record plus Type 2 NDEF TLV and terminator; excludes tag CC/reserved bytes. */
export function ndefUriSize(uri: string, capacity = 144) {
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error("Invalid tag capacity");
  const parsed = new URL(uri);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only HTTP(S) identity URIs are supported");
  }
  const prefixes = ["https://www.", "http://www.", "https://", "http://"];
  const prefix = prefixes.find((candidate) => uri.startsWith(candidate));
  const uriBytes = Buffer.byteLength(uri, "utf8");
  const payloadBytes = 1 + Buffer.byteLength(prefix ? uri.slice(prefix.length) : uri, "utf8");
  const recordBytes = payloadBytes + (payloadBytes <= 255 ? 4 : 7);
  if (recordBytes > 65535) throw new Error("Record exceeds Type 2 TLV length capacity");
  const totalBytes = recordBytes + (recordBytes < 255 ? 3 : 5);
  return {
    uriBytes,
    payloadBytes,
    recordBytes,
    totalBytes,
    capacity,
    freeBytes: capacity - totalBytes,
    fits: totalBytes <= capacity,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(
      JSON.stringify(ndefUriSize(process.argv[2] ?? "", Number(process.argv[3] ?? 144)), null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid URI");
    process.exitCode = 1;
  }
}
