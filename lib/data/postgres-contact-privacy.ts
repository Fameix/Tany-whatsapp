import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.MESSAGING_SERVICE_SECRET ?? "";
  if (secret.length < 32) throw new Error("POSTGRES_CONTACT_PRIVACY_KEY_UNAVAILABLE");
  return createHash("sha256").update(secret).digest();
}

/** Keeps raw customer phone numbers out of standalone Postgres storage. */
export function postgresContactProjection(phone: string) {
  const material = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", material, iv);
  const encrypted = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
  return {
    phoneEnc: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    phoneHash: createHmac("sha256", material).update(phone).digest("base64url"),
  };
}
export function decryptPostgresContactPhone(value: string) {
  const packed = Buffer.from(value, "base64url");
  if (packed.length < 29) throw new Error("POSTGRES_CONTACT_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8");
}
