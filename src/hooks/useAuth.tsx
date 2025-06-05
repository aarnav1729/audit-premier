
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/audit';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const HARDCODED_USERS: Record<string, { password: string; user: User }> = {
  'santosh.kumar@protivitiglobal.com': {
    password: 'santosh',
    user: {
      email: 'santosh.kumar@protivitiglobal.com',
      role: 'auditor',
      name: 'Santosh Kumar'
    }
  },
  'aarnav.singh@premierenergies.com': {
    password: '777',
    user: {
      email: 'aarnav.singh@premierenergies.com',
      role: 'user',
      name: 'Aarnav Singh'
    }
  },
  'aarnavsingh836@gmail.com': {
    password: '333',
    user: {
      email: 'aarnavsingh836@gmail.com',
      role: 'approver',
      name: 'Aarnav Singh (Approver)'
    }
  }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('audit_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const login = (email: string, password: string): boolean => {
    const userRecord = HARDCODED_USERS[email];
    if (userRecord && userRecord.password === password) {
      setUser(userRecord.user);
      localStorage.setItem('audit_user', JSON.stringify(userRecord.user));
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('audit_user');
  };

  return (
    <AuthContext.Provider value={{
      user,
      login,
      logout,
      isAuthenticated: !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
