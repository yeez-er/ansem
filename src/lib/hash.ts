// FNV-1a 32-bit: dependency-free deterministic hash from a string key.
// Shared by the mock metrics provider and the seed curve builder (extracted
// on the 2nd occurrence) — both need stable pseudo-variety without ambient
// randomness.
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
