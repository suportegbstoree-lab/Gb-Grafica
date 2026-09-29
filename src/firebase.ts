import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, type AppCheck } from 'firebase/app-check';
import { getAI, getGenerativeModel, AgentPlatformBackend } from 'firebase/ai';
import { setApiAppCheckTokenProvider } from './services/apiClient';

const app = initializeApp(firebaseConfig);

function initializeFirebaseAppCheck(): AppCheck | null {
	const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?.trim();
	if (!siteKey || typeof window === 'undefined') return null;

	try {
		return initializeAppCheck(app, {
			provider: new ReCaptchaEnterpriseProvider(siteKey),
			isTokenAutoRefreshEnabled: true,
		});
	} catch {
		console.warn('[App Check] Não foi possível inicializar a proteção do navegador.');
		return null;
	}
}

export const appCheck = initializeFirebaseAppCheck();

export async function getAppCheckToken(): Promise<string | null> {
	if (!appCheck) return null;
	try {
		const result = await getToken(appCheck, false);
		return result.token || null;
	} catch {
		console.warn('[App Check] Não foi possível validar esta sessão do navegador.');
		return null;
	}
}

setApiAppCheckTokenProvider(getAppCheckToken);

const ai = getAI(app, { backend: new AgentPlatformBackend() });
const model = getGenerativeModel(ai, { model: import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-3.8-flash' });
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// Create User, Login, Logout, and Auth State Change Listeners

// Auth Helpers

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);
export const onAuthStateChangedListener = (callback: (user: FirebaseUser | null) => void) => {
	return onAuthStateChanged(auth, callback);
};
export const getCurrentUser = (): FirebaseUser | null => auth.currentUser;
export const getIdToken = async (): Promise<string | null> => {
	const user = auth.currentUser;
	if (user) return user.getIdToken();
	return null;
};

export const getCurrentUserIdToken = async (): Promise<string | null> => {
	const user = auth.currentUser;
	if (user) return user.getIdToken();
	return null;
};

// helper for firebase authentication with App Check token

// Firestore Helpers
export const getCollection = (collectionPath: string) => collection(db, collectionPath);
export const getDocument = (documentPath: string) => doc(db, documentPath);
export const setDocument = (documentPath: string, data: Record<string, unknown>) => setDoc(doc(db, documentPath), data);
export const getDocumentData = async (documentPath: string) => {
	const docRef = doc(db, documentPath);
	const docSnap = await getDoc(docRef);
	return docSnap.exists() ? docSnap.data() : null;
};
export const updateDocument = (documentPath: string, data: Record<string, unknown>) => updateDoc(doc(db, documentPath), data);
export const deleteDocument = (documentPath: string) => deleteDoc(doc(db, documentPath));

// Firestore Error Handling
export enum OperationType {
	CREATE = 'create',
	UPDATE = 'update',
	DELETE = 'delete',
	LIST = 'list',
	GET = 'get',
	WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
	const normalizedError = error instanceof Error ? error : new Error(String(error));
	console.error(`[Firestore] ${operationType} ${path || '(sem caminho)'}:`, normalizedError.message);
	return normalizedError;
}
export function handleAuthError(error: unknown) {
	const normalizedError = error instanceof Error ? error : new Error(String(error));
	console.error('[Auth] Erro de autenticação:', normalizedError.message);
	return normalizedError;
}
export function handleStorageError(error: unknown, path: string | null) {
	const normalizedError = error instanceof Error ? error : new Error(String(error));
	console.error(`[Storage] ${path || '(sem caminho)'}:`, normalizedError.message);
	return normalizedError;
}

export async function generateGeminiText(prompt: string): Promise<string> {
	if (!prompt.trim()) {
		throw new Error('O prompt do Gemini não pode ser vazio.');
	}

	const result = await model.generateContent(prompt);
	const text = result.response.text()?.trim();
	if (!text) throw new Error('O Gemini retornou uma resposta vazia.');
	return text;
}

export {
	collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, onAuthStateChanged
};
export type { FirebaseUser };
