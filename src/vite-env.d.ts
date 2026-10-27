/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_GEMINI_MODEL?: string;
	readonly VITE_RECAPTCHA_ENTERPRISE_SITE_KEY?: string;
	readonly VITE_APP_CHECK_DEBUG?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
