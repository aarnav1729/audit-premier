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

const queryClient = new QueryClient();

const AppContent = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Login />;
  }

  const getDashboardComponent = () => {
    switch (user?.role) {
      case 'auditor':
        return <AuditorDashboard />;
      case 'user':
        return <UserDashboard />;
      case 'approver':
        return <ApproverDashboard />;
      default:
        return <Navigate to="/" replace />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="flex-1">
        {getDashboardComponent()}
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
            <Route path="*" element={<AppContent />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;