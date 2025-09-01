import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@/types/audit';

const API_BASE_URL = `${window.location.origin}/api`;

interface AuthContextType {
  user: User | null;
  // Auditors continue to use hardcoded credential login:
  login: (email: string, password: string) => boolean;
  // Everyone else uses OTP:
  sendOtp: (email: string) => Promise<boolean>;
  verifyOtp: (email: string, otp: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ⬇️ Keep ONLY the auditor hardcoded credential (per requirement)
// (User & Approver no longer use password; they switch to OTP)
const HARDCODED_AUDITORS: Record<string, { password: string; user: User }> = {
  'santosh.kumar@protivitiglobal.com': {
    password: 'santosh',
    user: {
      email: 'santosh.kumar@protivitiglobal.com',
      role: 'auditor',
      name: 'Santosh Kumar'
    }
  }
};

// Utility: normalize to full company email if username provided
const normalizeEmail = (raw: string) => {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return s;
  return s.includes('@') ? s : `${s}@premierenergies.com`;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('audit_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  // Hardcoded login for auditors (unchanged)
  const login = (email: string, password: string): boolean => {
    const userRecord = HARDCODED_AUDITORS[email];
    if (userRecord && userRecord.password === password) {
      setUser(userRecord.user);
      localStorage.setItem('audit_user', JSON.stringify(userRecord.user));
      return true;
    }
    return false;
  };

  // Send OTP (EMP-validated server path)
  const sendOtp = async (email: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  // Verify OTP → resolve role from server → set user
  const verifyOtp = async (email: string, otp: string): Promise<boolean> => {
    const normalized = normalizeEmail(email);
    try {
      // 1) Verify OTP
      const res = await fetch(`${API_BASE_URL}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: normalized, otp })
      });

      if (!res.ok) return false;
      const payload: { message: string; empID?: number; empName?: string } = await res.json();

      // 2) Resolve role for dashboards (approver if in approver/CXO lists, else user)
      const roleRes = await fetch(
        `${API_BASE_URL}/resolve-role?email=${encodeURIComponent(normalized)}`,
        { credentials: 'include' }
      );
      const rolePayload: { role: User['role'] } = roleRes.ok
        ? await roleRes.json()
        : { role: 'user' };

      const authed: User = {
        email: normalized,
        role: rolePayload.role || 'user',
        name: payload.empName || normalized
      };

      setUser(authed);
      localStorage.setItem('audit_user', JSON.stringify(authed));
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('audit_user');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        sendOtp,
        verifyOtp,
        logout,
        isAuthenticated: !!user
      }}
    >
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