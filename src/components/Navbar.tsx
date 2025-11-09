import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Shield, LogOut, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import logo from "./logo.png";

const API_BASE_URL = `${window.location.origin}/api`;

// split a semicolon/comma list into lowercased tokens
const splitEmails = (s?: string) =>
  String(s || "")
    .toLowerCase()
    .split(/[;,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();

  // Roles derived from RBAC across issues the user is part of
  const [rbacRoles, setRbacRoles] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    const loadRoles = async () => {
      try {
        const me = (user?.email || "").toLowerCase();
        if (!me) {
          if (active) setRbacRoles([]);
          return;
        }
        const url = new URL(`${API_BASE_URL}/audit-issues`);
        url.searchParams.set("viewer", me);
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (active) setRbacRoles([]);
          return;
        }
        const issues: any[] = await res.json();
        const seen = new Set<string>();
        for (const i of issues) {
          if (splitEmails(i.cxoResponsible).includes(me)) seen.add("CXO");
          if (splitEmails(i.approver).includes(me)) seen.add("Approver");
          if (splitEmails(i.personResponsible).includes(me))
            seen.add("Person Responsible");
        }
        const ordered = ["CXO", "Approver", "Person Responsible"].filter((r) =>
          seen.has(r)
        );
        if (active) setRbacRoles(ordered);
      } catch {
        if (active) setRbacRoles([]);
      }
    };
    loadRoles();
    return () => {
      active = false;
    };
  }, [user?.email]);

  const getBadgeColor = (label: string) => {
    switch (label) {
      case "AUDITOR":
        return "bg-blue-500";
      case "CXO":
        return "bg-amber-600";
      case "Approver":
        return "bg-purple-500";
      case "Person Responsible":
        return "bg-green-600";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <img src={logo} alt="CAM logo" className="h-24 md:h-16 w-auto" />
        </div>

        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <User className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {user?.name}
            </span>
            {/* Always show AUDITOR badge if applicable */}
            {(user?.role || "").toLowerCase() === "auditor" && (
              <Badge className={`${getBadgeColor("AUDITOR")} text-white`}>
                AUDITOR
              </Badge>
            )}
            {/* RBAC-derived roles across at least one issue */}
            {rbacRoles.map((r) => (
              <Badge key={r} className={`${getBadgeColor(r)} text-white`}>
                {r}
              </Badge>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="flex items-center space-x-2"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </Button>
        </div>
      </div>
    </nav>
  );
};
