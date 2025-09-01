import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  ArrowUpDown,
  Plus,
  Filter,
  RefreshCw,
  CheckCircle2,
  Paperclip,
  Eye,
  Lock,
} from "lucide-react";
import { AuditIssue } from "@/types/audit";
import { CreateAuditModal } from "./CreateAuditModal";
import { DocumentViewer, DocItem } from "@/components/DocumentViewer";
import { useAuditStorage } from "@/hooks/useAuditStorage";

const API_BASE_URL = `${window.location.origin}/api`;

interface AuditTableProps {
  auditIssues?: AuditIssue[];
  showCreateButton?: boolean;
  title?: string;
  actionColumn?: (issue: AuditIssue) => React.ReactNode;
}

/** Local view model for comments we’ll render in the new column */
type ViewComment = {
  id: string;
  who: string; // display name or email (kept for search)
  when: string; // ISO date string
  text: string; // the comment body
  role?: "Approver" | "CXO" | "PR" | "Auditor" | "User";
  source: "storage" | "evidence" | "review";
};

/**
 * CollapsibleText
 * - Shows up to `maxLines` (default 2), with "View more" / "View less" toggle
 * - Auto-hides the toggle if content fits within max lines
 * - Preserves whitespace and word breaks; supports highlighted (ReactNode) output
 */
const CollapsibleText: React.FC<{
  text: string;
  render: (s: string) => React.ReactNode;
  maxLines?: number;
  className?: string;
  title?: string;
}> = ({ text, render, maxLines = 2, className = "", title }) => {
  const [expanded, setExpanded] = useState(false);
  const [needsClamp, setNeedsClamp] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Compute whether content exceeds the collapsed height
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    // Temporarily force collapsed styles for measurement
    const collapsedStyles: Partial<CSSStyleDeclaration> = {
      display: "-webkit-box",
      WebkitBoxOrient: "vertical" as any,
      WebkitLineClamp: String(maxLines) as any,
      overflow: "hidden",
    };

    const prevDisplay = el.style.display;
    const prevOrient = (el.style as any).WebkitBoxOrient;
    const prevClamp = (el.style as any).WebkitLineClamp;
    const prevOverflow = el.style.overflow;

    el.style.display = collapsedStyles.display as string;
    (el.style as any).WebkitBoxOrient = collapsedStyles.WebkitBoxOrient;
    (el.style as any).WebkitLineClamp = collapsedStyles.WebkitLineClamp;
    el.style.overflow = collapsedStyles.overflow as string;

    const raf = requestAnimationFrame(() => {
      if (el.scrollHeight > el.clientHeight + 1) {
        setNeedsClamp(true);
      } else {
        setNeedsClamp(false);
      }

      // Restore (will be applied again via inline style if !expanded)
      el.style.display = prevDisplay;
      (el.style as any).WebkitBoxOrient = prevOrient;
      (el.style as any).WebkitLineClamp = prevClamp;
      el.style.overflow = prevOverflow;
    });

    return () => cancelAnimationFrame(raf);
  }, [text, maxLines]);

  const collapsedStyle: React.CSSProperties = expanded
    ? {}
    : {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical" as any,
        WebkitLineClamp: maxLines as any,
        overflow: "hidden",
      };

  const splitEntities = (s: string) =>
    String(s || "")
      .split(/[;,]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <div className={className}>
      <div
        ref={boxRef}
        style={collapsedStyle}
        className="whitespace-pre-wrap break-words"
        title={title || text}
      >
        {render(text)}
      </div>
      {needsClamp && (
        <button
          type="button"
          className="mt-1 text-xs text-blue-600 hover:underline"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? "View less" : "View more"}
        </button>
      )}
    </div>
  );
};

function toAbsUrl(p?: string | null) {
  if (!p) return null;
  const cleaned = p.replace(/^\.*\/?/, "");
  return `${window.location.origin}/${cleaned}`;
}

export const AuditTable: React.FC<AuditTableProps> = ({
  auditIssues,
  showCreateButton = false,
  title = "Audit Issues",
  actionColumn,
}) => {
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<keyof AuditIssue>("serialNumber");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [filterFiscalYear, setFilterFiscalYear] = useState<string>("all");
  const [filterProcess, setFilterProcess] = useState<string>("all");

  // NEW: filters for Entity and CXO Responsible
  const [filterEntity, setFilterEntity] = useState<string>("all");
  const [filterCxo, setFilterCxo] = useState<string>("all");

  const [createModalOpen, setCreateModalOpen] = useState(false);

  // NEW: document viewer
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFiles, setViewerFiles] = useState<DocItem[]>([]);
  const [viewerTitle, setViewerTitle] = useState<string>("Files");

  // Pull any stored comments from the audit storage (used by Approver/Auditor addComment)
  // Default to [] to avoid any runtime issues if not present.
  const { comments: storedComments = [] } = useAuditStorage() as any;

  // fetch from API
  const fetchIssues = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/audit-issues`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data: AuditIssue[] = await res.json();
      setIssues(data);
    } catch (err) {
      console.error(err);
      setError("Failed to load audit issues.");
    } finally {
           setLoading(false);
    }
  };

  useEffect(() => {
    if (auditIssues && auditIssues.length) {
      setIssues(auditIssues);
      setLoading(false);
      return;
    }
    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightText = (text: string, term: string) => {
    if (!term) return text;
    const safe = escapeRegExp(term);
    const re = new RegExp(`(${safe})`, "gi");
    const parts = String(text ?? "").split(re);
    return parts.map((part, i) =>
      re.test(part) ? (
        <mark key={i} className="bg-yellow-200 text-black rounded px-0.5">
          {part}
        </mark>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );
  };

  const compare = (a: any, b: any) => {
    // dates
    if (typeof a === "string" && typeof b === "string") {
      const aDate = Date.parse(a);
      const bDate = Date.parse(b);
      if (!isNaN(aDate) && !isNaN(bDate)) {
        return aDate - bDate;
      }
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    }
    if (typeof a === "number" && typeof b === "number") return a - b;
    return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
      sensitivity: "base",
    });
  };

  const handleSort = (field: keyof AuditIssue) => {
    if (field === sortField) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getRiskBadgeColor = (r: string) =>
    r === "high"
      ? "bg-red-500"
      : r === "medium"
      ? "bg-yellow-500"
      : r === "low"
      ? "bg-green-500"
      : "bg-gray-500";

  const getStatusBadgeColor = (s: string) =>
    s === "Received"
      ? "bg-green-500"
      : s === "Partially Received"
      ? "bg-yellow-400"
      : s === "Closed"
      ? "bg-gray-600"
      : "bg-orange-500";

  const splitEmails = (s: string) =>
    String(s || "")
      .toLowerCase()
      .split(/[;,]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);

  const getRoleForEmail = (issue: AuditIssue, emailOrId?: string) => {
    const e = String(emailOrId || "").toLowerCase();
    if (!e) return undefined;
    if (splitEmails(issue.approver).includes(e)) return "Approver";
    if (splitEmails(issue.cxoResponsible).includes(e)) return "CXO";
    if (splitEmails(issue.personResponsible).includes(e)) return "PR";
    return undefined;
  };

  /** Build a unified conversation list for an issue */
  const getConversation = (issue: AuditIssue): ViewComment[] => {
    const out: ViewComment[] = [];

    // 1) Stored comments from state (covers Approver, Auditor, PR, etc.)
    const sc = (storedComments || []).filter(
      (c: any) => c?.auditIssueId === issue.id && c?.content
    );
    for (const c of sc) {
      const role =
        c.type === "review"
          ? ("Auditor" as const)
          : getRoleForEmail(issue, c.userId) || ("User" as const);

      out.push({
        id: c.id || `${issue.id}-sc-${out.length}`,
        who: c.userName || c.userId || "User",
        when:
          c.createdAt ||
          c.timestamp ||
          issue.updatedAt ||
          new Date().toISOString(),
        text: String(c.content || ""),
        role,
        source: "storage",
      });
    }

    // 2) Text-based evidence comments (user uploads / justification)
    const ev = Array.isArray(issue.evidenceReceived)
      ? issue.evidenceReceived
      : [];
    for (const e of ev) {
      const isText =
        !!e?.content &&
        (String(e?.fileName || "").toLowerCase() === "comment" ||
          String(e?.fileName || "")
            .toLowerCase()
            .includes("justification"));
      if (isText) {
        out.push({
          id: e.id || `${issue.id}-ev-${out.length}`,
          who: e.uploadedBy || "User",
          when: e.uploadedAt || issue.updatedAt || new Date().toISOString(),
          text: String(e.content || ""),
          role: getRoleForEmail(issue, e.uploadedBy) || "User",
          source: "evidence",
        });
      }
    }

    // 3) Auditor review comments on the issue itself
    if (issue.reviewComments && String(issue.reviewComments).trim()) {
      out.push({
        id: `${issue.id}-rv`,
        who: "Auditor Review",
        when: (issue as any).updatedAt || new Date().toISOString(),
        text: String(issue.reviewComments),
        role: "Auditor",
        source: "review",
      });
    }

    // Sort newest first
    out.sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
    return out;
  };

  const filteredAndSorted = useMemo(() => {
    const term = searchTerm.toLowerCase();

    let out = issues.filter((issue) => {
      const matchSearchBase =
        !term ||
        Object.values(issue).some((v) =>
          String(v ?? "")
            .toLowerCase()
            .includes(term)
        );

      // Include comments in search too (minimal extra work)
      const convo = getConversation(issue);
      const matchSearchComments =
        !term ||
        convo.some((c) => {
          return (
            c.who.toLowerCase().includes(term) ||
            c.text.toLowerCase().includes(term)
          );
        });

      const matchSearch = matchSearchBase || matchSearchComments;

      const matchStatus =
        filterStatus === "all" || issue.currentStatus === filterStatus;

      const matchRisk = filterRisk === "all" || issue.riskLevel === filterRisk;

      const matchYear =
        filterFiscalYear === "all" || issue.fiscalYear === filterFiscalYear;

      const matchProc =
        filterProcess === "all" || issue.process === filterProcess;

      // NEW: Entity filter (exact, case-insensitive)
      const matchEntity =
        filterEntity === "all" ||
        String(issue.entityCovered || "")
          .toLowerCase()
          .split(/[;,]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
          .includes(filterEntity.toLowerCase());

      // NEW: CXO Responsible filter (handles multiple emails separated by , or ;)
      const matchCxo =
        filterCxo === "all" ||
        String(issue.cxoResponsible || "")
          .toLowerCase()
          .split(/[;,]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
          .includes(filterCxo.toLowerCase());

      return (
        matchSearch &&
        matchStatus &&
        matchRisk &&
        matchYear &&
        matchProc &&
        matchEntity &&
        matchCxo
      );
    });

    out.sort((a, b) => {
      const aV = a[sortField] as any;
      const bV = b[sortField] as any;
      const base = compare(aV, bV);
      return sortDirection === "asc" ? base : -base;
    });

    return out;
  }, [
    issues,
    searchTerm,
    sortField,
    sortDirection,
    filterStatus,
    filterRisk,
    filterFiscalYear,
    filterProcess,
    filterEntity,
    filterCxo,
  ]);

  /** Expand issues into per-entity "sub-rows" for display */
  type ViewRow = {
    issue: AuditIssue;
    entity: string;
    subIndex: number; // 0 -> a, 1 -> b, ...
    subCount: number; // total split entities for this issue
  };

  const expandedRows = useMemo<ViewRow[]>(() => {
    const rows: ViewRow[] = [];
    const wantedEntity =
      filterEntity === "all" ? null : filterEntity.toLowerCase();

    for (const issue of filteredAndSorted) {
      const parts = String(issue.entityCovered || "")
        .split(/[;,]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (parts.length <= 1) {
        const entityStr = issue.entityCovered || "";
        if (!wantedEntity || entityStr.toLowerCase() === wantedEntity) {
          rows.push({
            issue,
            entity: entityStr,
            subIndex: 0,
            subCount: 1,
          });
        }
        continue;
      }

      parts.forEach((p, idx) => {
        if (wantedEntity && p.toLowerCase() !== wantedEntity) return;
        rows.push({
          issue,
          entity: p,
          subIndex: idx,
          subCount: parts.length,
        });
      });
    }

    return rows;
  }, [filteredAndSorted, filterEntity]);

  const handleManualClosure = async (issueId: string) => {
    if (!window.confirm("Are you sure you want to mark this issue as closed?"))
      return;

    try {
      const res = await fetch(`${API_BASE_URL}/audit-issues/${issueId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any));
        const msg = j?.error || "Failed to close issue";
        throw new Error(msg);
      }
      await fetchIssues(); // refresh data
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to close audit issue.");
    }
  };

  // unique lists for filters
  const fiscalYears = Array.from(
    new Set(issues.map((i) => i.fiscalYear))
  ).filter(Boolean);
  const processes = Array.from(new Set(issues.map((i) => i.process))).filter(
    Boolean
  );

  // NEW: entities list (from entityCovered)
  const entities = Array.from(
    new Set(
      issues.flatMap((i) =>
        String(i.entityCovered || "")
          .split(/[;,]\s*/)
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  );

  // NEW: CXO Responsible values split by comma/semicolon and flattened
  const cxoResponsibles = Array.from(
    new Set(
      issues
        .flatMap((i) =>
          String(i.cxoResponsible || "")
            .split(/[;,]\s*/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
        .filter(Boolean)
    )
  );

  // Helper: split and stack emails vertically; highlights search terms
  const renderEmails = (value: string) => {
    const parts = String(value || "")
      .split(/[;,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!parts.length) return <span className="text-gray-500">—</span>;

    return (
      <div className="flex flex-col gap-1">
        {parts.map((email, idx) => (
          <div key={idx} className="break-words" title={email}>
            {highlightText(email, searchTerm)}
          </div>
        ))}
      </div>
    );
  };

  // Build files list for viewer (annexure + evidence)
  const getAllFilesForIssue = (issue: AuditIssue): DocItem[] => {
    const annRaw: any = (issue as any).annexure;
    let annexure: any[] = [];
    try {
      annexure = Array.isArray(annRaw) ? annRaw : JSON.parse(annRaw || "[]");
    } catch {
      annexure = [];
    }

    const ev = Array.isArray(issue.evidenceReceived)
      ? issue.evidenceReceived
      : [];

    const annDocs: DocItem[] = (annexure || []).map((a: any, i: number) => ({
      id: `ann-${i}`,
      name: a?.name || `Annexure ${i + 1}`,
      path: a?.path || null,
      type: a?.type || null,
      size: a?.size || null,
      uploadedAt: a?.uploadedAt || null,
    }));

    const evDocs: DocItem[] = (ev || []).map((e: any, i: number) => ({
      id: e?.id || `ev-${i}`,
      name: e?.fileName || e?.name || `Evidence ${i + 1}`,
      path: e?.path || null,
      type: e?.fileType || e?.type || null,
      size: e?.fileSize || e?.size || null,
      uploadedAt: e?.uploadedAt || null,
      content: e?.content || null,
      fileName: e?.fileName || null,
      fileType: e?.fileType || null,
    }));

    return [...annDocs, ...evDocs];
  };

  if (loading)
    return <div className="p-6 text-center">Loading audit issues…</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex justify-between items-center gap-2 flex-wrap">
          <CardTitle className="text-xl font-semibold">{title}</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" onClick={fetchIssues} title="Refresh">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {showCreateButton && (
              <Button
                onClick={() => setCreateModalOpen(true)}
                className="bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center mt-4">
          <div className="relative flex-1 min-w-64">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search across all fields…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <Filter className="h-4 w-4 text-gray-500" />

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="border rounded p-2 w-44"
          >
            <option value="all">All Status</option>
            <option value="Received">Received</option>
            <option value="Partially Received">Partially Received</option>
            <option value="To Be Received">To Be Received</option>
            <option value="Closed">Closed</option>
          </select>

          <select
            value={filterRisk}
            onChange={(e) => setFilterRisk(e.target.value)}
            className="border rounded p-2 w-32"
          >
            <option value="all">All Risk</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select
            value={filterFiscalYear}
            onChange={(e) => setFilterFiscalYear(e.target.value)}
            className="border rounded p-2 w-32"
          >
            <option value="all">All Years</option>
            {fiscalYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <select
            value={filterProcess}
            onChange={(e) => setFilterProcess(e.target.value)}
            className="border rounded p-2 w-40"
          >
            <option value="all">All Processes</option>
            {processes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* NEW: Entity filter */}
          <select
            value={filterEntity}
            onChange={(e) => setFilterEntity(e.target.value)}
            className="border rounded p-2 w-44"
          >
            <option value="all">All Entities</option>
            {entities.map((ent) => (
              <option key={ent} value={ent}>
                {ent}
              </option>
            ))}
          </select>

          {/* NEW: CXO Responsible filter */}
          <select
            value={filterCxo}
            onChange={(e) => setFilterCxo(e.target.value)}
            className="border rounded p-2 w-56"
          >
            <option value="all">All CXO Responsible</option>
            {cxoResponsibles.map((cxo) => (
              <option key={cxo} value={cxo}>
                {cxo}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>

      <CardContent>
        {/* Scroll container for both axes to enable sticky header "freezepane" */}
        <div className="relative max-h-[70vh] overflow-auto">
          <Table className="w-full">
            {/* Use sticky on each header cell (th) for cross-browser reliability */}
            <TableHeader className="bg-white z-20">
              <TableRow>
                <TableHead
                  onClick={() => handleSort("serialNumber")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    S.No <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("fiscalYear")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    Fiscal Year <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("date")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    Date <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead
                  onClick={() => handleSort("process")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    Process <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Entity
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Observation
                </TableHead>
                <TableHead
                  onClick={() => handleSort("riskLevel")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    Risk Level <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Recommendation
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Management Comment
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Person Responsible
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  CXO Responsible
                </TableHead>

                {/* NEW: Attachments column */}
                <TableHead className="sticky top-0 z-30 bg-white">
                  Attachments
                </TableHead>

                {/* NEW: Comments column */}
                <TableHead className="sticky top-0 z-30 bg-white">
                  Comments
                </TableHead>

                <TableHead
                  onClick={() => handleSort("currentStatus")}
                  className="sticky top-0 z-30 bg-white cursor-pointer"
                >
                  <div className="flex items-center">
                    Status <ArrowUpDown className="ml-1 h-3 w-3" />
                  </div>
                </TableHead>
                <TableHead className="sticky top-0 z-30 bg-white">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {expandedRows.map(({ issue, entity, subIndex, subCount }) => {
                // Parse annexure safely (server may return string NVARCHAR)
                let annexure: any[] = [];
                try {
                  const raw = (issue as any).annexure;
                  annexure = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
                } catch {
                  annexure = [];
                }

                // Build small list of direct links for annexure
                const annexureLinks = (annexure || [])
                  .filter((a) => a?.path)
                  .slice(0, 3) as Array<{ name: string; path: string }>;

                const totalFiles =
                  annexure.length + (issue.evidenceReceived?.length || 0);

                const locked =
                  (issue as any).isLocked === 1 ||
                  (issue as any).isLocked === true ||
                  issue.evidenceStatus === "Accepted";

                // Compose conversation for this row
                const conversation = getConversation(issue);

                return (
                  <TableRow
                    key={`${issue.id}:${subIndex}`}
                    className="hover:bg-gray-50 align-top"
                  >
                    <TableCell className="font-medium">
                      {subCount <= 1
                        ? issue.serialNumber
                        : `${issue.serialNumber}${String.fromCharCode(
                            97 + subIndex
                          )}`}
                    </TableCell>

                    <TableCell>
                      {highlightText(issue.fiscalYear, searchTerm)}
                    </TableCell>
                    <TableCell>
                      {highlightText(
                        new Date(issue.date).toLocaleDateString(),
                        searchTerm
                      )}
                    </TableCell>
                    <TableCell>
                      {highlightText(issue.process, searchTerm)}
                    </TableCell>

                    <TableCell className="align-top">
                      {subCount <= 1 ? (
                        highlightText(issue.entityCovered, searchTerm)
                      ) : (
                        <div className="whitespace-pre-wrap break-words">
                          {String.fromCharCode(97 + subIndex)}
                          {") "}
                          {highlightText(entity, searchTerm)}
                        </div>
                      )}
                    </TableCell>

                    {/* Observation with collapsible 2-line clamp */}
                    <TableCell className="max-w-xs align-top">
                      <CollapsibleText
                        text={issue.observation}
                        title={issue.observation}
                        maxLines={2}
                        className=""
                        render={(t) => highlightText(t, searchTerm)}
                      />
                    </TableCell>

                    <TableCell>
                      <Badge
                        className={`${getRiskBadgeColor(
                          issue.riskLevel
                        )} text-white`}
                      >
                        {issue.riskLevel.toUpperCase()}
                      </Badge>
                    </TableCell>

                    {/* Recommendation with collapsible 2-line clamp */}
                    <TableCell className="max-w-xs align-top">
                      <CollapsibleText
                        text={issue.recommendation}
                        title={issue.recommendation}
                        maxLines={2}
                        className=""
                        render={(t) => highlightText(t, searchTerm)}
                      />
                    </TableCell>

                    {/* Management Comment with collapsible 2-line clamp */}
                    <TableCell className="max-w-xs align-top">
                      <CollapsibleText
                        text={issue.managementComment || ""}
                        title={issue.managementComment || ""}
                        maxLines={2}
                        className=""
                        render={(t) => highlightText(t, searchTerm)}
                      />
                    </TableCell>

                    {/* Person Responsible — stack emails */}
                    <TableCell className="align-top">
                      {renderEmails(issue.personResponsible)}
                    </TableCell>

                    {/* CXO Responsible — stack emails (and optional Co-Owner) */}
                    <TableCell className="align-top">
                      {renderEmails(issue.cxoResponsible)}
                      {issue.coOwner && (
                        <div className="text-sm text-gray-500 mt-1">
                          <div className="font-medium">Co-Owner:</div>
                          <div className="mt-0.5">
                            {renderEmails(issue.coOwner)}
                          </div>
                        </div>
                      )}
                    </TableCell>

                    {/* NEW: Attachments */}
                    <TableCell className="align-top">
                      <div className="flex flex-col gap-1">
                        {annexureLinks.map((f, idx) => {
                          const url = toAbsUrl(f.path);
                          return (
                            <a
                              key={`${idx}-${f.name}`}
                              href={url || "#"}
                              target="_blank"
                              rel="noreferrer"
                              download
                              className="text-xs text-blue-600 underline inline-flex items-center gap-1"
                              title={f.name}
                            >
                              <Paperclip className="h-3 w-3" />
                              <span className="truncate max-w-[160px]">
                                {f.name}
                              </span>
                            </a>
                          );
                        })}
                        {annexureLinks.length === 0 && (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                        <button
                          type="button"
                          className="text-xs text-blue-600 underline inline-flex items-center gap-1 mt-1"
                          onClick={() => {
                            setViewerTitle(
                              `Files for #${issue.serialNumber}${
                                subCount > 1
                                  ? String.fromCharCode(97 + subIndex)
                                  : ""
                              } – ${issue.process} / ${
                                entity || issue.entityCovered
                              }`
                            );
                            setViewerFiles(getAllFilesForIssue(issue));
                            setViewerOpen(true);
                          }}
                          title="View all files (annexure + evidence)"
                        >
                          <Eye className="h-3 w-3" />
                          View All ({totalFiles})
                        </button>
                      </div>
                    </TableCell>

                    {/* NEW: Comments feed */}
                    <TableCell className="align-top max-w-xs">
                      {conversation.length === 0 ? (
                        <span className="text-xs text-gray-500">—</span>
                      ) : (
                        <div className="flex flex-col gap-2 max-h-40 overflow-y-auto pr-1">
                          {conversation.map((c) => (
                            <div
                              key={c.id}
                              className="rounded-md border border-gray-200 p-2 text-xs bg-white"
                              title={new Date(c.when).toLocaleString()}
                            >
                              <div className="flex justify-between gap-2 mb-1">
                                <span className="font-medium truncate">
                                  {c.who}
                                </span>
                                {c.role && (
                                  <span className="ml-2 shrink-0 text-[10px] px-1.5 py-0.5 rounded border bg-gray-50">
                                    {c.role}
                                  </span>
                                )}

                                <span className="text-gray-500 shrink-0">
                                  {new Date(c.when).toLocaleString()}
                                </span>
                              </div>
                              <div className="whitespace-pre-wrap break-words">
                                {highlightText(c.text, searchTerm)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge
                          className={`${getStatusBadgeColor(
                            issue.currentStatus
                          )} text-white`}
                        >
                          {issue.currentStatus}
                        </Badge>
                        {locked && (
                          <Badge className="bg-gray-700 inline-flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Locked
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {actionColumn ? (
                        actionColumn(issue)
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleManualClosure(issue.id)}
                          disabled={
                            issue.currentStatus === "Closed" ||
                            (issue as any).isLocked === 1 ||
                            (issue as any).isLocked === true ||
                            issue.evidenceStatus === "Accepted"
                          }
                          title={
                            issue.currentStatus === "Closed"
                              ? "Already closed"
                              : (issue as any).isLocked === 1 ||
                                (issue as any).isLocked === true ||
                                issue.evidenceStatus === "Accepted"
                              ? "Locked after acceptance"
                              : "Mark as Closed"
                          }
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Close
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {expandedRows.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No audit issues found matching your criteria.
            </div>
          )}
        </div>

        {/* Document viewer modal */}
        <DocumentViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          title={viewerTitle}
          files={viewerFiles}
        />
      </CardContent>

      {createModalOpen && (
        <CreateAuditModal
          open={createModalOpen}
          onClose={() => {
            setCreateModalOpen(false);
            fetchIssues();
          }}
        />
      )}
    </Card>
  );
};