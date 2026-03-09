import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  LogOut,
  User,
  Menu,
  X,
  LayoutDashboard,
  Bell,
  ChevronDown,
  Settings,
} from "lucide-react";
import { toast } from "sonner";

interface NavbarProps {
  userRole?: string;
  userName?: string;
  userEmail?: string;
}

const Navbar = ({ userRole, userName, userEmail }: NavbarProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Scroll-aware header
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    toast.success("Signed out successfully");
    navigate("/");
  }, [navigate]);

  const isAuditor = userRole === "auditor" || userRole === "admin";
  const displayName = userName || userEmail?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const navLinks = [
    ...(isAuditor
      ? [
          {
            label: "Audit Dashboard",
            path: "/auditor-dashboard",
            icon: Shield,
          },
        ]
      : []),
    {
      label: "My Dashboard",
      path: "/my-dashboard",
      icon: LayoutDashboard,
    },
  ];

  const isActive = (path: string) => location.pathname === path;

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-50 h-[4.5rem]
        transition-all duration-300 ease-out
        ${
          scrolled
            ? "cam-frosted border-b shadow-sm"
            : "bg-transparent border-b border-transparent"
        }
      `}
    >
      <div className="cam-container h-full flex items-center justify-between">
        {/* ── Logo ── */}
        <button
          onClick={() =>
            navigate(isAuditor ? "/auditor-dashboard" : "/my-dashboard")
          }
          className="flex items-center gap-3 group"
        >
          <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white shadow-md group-hover:shadow-lg transition-shadow">
            <Shield className="w-[18px] h-[18px]" />
          </div>
          <div className="hidden sm:block">
            <span className="text-lg font-bold tracking-tight text-foreground">
              CAM
            </span>
            <span className="hidden md:inline text-xs text-muted-foreground ml-2 font-medium">
              Audit Management
            </span>
          </div>
        </button>

        {/* ── Desktop Nav Links ── */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(({ label, path, icon: Icon }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`
                relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-all duration-200
                ${
                  isActive(path)
                    ? "text-primary bg-primary/8"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }
              `}
            >
              <Icon className="w-4 h-4" />
              {label}
              {isActive(path) && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          ))}
        </nav>

        {/* ── Right Section ── */}
        <div className="flex items-center gap-2">
          {/* Notification bell */}
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-lg text-muted-foreground hover:text-foreground"
          >
            <Bell className="w-[18px] h-[18px]" />
          </Button>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center gap-2.5 px-2 py-1.5 h-auto rounded-xl hover:bg-muted/60"
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/90 to-primary flex items-center justify-center text-primary-foreground text-xs font-bold shadow-sm">
                  {initials}
                </div>
                <div className="hidden lg:block text-left">
                  <p className="text-sm font-semibold leading-none text-foreground">
                    {displayName}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {userRole || "User"}
                  </p>
                </div>
                <ChevronDown className="hidden lg:block w-3.5 h-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 rounded-xl shadow-lg border animate-in fade-in-0 zoom-in-95"
            >
              <DropdownMenuLabel className="font-normal py-3">
                <p className="text-sm font-semibold">{displayName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {userEmail}
                </p>
                {userRole && (
                  <Badge
                    variant="secondary"
                    className="mt-2 text-[10px] uppercase tracking-wider font-bold"
                  >
                    {userRole}
                  </Badge>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => navigate("/my-dashboard")}
                className="cursor-pointer gap-2 py-2"
              >
                <User className="w-4 h-4" />
                My Dashboard
              </DropdownMenuItem>
              {isAuditor && (
                <DropdownMenuItem
                  onClick={() => navigate("/auditor-dashboard")}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Shield className="w-4 h-4" />
                  Audit Dashboard
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="cursor-pointer gap-2 py-2">
                <Settings className="w-4 h-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={handleLogout}
                className="cursor-pointer gap-2 py-2 text-destructive focus:text-destructive"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden rounded-lg"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? (
              <X className="w-5 h-5" />
            ) : (
              <Menu className="w-5 h-5" />
            )}
          </Button>
        </div>
      </div>

      {/* ── Mobile Menu ── */}
      {mobileOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 cam-frosted border-b shadow-lg">
          <div className="cam-container py-3 flex flex-col gap-1">
            {navLinks.map(({ label, path, icon: Icon }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium
                  transition-colors
                  ${
                    isActive(path)
                      ? "text-primary bg-primary/8"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;