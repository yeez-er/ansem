// Spec 008: the canonical $ANSEM Solana mint. Copycat mints are rampant, so
// this constant is the ONLY place the address may appear in src — every
// consumer (footer, copy button) imports it. Enforced by a sweep test.

export const ANSEM_MINT = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";
