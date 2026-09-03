import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare readonly props: Readonly<ErrorBoundaryProps>;
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Falha inesperada na interface:', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="min-h-screen bg-[#fcfcfd] px-4 flex items-center justify-center text-gray-900">
        <section role="alert" className="w-full max-w-lg rounded-3xl border border-pink-100 bg-white p-8 text-center shadow-xl">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-pink-500">GB Gráfica</p>
          <h1 className="mt-3 text-2xl font-black">Não foi possível exibir esta página</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            Seus dados do carrinho continuam salvos neste navegador. Atualize a página para tentar novamente.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-full bg-gray-900 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-pink-500"
            >
              Atualizar página
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="rounded-full border border-gray-200 px-6 py-3 text-xs font-black uppercase tracking-widest text-gray-700 hover:border-pink-300"
            >
              Voltar à loja
            </button>
          </div>
        </section>
      </main>
    );
  }
}
