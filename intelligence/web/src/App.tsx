import { Component, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AssistantProvider, SessionProvider, useSession } from "./lib/session";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { Layout } from "./components/Layout";
import { GatePage, LoginPage } from "./pages/Auth";
import { DashboardPage } from "./pages/Dashboard";
import { SpreadsheetsPage } from "./pages/Spreadsheets";
import { SpreadsheetPage } from "./pages/Spreadsheet";
import { ClientPage, ClientsPage } from "./pages/Clients";
import { AccountPage, ActivityPage, AdminPage, AssistantPage, NotFoundPage } from "./pages/Other";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (this.state.error)
      return (
        <div className="center-screen">
          <div className="empty">
            <h3>Algo deu errado nesta tela</h3>
            <p>Suas alterações já salvas estão seguras. Recarregue a página para continuar.</p>
            <button className="btn primary" onClick={() => window.location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function Private({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading)
    return (
      <div className="center-screen">
        <span className="spinner" aria-label="Carregando" />
      </div>
    );
  if (!me) {
    try {
      if (loc.pathname !== "/") sessionStorage.setItem("ci_after_login", loc.pathname + loc.search);
    } catch {
      /* ok */
    }
    return <Navigate to="/entrar" replace />;
  }
  return <Layout>{children}</Layout>;
}

function Public({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return null;
  if (me) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { can } = useSession();
  return can("admin") ? <>{children}</> : <NotFoundPage />;
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <ConfirmProvider>
            <SessionProvider>
              <AssistantProvider>
                <Routes>
                  <Route path="/entrar" element={<Public><GatePage /></Public>} />
                  <Route path="/login" element={<Public><LoginPage /></Public>} />
                  <Route path="/" element={<Private><DashboardPage /></Private>} />
                  <Route path="/planilhas" element={<Private><SpreadsheetsPage /></Private>} />
                  <Route path="/planilhas/:id" element={<Private><SpreadsheetPage /></Private>} />
                  <Route path="/clientes" element={<Private><ClientsPage /></Private>} />
                  <Route path="/clientes/:id" element={<Private><ClientPage /></Private>} />
                  <Route path="/assistente" element={<Private><AssistantPage /></Private>} />
                  <Route path="/assistente/:id" element={<Private><AssistantPage /></Private>} />
                  <Route path="/atividade" element={<Private><ActivityPage /></Private>} />
                  <Route path="/admin" element={<Private><AdminOnly><AdminPage /></AdminOnly></Private>} />
                  <Route path="/conta" element={<Private><AccountPage /></Private>} />
                  <Route path="*" element={<Private><NotFoundPage /></Private>} />
                </Routes>
              </AssistantProvider>
            </SessionProvider>
          </ConfirmProvider>
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
