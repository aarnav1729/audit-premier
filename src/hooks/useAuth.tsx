// root/src/hooks/useAuth.tsx
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { User } from "@/types/audit";

const API_BASE_URL = `${window.location.origin}/api`;

interface AuthContextType {
  user: User | null;
  ready: boolean;
  // Optional legacy auditor password login (kept, but now normalized)
  login: (email: string, password: string) => boolean;

  // External auditors OTP
  sendOtp: (email: string) => Promise<boolean>;
  verifyOtp: (email: string, otp: string) => Promise<boolean>;

  // Session bootstrap/manual refresh (uses /api/session)
  trySsoLogin: () => Promise<boolean>;

  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ⬇️ Keep ONLY if you truly want password fallback.
// IMPORTANT: keys MUST be lowercase + full email.
const HARDCODED_AUDITORS: Record<string, { password: string; user: User }> = {
  // Keep domain consistent with server static list (recommend .in + .com both on server)
  "santosh.kumar@protivitiglobal.com": {
    password: "santosh",
    user: {
      email: "santosh.kumar@protivitiglobal.com",
      role: "auditor",
      name: "Santosh Kumar",
    },
  },

  // OPTIONAL (only if you want password fallback for yourself; change password)
  "aarnavsingh836@gmail.com": {
    password: "CHANGE_ME",
    user: {
      email: "aarnavsingh836@gmail.com",
      role: "auditor",
      name: "Aarnav Singh",
    },
  },
};

const INTERNAL_DOMAIN = "@premierenergies.com";

// Treat these as external auditors (OTP-based)
const AUDITOR_DOMAINS = ["@protivitiglobal.com", "@protivitiglobal.in"];

const isAuditorEmail = (email: string) => {
  const em = String(email || "")
    .trim()
    .toLowerCase();
  if (!em) return false;

  // explicit allow-list (already in your file)
  if (HARDCODED_AUDITORS[em]) return true;

  // domain-based (covers additional auditors without editing list every time)
  return AUDITOR_DOMAINS.some((d) => em.endsWith(d));
};

// Utility: normalize to full company email if username provided
const normalizeEmail = (raw: string) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  return s.includes("@") ? s : `${s}${INTERNAL_DOMAIN}`;
};

const isInternal = (email: string) => {
  const em = normalizeEmail(email);
  return !!em && em.endsWith(INTERNAL_DOMAIN);
};

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  // --- Session bootstrap: if SSO/OTP cookie exists, /api/session will succeed ---
  // root/src/hooks/useAuth.tsx
  // root/src/hooks/useAuth.tsx

  // --- Session bootstrap: if SSO cookie exists, /api/session will succeed ---
  const trySsoLogin = async () => {
    try {
      // ✅ Use /api/session because it returns email + name (and confirms cookie)
      const res = await fetch(`${API_BASE_URL}/session`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) return false;

      const data: any = await safeJson(res);
      const loggedIn = !!(data?.loggedIn || data?.authenticated || data?.email);
      if (!loggedIn) return false;

      const email = normalizeEmail(data?.email || "");
      if (!email) return false;

      // ✅ Resolve role (default to "user" if endpoint fails)
      let role: User["role"] = "user";
      try {
        const roleRes = await fetch(
          `${API_BASE_URL}/resolve-role?email=${encodeURIComponent(email)}`,
          { credentials: "include" }
        );
        const rolePayload: any = roleRes.ok ? await safeJson(roleRes) : null;
        role = (rolePayload?.role as User["role"]) || "user";
      } catch {
        role = "user";
      }

      const authedUser: User = {
        email,
        role,
        name: data?.empName || data?.name || email,
      };

      setUser(authedUser);
      localStorage.setItem("audit_user", JSON.stringify(authedUser));
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    // 1) Restore cached user quickly (UI responsive)
    const storedUserRaw = localStorage.getItem("audit_user");
    const storedUser: User | null = storedUserRaw
      ? JSON.parse(storedUserRaw)
      : null;
    if (storedUser) setUser(storedUser);

    // 2) Always attempt session bootstrap in background
    // If stored user is internal but session is missing/expired, we clear it.
    (async () => {
      try {
        const ok = await trySsoLogin();
        if (
          !ok &&
          storedUser?.email?.toLowerCase?.().endsWith(INTERNAL_DOMAIN)
        ) {
          setUser(null);
          localStorage.removeItem("audit_user");
        }
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hardcoded login for auditors (normalized + case-insensitive)
  const login = (email: string, password: string): boolean => {
    const key = normalizeEmail(email);
    const userRecord = HARDCODED_AUDITORS[key];
    if (userRecord && userRecord.password === password) {
      setUser(userRecord.user);
      localStorage.setItem("audit_user", JSON.stringify(userRecord.user));
      return true;
    }
    return false;
  };

  // Send OTP:
  // - Internal → server returns 409 with redirectUrl → we redirect to DIGI
  // - External auditors → send OTP email
  const sendOtp = async (email: string): Promise<boolean> => {
    const normalized = normalizeEmail(email);

    try {
      const res = await fetch(`${API_BASE_URL}/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: normalized }),
      });

      if (res.ok) return true;

      // Internal users: force SSO redirect
      // Internal users: force SSO redirect (ONLY for internal emails)
      if (res.status === 409 && isInternal(normalized)) {
        const j: any = await safeJson(res);
        if (j?.ssoRequired && j?.redirectUrl) {
          window.location.href = j.redirectUrl;
          return false;
        }
      }

      return false;
    } catch {
      return false;
    }
  };

  // Verify OTP:
  // - Internal → server returns 409 with redirectUrl → redirect to DIGI
  // - External auditors → verify OTP and set user
  const verifyOtp = async (email: string, otp: string): Promise<boolean> => {
    const normalized = normalizeEmail(email);

    try {
      const res = await fetch(`${API_BASE_URL}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: normalized, otp }),
      });

      if (res.status === 409 && isInternal(normalized)) {
        const j: any = await safeJson(res);
        if (j?.ssoRequired && j?.redirectUrl) {
          window.location.href = j.redirectUrl;
          return false;
        }
      }

      if (!res.ok) return false;

      const payload: { message: string; empID?: number; empName?: string } =
        (await safeJson(res)) || { message: "" };

      let role: User["role"] = "user";

      // ✅ External auditors must land as auditor (and should not depend on internal role resolver)
      if (isAuditorEmail(normalized)) {
        role = "auditor";
      } else {
        // internal or normal users: resolve role from server
        try {
          const roleRes = await fetch(
            `${API_BASE_URL}/resolve-role?email=${encodeURIComponent(
              normalized
            )}`,
            { credentials: "include" }
          );
          const rolePayload: any = roleRes.ok ? await safeJson(roleRes) : null;
          role = (rolePayload?.role as User["role"]) || "user";
        } catch {
          role = "user";
        }
      }

      const authedUser: User = {
        email: normalized,
        role,
        name: payload.empName || normalized,
      };

      setUser(authedUser);
      localStorage.setItem("audit_user", JSON.stringify(authedUser));
      return true;
    } catch {
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("audit_user");

    // Also clear server-side session cookie if backend supports it
    fetch(`${API_BASE_URL}/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});

    // Optional: if you have a Digi logout endpoint, redirect there
    // if (user?.email?.endsWith(INTERNAL_DOMAIN)) window.location.href = "https://digi.premierenergies.com/logout";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        ready,
        login,
        sendOtp,
        verifyOtp,
        trySsoLogin,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
