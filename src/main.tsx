import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import App from './App.tsx';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </ErrorBoundary>
  </StrictMode>,
);
