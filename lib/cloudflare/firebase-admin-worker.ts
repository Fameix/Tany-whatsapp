/**
 * Cloudflare Worker replacement for `firebase-admin/{app,firestore,auth}`.
 *
 * The Firestore Admin SDK depends on gRPC and protobuf code generation
 * (`new Function`), which the Workers runtime forbids, and it authenticates
 * with Google ADC, which does not exist on Cloudflare. Merely evaluating it
 * crashes the request. The Worker runtime uses the Postgres messaging
 * repository (`MESSAGING_DATABASE=postgres`), so the Vite/Cloudflare build
 * aliases the SDK to this module (see vite.config.ts). Node builds (`next
 * build`, local dev with ADC) keep the real SDK.
 *
 * Value types used outside Firestore (Timestamp, FieldValue sentinels) are
 * real implementations. Any actual Firestore or Firebase Auth access throws
 * instead of silently falling back.
 */

export class FirebaseAdminUnavailableError extends Error {
  constructor(api: string) {
    super(`${api} is unavailable in the Cloudflare Worker runtime. Firestore and Firebase Auth require the Node runtime; use MESSAGING_DATABASE=postgres on Cloudflare.`);
    this.name = "FirebaseAdminUnavailableError";
  }
}

const unavailable = (api: string): never => { throw new FirebaseAdminUnavailableError(api); };

/** Compatible with firebase-admin's Timestamp for the value operations this app uses. */
export class Timestamp {
  constructor(readonly seconds: number, readonly nanoseconds: number) {
    if (!Number.isFinite(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9)
      throw new RangeError("Invalid Timestamp");
  }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromDate(date: Date) { return Timestamp.fromMillis(date.getTime()); }
  static fromMillis(milliseconds: number) {
    const seconds = Math.floor(milliseconds / 1000);
    return new Timestamp(seconds, Math.floor((milliseconds - seconds * 1000) * 1e6));
  }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  toDate() { return new Date(this.toMillis()); }
  isEqual(other: Timestamp) { return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds; }
  valueOf() { return `${String(this.seconds + 1e12).padStart(13, "0")}.${String(this.nanoseconds).padStart(9, "0")}`; }
  toJSON() { return { seconds: this.seconds, nanoseconds: this.nanoseconds }; }
}

/** Write sentinels. They are only meaningful to Firestore, which is unavailable here. */
export class FieldValue {
  private constructor(readonly methodName: string) {}
  static serverTimestamp() { return new FieldValue("FieldValue.serverTimestamp"); }
  static delete() { return new FieldValue("FieldValue.delete"); }
  static increment() { return new FieldValue("FieldValue.increment"); }
  static arrayUnion() { return new FieldValue("FieldValue.arrayUnion"); }
  static arrayRemove() { return new FieldValue("FieldValue.arrayRemove"); }
  isEqual(other: FieldValue) { return other === this; }
}

// firebase-admin/app
export const getApps = (): never[] => [];
export const getApp = () => unavailable("Firebase Admin app");
export const initializeApp = () => unavailable("Firebase Admin initializeApp");
export const applicationDefault = () => unavailable("Google Application Default Credentials");
export const cert = () => unavailable("Firebase Admin service account credentials");

// firebase-admin/firestore
export const getFirestore = () => unavailable("Firestore");
export const initializeFirestore = () => unavailable("Firestore");

// firebase-admin/auth
export const getAuth = () => unavailable("Firebase Auth");
