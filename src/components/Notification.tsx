import React, { useEffect, useMemo, useState } from "react";
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
  CircleCheckBig,
  Unlock,
  PlusCircle,
  RefreshCw,
  Search,
  Filter,
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
  id: string; // unique notification id
  type: NotifType;
  severity: NotifSeverity;
  when: string; // ISO time
  issueId: string;
  serialNumber: number;
  caption: string;
  title: string;
  description?: string;
  observation?: string;
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

// Basic relative time without extra deps
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

function daysBetween(a: Date, b: Date) {
  return Math.ceil((a.getTime() - b.getTime()) / 86400000);
}

function isClosed(status?: string | null) {
  return String(status || "").toLowerCase() === "closed";
}

function toCaption(i: Issue) {
  return `${i.serialNumber ?? ""} – ${i.process ?? ""} / ${
    i.entityCovered ?? ""
  }`;
}

function iconForType(t: NotifType) {
  switch (t) {
    case "overdue":
      return <AlertTriangle className="h-4 w-4" />;
    case "due_soon":
      return <Clock className="h-4 w-4" />;
    case "review":
      return <CheckCircle2 className="h-4 w-4" />;
    case "evidence":
      return <FileUp className="h-4 w-4" />;
    case "comment":
      return <MessageSquare className="h-4 w-4" />;
    case "unlock":
      return <Unlock className="h-4 w-4" />;
    case "new_issue":
      return <PlusCircle className="h-4 w-4" />;
    default:
      return <Bell className="h-4 w-4" />;
  }
}

function chipStyle(t: NotifType, active: boolean) {
  const base =
    "px-2 py-1 rounded-full text-xs font-medium border transition-colors";
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

export const Notification: React.FC = () => {
  const { user } = useAuth();
  const me = (user?.email || "").toLowerCase();

  const [loading, setLoading] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Set<NotifType>>(
    () => new Set(TYPES_ORDER) // all on by default
  );
  const [lastSeen, setLastSeen] = useState<number>(() => {
    const v = localStorage.getItem("notifications:lastSeen");
    return v ? Number(v) : 0;
  });

  // Fetch the user's issues
  async function load() {
    if (!me) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${API_BASE_URL}/audit-issues`);
      url.searchParams.set("viewer", me);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Issue[] = await res.json();
      setIssues(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // Build notifications from issues
  const notifications = useMemo<NotificationItem[]>(() => {
    const out: NotificationItem[] = [];
    const today = new Date();

    for (const i of issues) {
      const caption = toCaption(i);

      // 1) Due / Overdue (ignore Closed)
      if (!isClosed(i.currentStatus) && i.timeline) {
        const due = new Date(i.timeline);
        if (!isNaN(due.getTime())) {
          const dLeft = daysBetween(due, today) * -1; // positive if in future
          if (dLeft >= 0 && dLeft <= 3) {
            out.push({
              id: `${i.id}#due_${i.timeline}`,
              type: "due_soon",
              severity: "warn",
              when: i.timeline!,
              issueId: i.id,
              serialNumber: i.serialNumber,
              caption,
              title: `Due in ${dLeft} day${dLeft === 1 ? "" : "s"}`,
              description: `Due date: ${i.timeline}`,
              observation: i.observation,
            });
          } else if (due < today) {
            const dOver = daysBetween(today, due);
            out.push({
              id: `${i.id}#overdue_${i.timeline}`,
              type: "overdue",
              severity: "critical",
              when: i.timeline!,
              issueId: i.id,
              serialNumber: i.serialNumber,
              caption,
              title: `Overdue by ${dOver} day${dOver === 1 ? "" : "s"}`,
              description: `Was due on ${i.timeline}`,
              observation: i.observation,
            });
          }
        }
      }

      // 2) Review decision (based on current evidenceStatus)
      const es = (i.evidenceStatus || "").trim();
      if (["Accepted", "Insufficient", "Partially Accepted"].includes(es)) {
        out.push({
          id: `${i.id}#review_${es}_${i.updatedAt || ""}`,
          type: "review",
          severity: es === "Insufficient" ? "warn" : "info",
          when: i.updatedAt || i.createdAt || new Date().toISOString(),
          issueId: i.id,
          serialNumber: i.serialNumber,
          caption,
          title:
            es === "Accepted"
              ? "Evidence Accepted"
              : es === "Partially Accepted"
              ? "Evidence Partially Accepted"
              : "Evidence Insufficient",
          observation: i.observation,
        });
      }

      // 3) New issue (recent)
      if (i.createdAt) {
        const created = new Date(i.createdAt);
        const days = daysBetween(new Date(), created);
        if (!isNaN(created.getTime()) && days <= 30) {
          out.push({
            id: `${i.id}#new_${i.createdAt}`,
            type: "new_issue",
            severity: "info",
            when: i.createdAt,
            issueId: i.id,
            serialNumber: i.serialNumber,
            caption,
            title: "New audit issue created",
            observation: i.observation,
          });
        }
      }

      // 4) Evidence + Comments + Unlocks from evidenceReceived
      const ev = Array.isArray(i.evidenceReceived) ? i.evidenceReceived : [];
      for (let idx = 0; idx < ev.length; idx++) {
        const e = ev[idx];
        const when = e.uploadedAt || i.updatedAt || i.createdAt || "";
        const name = (e.fileName || "").toLowerCase();
        const isComment =
          name === "comment" ||
          (e.fileType || "").toLowerCase() === "text/plain";
        const isUnlock =
          name === "system" &&
          (e.content || "").toLowerCase().includes("unlocked");
        const nType: NotifType = isUnlock
          ? "unlock"
          : isComment
          ? "comment"
          : name.includes("justification")
          ? "comment"
          : "evidence";

        out.push({
          id: `${i.id}#ev_${idx}_${when}`,
          type: nType,
          severity:
            nType === "unlock" ? "info" : nType === "comment" ? "info" : "info",
          when,
          issueId: i.id,
          serialNumber: i.serialNumber,
          caption,
          title:
            nType === "comment"
              ? `New comment by ${e.uploadedBy || "User"}`
              : nType === "unlock"
              ? "Issue unlocked by auditor"
              : `Evidence uploaded by ${e.uploadedBy || "User"}`,
          description:
            (e.content && e.content.slice(0, 240)) ||
            (e.fileName && `File: ${e.fileName}`) ||
            undefined,
          observation: i.observation,
        });
      }
    }

    // Sort: newest first, then by importance
    out.sort((a, b) => {
      const ta = new Date(a.when || 0).getTime();
      const tb = new Date(b.when || 0).getTime();
      if (tb !== ta) return tb - ta;
      return TYPES_ORDER.indexOf(a.type) - TYPES_ORDER.indexOf(b.type);
    });

    return out;
  }, [issues]);

  // Apply search + type filters
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notifications.filter((n) => {
      if (!filters.has(n.type)) return false;
      if (!q) return true;
      const hay = `${n.title} ${n.description || ""} ${n.caption} ${
        n.observation || ""
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [notifications, query, filters]);

  const unreadCount = useMemo(() => {
    if (!lastSeen) return filtered.length;
    return filtered.filter((n) => new Date(n.when).getTime() > lastSeen).length;
  }, [filtered, lastSeen]);

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

  function refresh() {
    load();
  }

  return (
    <div className="w-full mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-gray-700" />
          <h2 className="text-lg font-semibold text-gray-800">Notifications</h2>
          {unreadCount > 0 && (
            <Badge className="bg-blue-600 text-white">{unreadCount} new</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search notifications..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 pr-3 py-2 rounded-md border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={refresh}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>

        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-500">
          <Filter className="h-3.5 w-3.5" /> Filter:
        </span>
        {TYPES_ORDER.map((t) => (
          <button
            key={t}
            className={chipStyle(t, filters.has(t))}
            onClick={() => toggleFilter(t)}
            title={t}
          >
            <span className="inline-flex items-center gap-1">
              {iconForType(t)}{" "}
              <span className="capitalize">{t.replace("_", " ")}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="rounded-lg border border-gray-200 bg-white">
        {loading ? (
          <div className="p-6 text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-600">Error: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center text-gray-500">
            <CircleDashed className="h-6 w-6 mx-auto mb-2" />
            No notifications to show.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {filtered.map((n) => {
              const isUnread =
                !lastSeen || new Date(n.when).getTime() > lastSeen;
              return (
                <li key={n.id} className="p-4 hover:bg-gray-50/70 transition">
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 rounded-full p-2 ${
                        n.type === "overdue"
                          ? "bg-red-50 text-red-700"
                          : n.type === "due_soon"
                          ? "bg-amber-50 text-amber-800"
                          : n.type === "review"
                          ? "bg-emerald-50 text-emerald-800"
                          : n.type === "evidence"
                          ? "bg-blue-50 text-blue-800"
                          : n.type === "comment"
                          ? "bg-purple-50 text-purple-800"
                          : n.type === "unlock"
                          ? "bg-cyan-50 text-cyan-800"
                          : "bg-gray-50 text-gray-700"
                      }`}
                      aria-hidden
                    >
                      {iconForType(n.type)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-gray-800">
                          {n.title}
                        </span>
                        <span className="text-xs text-gray-500">
                          {relativeTime(n.when)}
                        </span>
                        <Badge
                          variant="outline"
                          className="border-gray-300 text-gray-700"
                        >
                          #{n.serialNumber}
                        </Badge>
                        {n.type === "overdue" && (
                          <Badge className="bg-red-600 text-white">
                            Overdue
                          </Badge>
                        )}
                        {n.type === "due_soon" && (
                          <Badge className="bg-amber-600 text-white">
                            Due soon
                          </Badge>
                        )}
                        {isUnread && (
                          <Badge className="bg-blue-600 text-white">New</Badge>
                        )}
                      </div>

                      <div className="text-sm text-gray-700 mt-0.5">
                        {n.caption}
                      </div>

                      {n.observation && (
                        <div className="text-sm text-gray-600 mt-2">
                          <span className="font-medium">Observation:</span>{" "}
                          {n.observation}
                        </div>
                      )}

                      {n.description && (
                        <div className="text-sm text-gray-600 mt-1">
                          {n.description}
                        </div>
                      )}

                      <div className="mt-3 flex items-center gap-2">
                        <a
                          href="https://audit.premierenergies.com"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
                          title="Open portal"
                        >
                          <Bell className="h-3.5 w-3.5" />
                          Open portal
                        </a>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Notification;
