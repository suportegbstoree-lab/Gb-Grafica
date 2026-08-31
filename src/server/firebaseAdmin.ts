import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// O projeto atual usa um banco Firestore nomeado. Em outro projeto, substitua
// pelo identificador configurado no Firebase Console via variável de ambiente.
const DEFAULT_FIRESTORE_DATABASE_ID = 'ai-studio-2d6e0927-5895-447d-a355-298207aa71d2';

interface ServiceAccountEnvironment {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

export interface AdminServices {
  app: App;
  auth: Auth;
  db: Firestore;
}

function getServiceAccount(): ServiceAccountEnvironment | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (rawJson) {
    try {
      return JSON.parse(rawJson) as ServiceAccountEnvironment;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.');
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ||
    (process.env.FIREBASE_PROJECT_ID?.trim() &&
      process.env.FIREBASE_CLIENT_EMAIL?.trim() &&
      process.env.FIREBASE_PRIVATE_KEY?.trim())
  );
}

export function getAdminServices(): AdminServices {
  const app = getApps()[0] || createAdminApp();
  const databaseId = process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() || DEFAULT_FIRESTORE_DATABASE_ID;
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app, databaseId),
  };
}

function createAdminApp(): App {
  const serviceAccount = getServiceAccount();

  if (!serviceAccount?.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error(
      'Firebase Admin não configurado. Defina FIREBASE_SERVICE_ACCOUNT_JSON ou FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY.'
    );
  }

  return initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key.replace(/\\n/g, '\n'),
    }),
  });
}
