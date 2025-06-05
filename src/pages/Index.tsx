
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

const Index = () => {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Redirect to appropriate dashboard based on role
  switch (user?.role) {
    case 'auditor':
      return <Navigate to="/auditor" replace />;
    case 'user':
      return <Navigate to="/user" replace />;
    case 'approver':
      return <Navigate to="/approver" replace />;
    default:
      return <Navigate to="/" replace />;
  }
};

export default Index;
