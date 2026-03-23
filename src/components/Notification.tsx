import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  BellRing,
  AlertTriangle,
  Clock,
  FileUp,
  MessageSquare,
  CheckCircle2,
  CircleDashed,
  Unlock,
  PlusCircle,
  RefreshCw,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const API_BASE_URL = `${window.location.origin}/api`;

type EvidenceEntry = {
  id: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number | string;
  uploadedAt?: string;
  uploadedBy?: string;
  path?: string;
  content?: string;
};

type Issue = {
  id: string;
  serialNumber: number;
  process: string;
  entityCovered: string;
  observation?: string;
  timeline?: string | null;
  currentStatus?: string | null;
  evidenceStatus?: string | null;
  evidenceReceived?: EvidenceEntry[];
  createdAt?: string;
  updatedAt?: string;
  personResponsible?: string;
  approver?: string;
  cxoResponsible?: string;
  riskLevel?: string;
};

type NotifType =
  | "overdue"
  | "due_soon"
  | "new_issue"
  | "review"
  | "evidence"
  | "comment"
  | "unlock"
  | "other";

type NotifSeverity = "info" | "warn" | "critical";

type NotificationItem = {
  id: string;
  type: NotifType;
  severity: NotifSeverity;
  when: string;
  issueId: string;
  serialNumber: number;
  caption: string;
  title: string;
  description?: string;
  observation?: string;
  searchText: string;
};

const TYPES_ORDER: NotifType[] = [
  "overdue",
  "due_soon",
  "review",
  "evidence",
  "comment",
  "unlock",
  "new_issue",
  "other",
];

function relativeTime(iso?: string) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, Math.abs(now - t));
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(a: Date, b: Date) {
  return Math.round(
    (startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000
  );
}

function isClosed(status?: string | null) {
  return String(status || "").toLowerCase() === "closed";
}

function toCaption(i: Issue) {
  return `${i.serialNumber ?? ""} - ${i.process ?? ""} / ${
    i.entityCovered ?? ""
  }`;
}

function iconForType(t: NotifType) {
  switch (t) {
    case "overdue":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    case "due_soon":
      return <Clock className="h-3.5 w-3.5" />;
    case "review":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "evidence":
      return <FileUp className="h-3.5 w-3.5" />;
    case "comment":
      return <MessageSquare className="h-3.5 w-3.5" />;
    case "unlock":
      return <Unlock className="h-3.5 w-3.5" />;
    case "new_issue":
      return <PlusCircle className="h-3.5 w-3.5" />;
    default:
      return <Bell className="h-3.5 w-3.5" />;
  }
}

function chipStyle(t: NotifType, active: boolean) {
  const base =
    "px-2 py-1 rounded-full text-[11px] font-medium border transition-colors";
  const map: Record<NotifType, string> = {
    overdue: "border-red-200 text-red-700 bg-red-50",
    due_soon: "border-amber-200 text-amber-800 bg-amber-50",
    review: "border-emerald-200 text-emerald-800 bg-emerald-50",
    evidence: "border-blue-200 text-blue-800 bg-blue-50",
    comment: "border-purple-200 text-purple-800 bg-purple-50",
    unlock: "border-cyan-200 text-cyan-800 bg-cyan-50",
    new_issue: "border-slate-200 text-slate-800 bg-slate-50",
    other: "border-gray-200 text-gray-700 bg-gray-50",
  };
  const activeRing = active ? " ring-2 ring-offset-1 ring-black/5" : "";
  return `${base} ${map[t]}${activeRing}`;
}

const severityRank: Record<NotifSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

function buildSearchText(issue: Issue, ...parts: Array<unknown>) {
  return [
    issue.id,
    issue.serialNumber,
    `#${issue.serialNumber}`,
    issue.process,
    issue.entityCovered,
    issue.observation,
    issue.timeline,
    issue.currentStatus,
    issue.evidenceStatus,
    issue.personResponsible,
    issue.approver,
    issue.cxoResponsible,
    issue.createdAt,
    issue.updatedAt,
    issue.riskLevel,
    ...parts,
  ]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
}

export const Notification: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = (user?.email || "").toLowerCase();
  const isAuditor = user?.role === "auditor";
  const homePath = isAuditor ? "/auditor-dashboard" : "/my";

  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "severity" | "type">(
    "newest"
  );
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Set<NotifType>>(
    () => new Set(TYPES_ORDER)
  );
  const [lastSeen, setLastSeen] = useState<number>(() => {
    const v = localStorage.getItem("notifications:lastSeen");
    return v ? Number(v) : 0;
  });

  async function load() {
    if (!me) {
      setIssues([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const base = new URL(`${API_BASE_URL}/audit-issues`);
      base.searchParams.set("viewer", me);
      if (isAuditor) base.searchParams.set("scope", "all");

      let res = await fetch(base.toString());
      if (!res.ok && isAuditor) {
        const fallback = new URL(`${API_BASE_URL}/audit-issues`);
        fallback.searchParams.set("viewer", me);
        fallback.searchParams.set("scope", "mine");
        res = await fetch(fallback.toString());
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Issue[] = await res.json();
      setIssues(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load";
      setError(message);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, isAuditor]);

  const notifications = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = [];
    const today = startOfDay(new Date());

    for (const issue of issues) {
      const caption = toCaption(issue);

      if (!isClosed(issue.currentStatus) && issue.timeline) {
        const due = new Date(issue.timeline);
        if (!Number.isNaN(due.getTime())) {
          const normalizedDue = startOfDay(due);
          const daysUntil = daysBetween(normalizedDue, today);
          if (daysUntil >= 0 && daysUntil <= 3) {
            out.push({
              id: `${issue.id}#due_${issue.timeline}`,
              type: "due_soon",
              severity: "warn",
              when: issue.timeline,
              issueId: issue.id,
              serialNumber: issue.serialNumber,
              caption,
              title: `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
              description: `Due date: ${normalizedDue.toLocaleDateString()}`,
              observation: issue.observation,
              searchText: buildSearchText(
                issue,
                "due soon",
                normalizedDue.toLocaleDateString()
              ),
            });
          } else if (normalizedDue < today) {
            const overdueDays = Math.abs(daysUntil);
            out.push({
              id: `${issue.id}#overdue_${issue.timeline}`,
              type: "overdue",
              severity: "critical",
              when: issue.timeline,
              issueId: issue.id,
              serialNumber: issue.serialNumber,
              caption,
              title: `Overdue by ${overdueDays} day${
                overdueDays === 1 ? "" : "s"
              }`,
              description: `Was due on ${normalizedDue.toLocaleDateString()}`,
              observation: issue.observation,
              searchText: buildSearchText(
                issue,
                "overdue",
                overdueDays,
                normalizedDue.toLocaleDateString()
              ),
            });
          }
        }
      }

      const evidenceStatus = (issue.evidenceStatus || "").trim();
      if (
        ["Accepted", "Insufficient", "Partially Accepted"].includes(
          evidenceStatus
        )
      ) {
        out.push({
          id: `${issue.id}#review_${evidenceStatus}_${issue.updatedAt || ""}`,
          type: "review",
          severity: evidenceStatus === "Insufficient" ? "warn" : "info",
          when: issue.updatedAt || issue.createdAt || new Date().toISOString(),
          issueId: issue.id,
          serialNumber: issue.serialNumber,
          caption,
          title:
            evidenceStatus === "Accepted"
              ? "Evidence accepted"
              : evidenceStatus === "Partially Accepted"
              ? "Evidence partially accepted"
              : "Evidence insufficient",
          description: issue.observation,
          observation: issue.observation,
          searchText: buildSearchText(
            issue,
            "review",
            evidenceStatus,
            issue.observation
          ),
        });
      }

      if (issue.createdAt) {
        const created = new Date(issue.createdAt);
        const ageDays = Math.abs(daysBetween(today, created));
        if (!Number.isNaN(created.getTime()) && ageDays <= 30) {
          out.push({
            id: `${issue.id}#new_${issue.createdAt}`,
            type: "new_issue",
            severity: "info",
            when: issue.createdAt,
            issueId: issue.id,
            serialNumber: issue.serialNumber,
            caption,
            title: "New audit issue created",
            description: issue.process,
            observation: issue.observation,
            searchText: buildSearchText(
              issue,
              "new issue",
              issue.process,
              issue.observation
            ),
          });
        }
      }

      const evidence = Array.isArray(issue.evidenceReceived)
        ? issue.evidenceReceived
        : [];
      evidence.forEach((entry, index) => {
        const when = entry.uploadedAt || issue.updatedAt || issue.createdAt || "";
        const name = (entry.fileName || "").toLowerCase();
        const isComment =
          name === "comment" ||
          (entry.fileType || "").toLowerCase() === "text/plain";
        const isUnlock =
          name === "system" &&
          (entry.content || "").toLowerCase().includes("unlocked");

        const type: NotifType = isUnlock
          ? "unlock"
          : isComment
          ? "comment"
          : "evidence";

        out.push({
          id: `${issue.id}#ev_${index}_${when}`,
          type,
          severity: type === "unlock" ? "info" : "info",
          when,
          issueId: issue.id,
          serialNumber: issue.serialNumber,
          caption,
          title:
            type === "comment"
              ? `New comment by ${entry.uploadedBy || "User"}`
              : type === "unlock"
              ? "Issue unlocked by auditor"
              : `Evidence uploaded by ${entry.uploadedBy || "User"}`,
          description:
            (entry.content && entry.content.slice(0, 220)) ||
            (entry.fileName && `File: ${entry.fileName}`) ||
            undefined,
          observation: issue.observation,
          searchText: buildSearchText(
            issue,
            type,
            entry.uploadedBy,
            entry.fileName,
            entry.fileType,
            entry.content
          ),
        });
      });
    }

    return out;
  }, [issues]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = notifications.filter((notification) => {
      if (!filters.has(notification.type)) return false;
      if (!q) return true;

      const haystack = [
        notification.title,
        notification.description || "",
        notification.caption,
        notification.observation || "",
        notification.type,
        notification.severity,
        notification.searchText,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });

    return [...rows].sort((a, b) => {
      if (sortBy === "type") {
        return TYPES_ORDER.indexOf(a.type) - TYPES_ORDER.indexOf(b.type);
      }
      if (sortBy === "severity") {
        return severityRank[a.severity] - severityRank[b.severity];
      }

      const ta = new Date(a.when || 0).getTime();
      const tb = new Date(b.when || 0).getTime();
      return sortBy === "oldest" ? ta - tb : tb - ta;
    });
  }, [notifications, query, filters, sortBy]);

  const unreadCount = useMemo(() => {
    if (!lastSeen) return filtered.length;
    return filtered.filter((n) => new Date(n.when).getTime() > lastSeen).length;
  }, [filtered, lastSeen]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filtered.slice(start, start + rowsPerPage);
  }, [filtered, page, rowsPerPage]);

  useEffect(() => {
    setPage(1);
  }, [query, sortBy, rowsPerPage, filters]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function toggleFilter(t: NotifType) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function markAllAsRead() {
    const now = Date.now();
    localStorage.setItem("notifications:lastSeen", String(now));
    setLastSeen(now);
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white/90 px-4 py-4 shadow-sm sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <BellRing className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Notifications
            </h2>
            {unreadCount > 0 && (
              <Badge className="bg-sky-600 text-[11px] text-white">
                {unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:min-w-[280px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search any field or issue #"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-slate-200 pl-8 pr-3 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(e.target.value as "newest" | "oldest" | "severity" | "type")
              }
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="severity">Severity</option>
              <option value="type">Type</option>
            </select>
            <select
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
            >
              <option value={10}>10 rows</option>
              <option value={20}>20 rows</option>
              <option value={50}>50 rows</option>
            </select>
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              Mark all read
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </span>
          {TYPES_ORDER.map((type) => (
            <button
              key={type}
              className={chipStyle(type, filters.has(type))}
              onClick={() => toggleFilter(type)}
              title={type}
            >
              <span className="inline-flex items-center gap-1">
                {iconForType(type)}
                <span className="capitalize">{type.replace("_", " ")}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        {loading ? (
          <div className="p-5 text-sm text-slate-500">Loading...</div>
        ) : error ? (
          <div className="p-5 text-sm text-red-600">Error: {error}</div>
        ) : paginated.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <CircleDashed className="mx-auto mb-2 h-5 w-5" />
            No notifications to show.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {paginated.map((notification) => {
              const isUnread =
                !lastSeen || new Date(notification.when).getTime() > lastSeen;

              return (
                <li
                  key={notification.id}
                  className="px-4 py-3 transition hover:bg-slate-50 sm:px-5"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 rounded-full p-2 ${
                        notification.type === "overdue"
                          ? "bg-red-50 text-red-700"
                          : notification.type === "due_soon"
                          ? "bg-amber-50 text-amber-800"
                          : notification.type === "review"
                          ? "bg-emerald-50 text-emerald-800"
                          : notification.type === "evidence"
                          ? "bg-blue-50 text-blue-800"
                          : notification.type === "comment"
                          ? "bg-purple-50 text-purple-800"
                          : notification.type === "unlock"
                          ? "bg-cyan-50 text-cyan-800"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {iconForType(notification.type)}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-900">
                          {notification.title}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {relativeTime(notification.when)}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-slate-300 text-[11px] text-slate-700"
                        >
                          #{notification.serialNumber}
                        </Badge>
                        {isUnread && (
                          <Badge className="bg-sky-600 text-[11px] text-white">
                            New
                          </Badge>
                        )}
                      </div>

                      <div className="text-xs text-slate-700">
                        {notification.caption}
                      </div>

                      {notification.observation && (
                        <div className="text-xs leading-5 text-slate-600">
                          <span className="font-medium">Observation:</span>{" "}
                          {notification.observation}
                        </div>
                      )}

                      {notification.description && (
                        <div className="text-xs leading-5 text-slate-500">
                          {notification.description}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg px-3 text-[11px]"
                          onClick={() => navigate(homePath)}
                        >
                          Open workspace
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Showing {filtered.length === 0 ? 0 : (page - 1) * rowsPerPage + 1}-
          {Math.min(page * rowsPerPage, filtered.length)} of {filtered.length}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Previous
          </Button>
          <span className="min-w-[72px] text-center text-[11px] text-slate-500">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={page === totalPages}
          >
            Next
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Notification;
