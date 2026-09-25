import "server-only";
import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin (somente servidor). Aceita as credenciais de duas formas:
 *  1) FIREBASE_SERVICE_ACCOUNT = JSON da conta de serviço (texto puro ou base64)
 *  2) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 * O cliente nunca acessa o Firestore diretamente (regras negam tudo); todo acesso
 * passa pelas rotas de API, que usam o Admin SDK.
 */
function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (raw) {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const sa = JSON.parse(json) as { project_id: string; client_email: string; private_key: string };
    return { projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key };
  }
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  return null;
}

let cachedDb: Firestore | null | undefined;
let initError: string | null = null;

export function firestore(): Firestore | null {
  if (cachedDb !== undefined) return cachedDb;
  try {
    const sa = readServiceAccount();
    if (!sa) {
      cachedDb = null;
      return null;
    }
    const app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId: sa.projectId });
    const db = getFirestore(app);
    db.settings({ ignoreUndefinedProperties: true });
    cachedDb = db;
  } catch (e) {
    initError = e instanceof Error ? e.message : String(e);
    cachedDb = null;
  }
  return cachedDb;
}

export function firebaseStatus() {
  const db = firestore();
  return {
    configured: !!db,
    projectId: db ? (readServiceAccount()?.projectId ?? null) : null,
    error: initError,
  };
}
