import "server-only";
import {
  applicationDefault,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

// GOOGLE_CLOUD_PROJECT can belong to another local project. This service owns
// tany-whatsapp, so resolve it explicitly for both local ADC and Cloud Run.
export const firebaseAdminProjectId = "tany-whatsapp";
const firebaseAdminAppName = "tany-messaging-admin";
const emulatorEnabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

function getAdminApp() {
  const existing = getApps().find((candidate) => candidate.name === firebaseAdminAppName);
  if (existing) return existing;

  // applicationDefault() can probe local metadata/ADC sources. Keep it behind
  // first actual Firestore/Auth use so build-time module evaluation is inert.
  const app = initializeApp(
    { credential: applicationDefault(), projectId: firebaseAdminProjectId },
    firebaseAdminAppName,
  );
  if (process.env.NODE_ENV === "development") {
    console.info("[FIREBASE_ADMIN_DIAG]", {
      projectId: firebaseAdminProjectId,
      credentialMode: "applicationDefault",
      emulatorEnabled,
      nodeEnv: process.env.NODE_ENV,
    });
    console.info("[RUNTIME_PROJECT]", {
      firebaseProjectId: firebaseAdminProjectId,
      googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT ?? null,
      gcloudProject: process.env.GCLOUD_PROJECT ?? null,
      emulatorHostPresent: emulatorEnabled,
      pid: process.pid,
      cwd: process.cwd(),
    });
  }
  return app;
}

let firestore: Firestore | undefined;
let auth: Auth | undefined;
const getAdminDb = () => (firestore ??= getFirestore(getAdminApp()));
const getAdminAuth = () => (auth ??= getAuth(getAdminApp()));

/** Keeps existing synchronous call sites intact while deferring ADC until a
 * method/property is used during a real request. Function members are bound to
 * the underlying Firebase service to preserve SDK receiver behavior. */
function lazyService<T extends object>(factory: () => T): T {
  const target = Object.create(null) as T;
  return new Proxy(target, {
    get(_target, property) {
      const service = factory();
      const value = Reflect.get(service, property, service);
      return typeof value === "function" ? value.bind(service) : value;
    },
    set(_target, property, value) {
      return Reflect.set(factory(), property, value);
    },
    has(_target, property) {
      return Reflect.has(factory(), property);
    },
  });
}

export const adminDb = lazyService(getAdminDb);
export const adminAuth = lazyService(getAdminAuth);
