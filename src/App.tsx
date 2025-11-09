import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { Login } from "@/components/Login";
import { Navbar } from "@/components/Navbar";
import { AuditorDashboard } from "@/pages/AuditorDashboard";
import { UserDashboard } from "@/pages/UserDashboard";
import { ApproverDashboard } from "@/pages/ApproverDashboard";
import { MyDashboard } from "@/pages/MyDashboard";

const queryClient = new QueryClient();

const AppContent = () => {
  const { isAuthenticated, user } = useAuth();

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
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="flex-1">{getDashboardComponent()}</main>
    </div>
  );
};

/**
 * Route wrapper for the unified, capability-stacking dashboard at /my.
 * Mirrors AppContent's auth + layout so behavior is consistent.
 */
const MyRoute = () => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="flex-1">
        <MyDashboard />
      </main>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Unified dashboard path */}
            <Route path="/my" element={<MyRoute />} />
            {/* Fallback to role-based AppContent for all other paths */}
            <Route path="*" element={<AppContent />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
