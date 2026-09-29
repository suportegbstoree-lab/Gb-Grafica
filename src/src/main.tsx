import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import ErrorBoundary from './components/ErrorBoundary.tsx';
import appStyles from './index.css?inline';

// Mantém o CSS no mesmo bundle que monta o React. Isso evita que um rewrite,
// cache antigo ou configuração da hospedagem entregue HTML no lugar do .css.
const previousStyles = document.getElementById('gb-app-styles');
previousStyles?.remove();

const styleElement = document.createElement('style');
styleElement.id = 'gb-app-styles';
styleElement.textContent = appStyles;
document.head.appendChild(styleElement);

async function mountApplication() {
  const module = import.meta.env.VITE_E2E_MODE === 'true'
    ? await import('./e2e/E2EHarness.tsx')
    : await import('./App.tsx');
  const RootApplication = module.default;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <MotionConfig reducedMotion="user">
          <RootApplication />
        </MotionConfig>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void mountApplication();
