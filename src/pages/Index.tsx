import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

const Index = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Redirect to appropriate landing based on role
  switch (user?.role) {
    case "auditor":
      return <Navigate to="/auditor" replace />;
    case "user":
    case "approver":
      // Unified, capability-stacking page for non-auditors
      return <Navigate to="/my" replace />;
    default:
      // Unknown/non-standard roles also land on the unified page
      return <Navigate to="/my" replace />;
  }
};

export default Index;
