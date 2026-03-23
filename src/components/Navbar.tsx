import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  Bell,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  X,
} from "lucide-react";

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const isAuditor = user?.role === "auditor";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const navLinks = useMemo(
    () =>
      [
        {
          label: "My Workspace",
          path: "/my",
          icon: LayoutDashboard,
          description: "Assigned issues, evidence, comments",
        },
        {
          label: "Notifications",
          path: "/notifications",
          icon: Bell,
          description: "Alerts, reminders, and updates",
        },
        ...(isAuditor
          ? [
              {
                label: "Audit Control",
                path: "/auditor-dashboard",
                icon: Shield,
                description: "Review, analytics, audit admin",
              },
            ]
          : []),
      ] as Array<{
        label: string;
        path: string;
        icon: typeof LayoutDashboard;
        description: string;
      }>,
    [isAuditor]
  );

  const displayName = user?.name || user?.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isActive = (path: string) => {
    if (path === "/my") return location.pathname === "/my";
    return location.pathname.startsWith(path);
  };

  const homePath = isAuditor ? "/auditor-dashboard" : "/my";

  return (
    <header className="sticky top-0 z-50 px-4 pt-4 sm:px-6 lg:px-8">
      <div
        className={[
          "mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 rounded-[28px] border px-4 py-3 sm:px-5",
          "backdrop-blur-xl transition-all duration-200",
          scrolled
            ? "border-slate-200/80 bg-white/88 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.45)]"
            : "border-white/70 bg-white/72 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)]",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => navigate(homePath)}
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1d4ed8_0%,#0f766e_100%)] text-white shadow-lg shadow-blue-900/20">
            <Shield className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              CAM Platform
            </p>
            <p className="truncate text-lg font-semibold text-slate-950">
              Audit workspace
            </p>
          </div>
        </button>

        <nav className="hidden items-center gap-2 lg:flex">
          {navLinks.map(({ label, path, icon: Icon, description }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className={[
                "group flex min-w-[220px] items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all",
                isActive(path)
                  ? "border-blue-200 bg-blue-50 text-blue-950 shadow-sm"
                  : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white/80 hover:text-slate-900",
              ].join(" ")}
            >
              <div
                className={[
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
                  isActive(path)
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-500 group-hover:bg-slate-900 group-hover:text-white",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{label}</p>
                <p className="truncate text-xs text-slate-500">{description}</p>
              </div>
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="hidden rounded-2xl border border-transparent text-slate-500 hover:border-slate-200 hover:bg-white md:inline-flex"
            onClick={() => navigate("/notifications")}
          >
            <Bell className="h-4 w-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto rounded-2xl border border-slate-200/80 bg-white/80 px-2 py-2 hover:bg-white"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                  {initials || "U"}
                </div>
                <div className="hidden text-left sm:block">
                  <p className="max-w-[160px] truncate text-sm font-semibold text-slate-950">
                    {displayName}
                  </p>
                  <p className="max-w-[160px] truncate text-xs text-slate-500">
                    {user?.email}
                  </p>
                </div>
                {user?.role && (
                  <Badge
                    variant="secondary"
                    className="hidden border border-slate-200 bg-slate-100 text-[10px] uppercase tracking-[0.18em] text-slate-600 md:inline-flex"
                  >
                    {user.role}
                  </Badge>
                )}
                <ChevronDown className="ml-1 hidden h-4 w-4 text-slate-500 sm:block" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 rounded-2xl">
              <DropdownMenuLabel className="space-y-1 py-3">
                <p className="text-sm font-semibold text-slate-950">
                  {displayName}
                </p>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {navLinks.map(({ label, path, icon: Icon }) => (
                <DropdownMenuItem
                  key={path}
                  onClick={() => navigate(path)}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  logout();
                  navigate("/");
                }}
                className="cursor-pointer gap-2 py-2 text-red-600 focus:text-red-600"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-2xl border border-slate-200 bg-white/80 lg:hidden"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileOpen && (
        <div className="mx-auto mt-3 w-full max-w-[1600px] rounded-[28px] border border-slate-200/80 bg-white/94 p-3 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl lg:hidden">
          <div className="flex flex-col gap-2">
            {navLinks.map(({ label, path, icon: Icon, description }) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className={[
                  "flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
                  isActive(path)
                    ? "border-blue-200 bg-blue-50"
                    : "border-transparent bg-slate-50/70",
                ].join(" ")}
              >
                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">{label}</p>
                  <p className="text-xs text-slate-500">{description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;
