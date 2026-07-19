/**
 * SHA-256 hashing in the browser via WebCrypto.
 */

export async function sha256(data: Uint8Array | ArrayBuffer): Promise<string> {
  // crypto.subtle.digest expects an ArrayBuffer; copy the bytes if Uint8Array
  // is backed by a SharedArrayBuffer.
  const buffer: ArrayBuffer =
    data instanceof Uint8Array
      ? (() => {
          const ab = new ArrayBuffer(data.byteLength);
          new Uint8Array(ab).set(data);
          return ab;
        })()
      : data;
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Convenience: returns "sha256:<hex>". */
export async function integrity(data: Uint8Array | ArrayBuffer): Promise<string> {
  return `sha256:${await sha256(data)}`;
}
