import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';
import type { AppCheck } from 'firebase/app-check';
import { apiFetch, setApiAppCheckTokenProvider } from './services/apiClient';
import { checkAppCheckConnection, createAppCheckTokenProvider, initializeBrowserAppCheck } from './services/appCheckClient';
import { createFirebaseTextModel } from './services/firebaseAiClient';

const app = initializeApp(firebaseConfig);

function initializeFirebaseAppCheck(): AppCheck | null {
	try {
		return initializeBrowserAppCheck(app, {
			siteKey: import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY,
			development: import.meta.env.DEV,
			debug: import.meta.env.DEV && import.meta.env.VITE_APP_CHECK_DEBUG === 'true',
		});
	} catch {
		console.warn('[App Check] Não foi possível inicializar a proteção do navegador.');
		return null;
	}
}

export const appCheck = initializeFirebaseAppCheck();

export const getAppCheckToken = createAppCheckTokenProvider(appCheck);

setApiAppCheckTokenProvider(getAppCheckToken);

// Confirma a validação real pela API em segundo plano, sem impedir a montagem da loja.
if (appCheck) {
	void checkAppCheckConnection(apiFetch).then(verified => {
		if (!verified) console.warn('[App Check] A API ainda não confirmou a proteção desta sessão.');
	}).catch(() => console.warn('[App Check] O diagnóstico da API está indisponível.'));
}

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
const model = createFirebaseTextModel(app, import.meta.env.VITE_GEMINI_MODEL?.trim() || 'gemini-3.8-flash');

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
