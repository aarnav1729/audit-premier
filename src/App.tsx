import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { Login } from "@/components/Login";
import AppShell from "@/components/AppShell";
import { AuditorDashboard } from "@/pages/AuditorDashboard";
import { MyDashboard } from "@/pages/MyDashboard";

const queryClient = new QueryClient();

const AppContent = () => {
  const { isAuthenticated, user, ready } = useAuth();

  // ✅ Don't render Login until session bootstrap finishes
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  // AppContent()
  const getDashboardComponent = () => {
    switch (user?.role) {
      case "auditor":
        return <AuditorDashboard />;

      // ⬇️ Both roles land on the unified capability-stacking page
      case "user":
      case "approver":
      default:
        return <MyDashboard />;
    }
  };

  return (
    <AppShell>{getDashboardComponent()}</AppShell>
  );
};

/**
 * Route wrapper for the unified, capability-stacking dashboard at /my.
 * Mirrors AppContent's auth + layout so behavior is consistent.
 */
const ProtectedRoute = ({
  children,
  requireAuditor = false,
}: {
  children: React.ReactNode;
  requireAuditor?: boolean;
}) => {
  const { isAuthenticated, ready, user } = useAuth();

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  if (requireAuditor && user?.role !== "auditor") {
    return <Navigate to="/my" replace />;
  }

  return <AppShell>{children}</AppShell>;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppContent />} />
            <Route
              path="/my"
              element={
                <ProtectedRoute>
                  <MyDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="/my-dashboard" element={<Navigate to="/my" replace />} />
            <Route
              path="/auditor-dashboard"
              element={
                <ProtectedRoute requireAuditor>
                  <AuditorDashboard />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<AppContent />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
