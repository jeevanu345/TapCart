export interface TapProof {
  uid: string;
  counter: string;
  mac: string;
}
/** Support the documented ctr mirror and the explicit counter alias. Preserve malformed
 * proof fields for server rejection rather than silently treating them as a static tag. */
export function tapProof(url: URL): TapProof | undefined {
  if (!["uid", "ctr", "counter", "mac"].some((key) => url.searchParams.has(key))) return undefined;
  return {
    uid: url.searchParams.get("uid") ?? "",
    counter: url.searchParams.get("ctr") ?? url.searchParams.get("counter") ?? "",
    mac: url.searchParams.get("mac") ?? "",
  };
}
export function unitLink(input: string, origin: string): string {
  const text = input.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))
    return `/u/${text}`;
  const url = new URL(text, origin);
  if (url.origin !== origin) throw Error("Use a TapCart unit link from this site.");
  if (!/^\/u\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(url.pathname))
    throw Error("Enter an NFC link ending in /u/ followed by the unit ID.");
  return url.pathname + url.search;
}
