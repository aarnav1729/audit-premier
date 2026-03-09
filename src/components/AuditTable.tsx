import React, { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUpDown,
  CheckCircle2,
  Eye,
  Filter,
  FolderOpen,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Upload,
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
  viewer?: string;
}

type ViewComment = {
  id: string;
  who: string;
  when: string;
  text: string;
  role?: "Approver" | "CXO" | "PR" | "Auditor" | "User";
  source: "storage" | "evidence" | "review";
};

type ViewRow = {
  issue: AuditIssue;
  entity: string;
  subIndex: number;
  subCount: number;
};

function toAbsUrl(path?: string | null) {
  if (!path) return null;
  const cleaned = path.replace(/^\.*\/?/, "");
  return `${window.location.origin}/${cleaned}`;
}

function getQuarterLabel(date: string | Date | undefined | null): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return `Q${Math.floor(parsed.getMonth() / 3) + 1}`;
}

const splitEmails = (value: string) =>
  String(value || "")
    .toLowerCase()
    .split(/[;,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

const formatDateTime = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
};

const getRiskTone = (risk: string) =>
  risk === "high"
    ? "bg-red-100 text-red-700 border-red-200"
    : risk === "medium"
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : risk === "low"
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : "bg-slate-100 text-slate-700 border-slate-200";

const getStatusTone = (status: string) =>
  status === "Received"
    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
    : status === "Partially Received"
    ? "bg-amber-100 text-amber-700 border-amber-200"
    : status === "Closed"
    ? "bg-slate-200 text-slate-700 border-slate-300"
    : "bg-blue-100 text-blue-700 border-blue-200";

const compare = (a: unknown, b: unknown) => {
  if (typeof a === "string" && typeof b === "string") {
    const aDate = Date.parse(a);
    const bDate = Date.parse(b);
    if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) return aDate - bDate;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, {
    sensitivity: "base",
  });
};

export const AuditTable: React.FC<AuditTableProps> = ({
  auditIssues,
  showCreateButton = false,
  title = "Audit Issues",
  actionColumn,
  viewer,
}) => {
  const isControlled = auditIssues !== undefined;
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<keyof AuditIssue>("serialNumber");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [filterFiscalYear, setFilterFiscalYear] = useState("all");
  const [filterProcess, setFilterProcess] = useState("all");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterCxo, setFilterCxo] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFiles, setViewerFiles] = useState<DocItem[]>([]);
  const [viewerTitle, setViewerTitle] = useState("Files");
  const [viewerCanDelete, setViewerCanDelete] = useState(false);
  const [viewerIssueId, setViewerIssueId] = useState<string | null>(null);

  const commentRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const { comments: storedComments = [], addComment } = useAuditStorage() as any;

  const fetchIssues = async () => {
    if (isControlled) return;

    try {
      setError(null);
      const allUrl = new URL(`${API_BASE_URL}/audit-issues`);
      if (viewer) {
        allUrl.searchParams.set("viewer", viewer.toLowerCase());
        allUrl.searchParams.set("scope", "all");
      }

      let res = await fetch(allUrl.toString());

      if (res.status === 403 || res.status === 400) {
        const mineUrl = new URL(`${API_BASE_URL}/audit-issues`);
        if (viewer) {
          mineUrl.searchParams.set("viewer", viewer.toLowerCase());
          mineUrl.searchParams.set("scope", "mine");
        }
        res = await fetch(mineUrl.toString());
      }

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
    if (auditIssues !== undefined) {
      setIssues(auditIssues);
      setLoading(false);
      return;
    }

    fetchIssues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditIssues, viewer]);

  const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightText = (text: string, term: string) => {
    if (!term) return text;
    const safe = escapeRegExp(term);
    const regex = new RegExp(`(${safe})`, "gi");
    return String(text ?? "")
      .split(regex)
      .map((part, index) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={index} className="rounded bg-yellow-200 px-0.5 text-black">
            {part}
          </mark>
        ) : (
          <React.Fragment key={index}>{part}</React.Fragment>
        )
      );
  };

  const getRoleForEmail = (issue: AuditIssue, emailOrId?: string) => {
    const email = String(emailOrId || "").toLowerCase();
    if (!email) return undefined;
    if (splitEmails(issue.approver).includes(email)) return "Approver";
    if (splitEmails(issue.cxoResponsible).includes(email)) return "CXO";
    if (splitEmails(issue.personResponsible).includes(email)) return "PR";
    return undefined;
  };

  const isViewerPR = (issue: AuditIssue) =>
    !!viewer &&
    splitEmails(issue.personResponsible).includes(viewer.toLowerCase());

  const isViewerApproverOrCXO = (issue: AuditIssue) =>
    !!viewer &&
    (splitEmails(issue.approver).includes(viewer.toLowerCase()) ||
      splitEmails(issue.cxoResponsible).includes(viewer.toLowerCase()));

  const getConversation = (issue: AuditIssue): ViewComment[] => {
    const output: ViewComment[] = [];

    const stateComments = (storedComments || []).filter(
      (comment: any) => comment?.auditIssueId === issue.id && comment?.content
    );

    for (const comment of stateComments) {
      const role =
        comment.type === "review"
          ? ("Auditor" as const)
          : getRoleForEmail(issue, comment.userId) || ("User" as const);

      output.push({
        id: comment.id || `${issue.id}-sc-${output.length}`,
        who: comment.userName || comment.userId || "User",
        when:
          comment.createdAt ||
          comment.timestamp ||
          issue.updatedAt ||
          new Date().toISOString(),
        text: String(comment.content || ""),
        role,
        source: "storage",
      });
    }

    const evidence = Array.isArray(issue.evidenceReceived)
      ? issue.evidenceReceived
      : [];

    for (const evidenceItem of evidence) {
      const isText =
        !!evidenceItem?.content &&
        (String(evidenceItem?.fileName || "").toLowerCase() === "comment" ||
          String(evidenceItem?.fileName || "")
            .toLowerCase()
            .includes("justification"));

      if (!isText) continue;

      output.push({
        id: evidenceItem.id || `${issue.id}-ev-${output.length}`,
        who: evidenceItem.uploadedBy || "User",
        when:
          evidenceItem.uploadedAt || issue.updatedAt || new Date().toISOString(),
        text: String(evidenceItem.content || ""),
        role: getRoleForEmail(issue, evidenceItem.uploadedBy) || "User",
        source: "evidence",
      });
    }

    if (issue.reviewComments && String(issue.reviewComments).trim()) {
      output.push({
        id: `${issue.id}-rv`,
        who: "Auditor Review",
        when: issue.updatedAt || new Date().toISOString(),
        text: String(issue.reviewComments),
        role: "Auditor",
        source: "review",
      });
    }

    output.sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
    return output;
  };

  const filteredAndSorted = useMemo(() => {
    const term = searchTerm.toLowerCase();

    const filtered = issues.filter((issue) => {
      const valuesMatch =
        !term ||
        Object.values(issue).some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(term)
        );

      const commentsMatch =
        !term ||
        getConversation(issue).some(
          (comment) =>
            comment.who.toLowerCase().includes(term) ||
            comment.text.toLowerCase().includes(term)
        );

      const statusMatch =
        filterStatus === "all" || issue.currentStatus === filterStatus;
      const riskMatch = filterRisk === "all" || issue.riskLevel === filterRisk;
      const yearMatch =
        filterFiscalYear === "all" || issue.fiscalYear === filterFiscalYear;
      const processMatch =
        filterProcess === "all" || issue.process === filterProcess;
      const entityMatch =
        filterEntity === "all" ||
        String(issue.entityCovered || "")
          .toLowerCase()
          .split(/[;,]\s*/)
          .map((value) => value.trim())
          .filter(Boolean)
          .includes(filterEntity.toLowerCase());
      const cxoMatch =
        filterCxo === "all" ||
        String(issue.cxoResponsible || "")
          .toLowerCase()
          .split(/[;,]\s*/)
          .map((value) => value.trim())
          .filter(Boolean)
          .includes(filterCxo.toLowerCase());

      return (
        (valuesMatch || commentsMatch) &&
        statusMatch &&
        riskMatch &&
        yearMatch &&
        processMatch &&
        entityMatch &&
        cxoMatch
      );
    });

    filtered.sort((a, b) => {
      const base = compare(a[sortField], b[sortField]);
      return sortDirection === "asc" ? base : -base;
    });

    return filtered;
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
    storedComments,
  ]);

  const expandedRows = useMemo<ViewRow[]>(() => {
    const rows: ViewRow[] = [];
    const wantedEntity =
      filterEntity === "all" ? null : filterEntity.toLowerCase();

    for (const issue of filteredAndSorted) {
      const parts = String(issue.entityCovered || "")
        .split(/[;,]\s*/)
        .map((value) => value.trim())
        .filter(Boolean);

      if (parts.length <= 1) {
        const entity = issue.entityCovered || "";
        if (!wantedEntity || entity.toLowerCase() === wantedEntity) {
          rows.push({ issue, entity, subIndex: 0, subCount: 1 });
        }
        continue;
      }

      parts.forEach((entity, index) => {
        if (wantedEntity && entity.toLowerCase() !== wantedEntity) return;
        rows.push({
          issue,
          entity,
          subIndex: index,
          subCount: parts.length,
        });
      });
    }

    return rows;
  }, [filteredAndSorted, filterEntity]);

  const handleSort = (field: keyof AuditIssue) => {
    if (field === sortField) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortField(field);
    setSortDirection("asc");
  };

  const resetFilters = () => {
    setSearchTerm("");
    setFilterStatus("all");
    setFilterRisk("all");
    setFilterFiscalYear("all");
    setFilterProcess("all");
    setFilterEntity("all");
    setFilterCxo("all");
    setSortField("serialNumber");
    setSortDirection("asc");
  };

  const fiscalYears = Array.from(new Set(issues.map((issue) => issue.fiscalYear)))
    .filter(Boolean)
    .sort();
  const processes = Array.from(new Set(issues.map((issue) => issue.process)))
    .filter(Boolean)
    .sort();
  const entities = Array.from(
    new Set(
      issues.flatMap((issue) =>
        String(issue.entityCovered || "")
          .split(/[;,]\s*/)
          .map((value) => value.trim())
          .filter(Boolean)
      )
    )
  ).sort();
  const cxoResponsibles = Array.from(
    new Set(
      issues.flatMap((issue) =>
        String(issue.cxoResponsible || "")
          .split(/[;,]\s*/)
          .map((value) => value.trim())
          .filter(Boolean)
      )
    )
  ).sort();

  const summary = useMemo(() => {
    const total = expandedRows.length;
    const open = expandedRows.filter(
      ({ issue }) => issue.currentStatus !== "Closed"
    ).length;
    const awaitingEvidence = expandedRows.filter(({ issue }) =>
      ["To Be Received", "In Progress"].includes(issue.currentStatus)
    ).length;
    const locked = expandedRows.filter(
      ({ issue }) =>
        (issue as any).isLocked === 1 ||
        (issue as any).isLocked === true ||
        issue.evidenceStatus === "Accepted"
    ).length;

    return { total, open, awaitingEvidence, locked };
  }, [expandedRows]);

  const getAllFilesForIssue = (issue: AuditIssue): DocItem[] => {
    const rawAnnexure: any = (issue as any).annexure;
    let annexure: any[] = [];
    try {
      annexure = Array.isArray(rawAnnexure)
        ? rawAnnexure
        : JSON.parse(rawAnnexure || "[]");
    } catch {
      annexure = [];
    }

    const evidence = Array.isArray(issue.evidenceReceived)
      ? issue.evidenceReceived
      : [];

    const annexureDocs: DocItem[] = annexure.map((item: any, index: number) => ({
      id: `ann-${index}`,
      name: item?.name || `Annexure ${index + 1}`,
      path: item?.path || null,
      type: item?.type || null,
      size: item?.size || null,
      uploadedAt: item?.uploadedAt || null,
    }));

    const evidenceDocs: DocItem[] = evidence.map((item: any, index: number) => ({
      id: item?.id || `ev-${index}`,
      name: item?.fileName || item?.name || `Evidence ${index + 1}`,
      path: item?.path || null,
      type: item?.fileType || item?.type || null,
      size: item?.fileSize || item?.size || null,
      uploadedAt: item?.uploadedAt || null,
      content: item?.content || null,
      fileName: item?.fileName || null,
      fileType: item?.fileType || null,
    }));

    return [...annexureDocs, ...evidenceDocs];
  };

  const deleteEvidence = async (doc: DocItem) => {
    if (!viewerIssueId || !doc.id || !viewer) return;

    const res = await fetch(
      `${API_BASE_URL}/audit-issues/${viewerIssueId}/evidence/${encodeURIComponent(
        String(doc.id)
      )}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: viewer }),
      }
    );
    const payload = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      throw new Error(
        payload?.error || `Failed to remove evidence (HTTP ${res.status})`
      );
    }

    const issue = issues.find((item) => item.id === viewerIssueId);
    if (issue) {
      setViewerFiles(
        getAllFilesForIssue(issue).filter(
          (file) => String(file.id) !== String(doc.id)
        )
      );
    }

    if (!isControlled) await fetchIssues();
  };

  const uploadEvidencePost = async (
    issueId: string,
    files: File[],
    textEvidence: string,
    justification: string
  ) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("evidence", file));
    if (viewer) formData.append("uploadedBy", viewer);
    if (textEvidence) formData.append("textEvidence", textEvidence);
    if (justification) formData.append("justification", justification);

    const res = await fetch(`${API_BASE_URL}/audit-issues/${issueId}/evidence`, {
      method: "POST",
      body: formData,
    });
    const payload = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      throw new Error(payload?.error || `Upload failed (HTTP ${res.status})`);
    }

    if (!isControlled) await fetchIssues();
    alert(payload?.message || "Evidence uploaded.");
  };

  const handleUploadClick = (issue: AuditIssue) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      try {
        const files = Array.from(input.files || []);
        const textEvidence =
          window.prompt("Optional comment to include with upload:") || "";
        const justification =
          window.prompt("Optional justification (due date, etc.):") || "";
        await uploadEvidencePost(issue.id, files, textEvidence, justification);
      } catch (err: any) {
        alert(err?.message || "Failed to upload evidence.");
      }
    };
    input.click();
  };

  const handleManualClosure = async (issueId: string) => {
    if (!window.confirm("Are you sure you want to mark this issue as closed?")) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/audit-issues/${issueId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({} as any));
        throw new Error(payload?.error || "Failed to close issue");
      }
      await fetchIssues();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to close audit issue.");
    }
  };

  const openFileViewer = (issue: AuditIssue, entity: string, subIndex: number, subCount: number) => {
    setViewerTitle(
      `Files for #${issue.serialNumber}${
        subCount > 1 ? String.fromCharCode(97 + subIndex) : ""
      } - ${issue.process} / ${entity || issue.entityCovered}`
    );
    setViewerFiles(getAllFilesForIssue(issue));
    setViewerIssueId(issue.id);

    const locked =
      (issue as any).isLocked === 1 ||
      (issue as any).isLocked === true ||
      issue.evidenceStatus === "Accepted";

    const canDelete =
      !!viewer &&
      !locked &&
      splitEmails(issue.personResponsible).includes(viewer.toLowerCase());

    setViewerCanDelete(canDelete);
    setViewerOpen(true);
  };

  if (loading) {
    return <div className="rounded-3xl border bg-white/90 p-8 text-center">Loading audit issues...</div>;
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center text-red-700">
        {error}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <Card className="overflow-hidden rounded-[28px] border-slate-200/80 bg-white/90 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.5)]">
          <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(15,118,110,0.05))] pb-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  <ShieldCheck className="h-4 w-4" />
                  Issue Navigator
                </div>
                <CardTitle className="text-3xl font-semibold text-slate-950">
                  {title}
                </CardTitle>
                <p className="max-w-3xl text-sm text-slate-600">
                  Scan assigned issues faster, open the file bundle in one place,
                  and work comments or evidence directly from each issue card.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={isControlled ? undefined : fetchIssues}
                  disabled={isControlled}
                  className="rounded-2xl border-slate-200 bg-white"
                  title={
                    isControlled
                      ? "Refresh is handled by the parent"
                      : "Refresh"
                  }
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
                {showCreateButton && (
                  <Button
                    onClick={() => setCreateModalOpen(true)}
                    className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Issue
                  </Button>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Visible issues
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {summary.total}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Open
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {summary.open}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Awaiting evidence
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {summary.awaitingEvidence}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Locked
                </p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">
                  {summary.locked}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5 p-6">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search issues, comments, owners, observations..."
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleSort("serialNumber")}
                  className="flex h-12 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700"
                >
                  Sort by issue #
                  <ArrowUpDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="flex h-12 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700"
                >
                  Clear filters
                  <Filter className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <select
                value={filterStatus}
                onChange={(event) => setFilterStatus(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All statuses</option>
                <option value="Received">Received</option>
                <option value="Partially Received">Partially Received</option>
                <option value="To Be Received">To Be Received</option>
                <option value="In Progress">In Progress</option>
                <option value="Closed">Closed</option>
              </select>
              <select
                value={filterRisk}
                onChange={(event) => setFilterRisk(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All risks</option>
                <option value="high">High risk</option>
                <option value="medium">Medium risk</option>
                <option value="low">Low risk</option>
              </select>
              <select
                value={filterFiscalYear}
                onChange={(event) => setFilterFiscalYear(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All fiscal years</option>
                {fiscalYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
              <select
                value={filterProcess}
                onChange={(event) => setFilterProcess(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All processes</option>
                {processes.map((process) => (
                  <option key={process} value={process}>
                    {process}
                  </option>
                ))}
              </select>
              <select
                value={filterEntity}
                onChange={(event) => setFilterEntity(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All entities</option>
                {entities.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
              <select
                value={filterCxo}
                onChange={(event) => setFilterCxo(event.target.value)}
                className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-700"
              >
                <option value="all">All CXO owners</option>
                {cxoResponsibles.map((cxo) => (
                  <option key={cxo} value={cxo}>
                    {cxo}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-3 py-1">
                Sort: {String(sortField)} ({sortDirection})
              </span>
              {viewer && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  Viewer scoped to {viewer}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {expandedRows.length === 0 && (
            <Card className="rounded-[28px] border-dashed border-slate-300 bg-white/80">
              <CardContent className="py-14 text-center">
                <FolderOpen className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-4 text-lg font-semibold text-slate-900">
                  No issues match the current view
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Adjust the search or filters to bring issues back into scope.
                </p>
              </CardContent>
            </Card>
          )}

          {expandedRows.map(({ issue, entity, subIndex, subCount }) => {
            let annexure: any[] = [];
            try {
              const raw = (issue as any).annexure;
              annexure = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
            } catch {
              annexure = [];
            }

            const annexureLinks = (annexure || [])
              .filter((file) => file?.path)
              .slice(0, 3) as Array<{ name: string; path: string }>;

            const nonTextEvidence = (issue.evidenceReceived || []).filter(
              (file: any) => file?.path && file?.fileType !== "text/plain"
            );
            const totalFiles = annexure.length + (issue.evidenceReceived?.length || 0);
            const locked =
              (issue as any).isLocked === 1 ||
              (issue as any).isLocked === true ||
              issue.evidenceStatus === "Accepted";
            const conversation = getConversation(issue);

            return (
              <Card
                key={`${issue.id}:${subIndex}`}
                className="overflow-hidden rounded-[28px] border-slate-200/80 bg-white/95 shadow-[0_22px_45px_-36px_rgba(15,23,42,0.45)]"
              >
                <CardContent className="p-0">
                  <div className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(248,250,252,1),rgba(239,246,255,0.9))] px-6 py-5">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className="rounded-full border border-slate-200 bg-slate-950 px-3 py-1 text-xs text-white">
                            Issue #
                            {subCount <= 1
                              ? issue.serialNumber
                              : `${issue.serialNumber}${String.fromCharCode(
                                  97 + subIndex
                                )}`}
                          </Badge>
                          <Badge
                            className={`rounded-full border px-3 py-1 text-xs ${getStatusTone(
                              issue.currentStatus
                            )}`}
                          >
                            {issue.currentStatus}
                          </Badge>
                          <Badge
                            className={`rounded-full border px-3 py-1 text-xs ${getRiskTone(
                              issue.riskLevel
                            )}`}
                          >
                            {issue.riskLevel.toUpperCase()} RISK
                          </Badge>
                          {locked && (
                            <Badge className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs text-slate-700">
                              <Lock className="mr-1 h-3 w-3" />
                              Locked
                            </Badge>
                          )}
                          {issue.evidenceStatus && (
                            <Badge className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
                              Evidence: {issue.evidenceStatus}
                            </Badge>
                          )}
                        </div>

                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                            {highlightText(issue.process, searchTerm)}
                          </p>
                          <h3 className="mt-1 text-2xl font-semibold text-slate-950">
                            {subCount <= 1 ? (
                              highlightText(issue.entityCovered, searchTerm)
                            ) : (
                              <>
                                <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-sm text-white">
                                  {String.fromCharCode(97 + subIndex)}
                                </span>
                                {highlightText(entity, searchTerm)}
                              </>
                            )}
                          </h3>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-white/90 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Fiscal window
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {highlightText(issue.fiscalYear, searchTerm)} •{" "}
                              {highlightText(
                                issue.quarter || getQuarterLabel(issue.date),
                                searchTerm
                              )}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Target timeline
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {highlightText(issue.timeline || "—", searchTerm)}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Files attached
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {totalFiles}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-3">
                            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                              Last updated
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {formatDate(issue.updatedAt)}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex w-full flex-col gap-3 xl:max-w-[320px]">
                        <Button
                          variant="outline"
                          className="h-11 justify-between rounded-2xl border-slate-200 bg-white"
                          onClick={() =>
                            openFileViewer(issue, entity, subIndex, subCount)
                          }
                        >
                          <span className="inline-flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            Open file hub
                          </span>
                          <span className="text-xs text-slate-500">{totalFiles}</span>
                        </Button>

                        {isViewerPR(issue) && (
                          <Button
                            className="h-11 justify-between rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                            onClick={() => handleUploadClick(issue)}
                            disabled={locked}
                            title={locked ? "Locked after acceptance" : "Upload evidence"}
                          >
                            <span className="inline-flex items-center gap-2">
                              <Upload className="h-4 w-4" />
                              Upload evidence
                            </span>
                            <span className="text-xs text-white/70">
                              PR action
                            </span>
                          </Button>
                        )}

                        {!actionColumn && (
                          <Button
                            variant="secondary"
                            className="h-11 justify-between rounded-2xl"
                            onClick={() => handleManualClosure(issue.id)}
                            disabled={issue.currentStatus === "Closed" || locked}
                            title={
                              issue.currentStatus === "Closed"
                                ? "Already closed"
                                : locked
                                ? "Locked after acceptance"
                                : "Mark as closed"
                            }
                          >
                            <span className="inline-flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4" />
                              Mark closed
                            </span>
                          </Button>
                        )}

                        {actionColumn && (
                          <div className="rounded-[22px] border border-slate-200 bg-white p-3">
                            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              Review actions
                            </p>
                            {actionColumn(issue)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 px-6 py-6 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                    <div className="space-y-5">
                      <div className="grid gap-4 xl:grid-cols-2">
                        <section className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Observation
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                            {highlightText(issue.observation, searchTerm)}
                          </p>
                        </section>

                        <section className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Action required
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                            {highlightText(issue.actionRequired || "—", searchTerm)}
                          </p>
                        </section>

                        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Recommendation
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                            {highlightText(issue.recommendation, searchTerm)}
                          </p>
                        </section>

                        <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                            Management comment
                          </p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                            {highlightText(issue.managementComment || "—", searchTerm)}
                          </p>
                        </section>
                      </div>

                      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              Ownership map
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Keep PR, approver, and CXO routing visible while
                              you work each issue.
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-3">
                          {[
                            {
                              label: "Person responsible",
                              value: issue.personResponsible,
                            },
                            { label: "Approver", value: issue.approver },
                            {
                              label: "CXO responsible",
                              value: issue.cxoResponsible,
                            },
                          ].map(({ label, value }) => (
                            <div
                              key={label}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {label}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {splitEmails(value).length > 0 ? (
                                  splitEmails(value).map((email) => (
                                    <Badge
                                      key={`${label}-${email}`}
                                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                                    >
                                      {highlightText(email, searchTerm)}
                                    </Badge>
                                  ))
                                ) : (
                                  <span className="text-sm text-slate-400">—</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {issue.coOwner && (
                          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              CXO Co-owner
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {splitEmails(issue.coOwner).map((email) => (
                                <Badge
                                  key={`co-owner-${email}`}
                                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-700"
                                >
                                  {highlightText(email, searchTerm)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </section>
                    </div>

                    <div className="space-y-5">
                      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              File preview
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Quick access to annexures and uploaded evidence.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl"
                            onClick={() =>
                              openFileViewer(issue, entity, subIndex, subCount)
                            }
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Open all
                          </Button>
                        </div>

                        <div className="mt-4 space-y-2">
                          {annexureLinks.map((file, index) => {
                            const url = toAbsUrl(file.path);
                            return (
                              <a
                                key={`${file.name}-${index}`}
                                href={url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                                  <span className="truncate">{file.name}</span>
                                </span>
                                <span className="text-xs text-slate-400">
                                  Annexure
                                </span>
                              </a>
                            );
                          })}

                          {nonTextEvidence.slice(0, 3).map((file: any, index: number) => {
                            const url = toAbsUrl(file.path);
                            return (
                              <a
                                key={`${file.fileName}-${index}`}
                                href={url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                download
                                className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                              >
                                <span className="inline-flex min-w-0 items-center gap-2">
                                  <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                                  <span className="truncate">
                                    {file.fileName || "Evidence"}
                                  </span>
                                </span>
                                <span className="text-xs text-slate-400">
                                  Evidence
                                </span>
                              </a>
                            );
                          })}

                          {annexureLinks.length === 0 && nonTextEvidence.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                              No file attachments available.
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="rounded-[24px] border border-slate-200 bg-white p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              Comment timeline
                            </p>
                            <p className="mt-1 text-sm text-slate-500">
                              Evidence notes, reviewer comments, and stakeholder
                              responses are grouped here.
                            </p>
                          </div>
                          <Badge className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-600">
                            {conversation.length} entries
                          </Badge>
                        </div>

                        <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto pr-1">
                          {conversation.length === 0 && (
                            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
                              No comments or text evidence yet.
                            </div>
                          )}

                          {conversation.map((comment) => (
                            <article
                              key={comment.id}
                              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                              title={formatDateTime(comment.when)}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">
                                  {comment.who}
                                </p>
                                {comment.role && (
                                  <Badge className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-600">
                                    {comment.role}
                                  </Badge>
                                )}
                                <span className="text-xs text-slate-400">
                                  {formatDateTime(comment.when)}
                                </span>
                              </div>
                              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                {highlightText(comment.text, searchTerm)}
                              </p>
                            </article>
                          ))}
                        </div>

                        {viewer && isViewerApproverOrCXO(issue) && (
                          <div className="mt-4 rounded-[22px] border border-blue-100 bg-blue-50/60 p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
                              <MessageSquare className="h-4 w-4 text-blue-600" />
                              Add stakeholder comment
                            </div>
                            <Textarea
                              ref={(element) => {
                                commentRefs.current[issue.id] = element;
                              }}
                              rows={4}
                              placeholder="Add context for the assignee, auditor, or special viewer."
                              className="rounded-2xl border-blue-100 bg-white"
                            />
                            <div className="mt-3 flex justify-end">
                              <Button
                                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                                onClick={() => {
                                  const element = commentRefs.current[issue.id];
                                  const value = (element?.value || "").trim();
                                  if (!value) return;

                                  addComment?.({
                                    id: `${issue.id}-${Date.now()}`,
                                    auditIssueId: issue.id,
                                    userId: viewer,
                                    userName: viewer,
                                    content: value,
                                    type: "comment",
                                    createdAt: new Date().toISOString(),
                                  });

                                  if (element) element.value = "";
                                }}
                              >
                                Post comment
                              </Button>
                            </div>
                          </div>
                        )}
                      </section>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <DocumentViewer
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        files={viewerFiles}
        title={viewerTitle}
        canDeleteEvidence={viewerCanDelete}
        onDeleteEvidence={async (doc) => {
          try {
            await deleteEvidence(doc);
          } catch (err: any) {
            alert(err?.message || "Failed to remove evidence.");
          }
        }}
      />

      {createModalOpen && (
        <CreateAuditModal
          open={createModalOpen}
          onClose={() => {
            setCreateModalOpen(false);
            fetchIssues();
          }}
        />
      )}
    </>
  );
};
