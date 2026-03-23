import React, { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  onRefreshRequested?: () => Promise<void> | void;
}

type ViewMode = "list" | "table";

type ViewComment = {
  id: string;
  who: string;
  when: string;
  text: string;
  role?: "Approver" | "CXO" | "PR" | "Auditor" | "User";
  source: "storage" | "evidence" | "review";
};

type SortField =
  | "serialNumber"
  | "createdAt"
  | "timeline"
  | "process"
  | "entityCovered"
  | "personResponsible"
  | "currentStatus"
  | "riskLevel";

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

const getAgingTone = (days: number | null, closed: boolean) => {
  if (closed) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (days === null) return "border-slate-200 bg-slate-50 text-slate-600";
  if (days > 90) return "border-red-200 bg-red-50 text-red-700";
  if (days > 30) return "border-amber-200 bg-amber-50 text-amber-700";
  if (days > 0) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-blue-200 bg-blue-50 text-blue-700";
};

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

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDateValue = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const match = String(value)
    .trim()
    .match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  return Number.isNaN(candidate.getTime()) ? null : candidate;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const getDueDate = (issue: AuditIssue) =>
  parseDateValue(
    (issue as any).timeline ??
      (issue as any).dueDate ??
      (issue as any).targetDate ??
      (issue as any).expectedClosureDate ??
      null
  );

const isClosedEquivalent = (issue: AuditIssue) =>
  String(issue.currentStatus || "").toLowerCase() === "closed" ||
  String((issue as any).evidenceStatus || "").toLowerCase() === "accepted";

const getAgingInfo = (issue: AuditIssue) => {
  const dueDate = getDueDate(issue);
  const closed = isClosedEquivalent(issue);

  if (closed) {
    return { days: 0, label: "Closed", sortValue: -9999 };
  }

  if (!dueDate) {
    return { days: null as number | null, label: "No due date", sortValue: -9998 };
  }

  const today = startOfDay(new Date());
  const diff = Math.floor(
    (today.getTime() - startOfDay(dueDate).getTime()) / 86400000
  );

  if (diff > 0) {
    return { days: diff, label: `${diff} day${diff === 1 ? "" : "s"} overdue`, sortValue: diff };
  }

  if (diff === 0) {
    return { days: 0, label: "Due today", sortValue: 0 };
  }

  const ahead = Math.abs(diff);
  return {
    days: diff,
    label: `Due in ${ahead} day${ahead === 1 ? "" : "s"}`,
    sortValue: diff,
  };
};

const getObservationPreview = (value?: string | null) =>
  String(value || "—")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "—";

const buildExportRows = (rows: AuditIssue[]) =>
  rows.map((issue) => ({
    "Serial #": issue.serialNumber,
    Process: issue.process || "",
    Company: issue.entityCovered || "",
    Observation: issue.observation || "",
    "Action Required": issue.actionRequired || "",
    Recommendation: issue.recommendation || "",
    "Management Comment": issue.managementComment || "",
    "Person Responsible": issue.personResponsible || "",
    Approver: issue.approver || "",
    "CXO Responsible": issue.cxoResponsible || "",
    "Fiscal Year": issue.fiscalYear || "",
    Quarter: issue.quarter || getQuarterLabel(issue.date),
    "Created At": issue.createdAt || "",
    "Due Date": getDueDate(issue)?.toISOString().slice(0, 10) || "",
    Aging: getAgingInfo(issue).label,
    "Current Status": issue.currentStatus || "",
    "Evidence Status": issue.evidenceStatus || "",
    "Evidence Count": Array.isArray(issue.evidenceReceived)
      ? issue.evidenceReceived.length
      : 0,
    "Updated At": issue.updatedAt || "",
  }));

export const AuditTable: React.FC<AuditTableProps> = ({
  auditIssues,
  showCreateButton = false,
  title = "Audit Issues",
  actionColumn,
  viewer,
  onRefreshRequested,
}) => {
  const isControlled = auditIssues !== undefined;
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<SortField>("serialNumber");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [filterFiscalYear, setFilterFiscalYear] = useState("all");
  const [filterProcess, setFilterProcess] = useState("all");
  const [filterEntity, setFilterEntity] = useState("all");
  const [filterCxo, setFilterCxo] = useState("all");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [openIssueIds, setOpenIssueIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFiles, setViewerFiles] = useState<DocItem[]>([]);
  const [viewerTitle, setViewerTitle] = useState("Files");
  const [viewerCanDelete, setViewerCanDelete] = useState(false);
  const [viewerIssueId, setViewerIssueId] = useState<string | null>(null);
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null);
  const [commentIssueId, setCommentIssueId] = useState<string | null>(null);

  const commentRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const { comments: storedComments = [] } = useAuditStorage() as any;

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
      setIssues(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError("Failed to load audit issues.");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (onRefreshRequested) {
        await onRefreshRequested();
      } else {
        await fetchIssues();
      }
    } finally {
      setRefreshing(false);
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

  const getSearchBlob = (issue: AuditIssue) => {
    let annexure = "";
    try {
      annexure = JSON.stringify((issue as any).annexure || []);
    } catch {
      annexure = "";
    }

    const evidenceBlob = JSON.stringify(issue.evidenceReceived || []);
    const conversationBlob = getConversation(issue)
      .map((comment) => `${comment.who} ${comment.text} ${comment.role || ""}`)
      .join(" ");

    return [
      issue.serialNumber,
      `#${issue.serialNumber}`,
      issue.id,
      issue.process,
      issue.entityCovered,
      issue.observation,
      issue.recommendation,
      issue.managementComment,
      issue.personResponsible,
      issue.approver,
      issue.cxoResponsible,
      issue.coOwner,
      issue.timeline,
      issue.currentStatus,
      issue.evidenceStatus,
      issue.reviewComments,
      issue.fiscalYear,
      issue.quarter,
      issue.riskLevel,
      issue.risk,
      issue.actionRequired,
      issue.startMonth,
      issue.endMonth,
      issue.createdAt,
      issue.updatedAt,
      getAgingInfo(issue).label,
      evidenceBlob,
      annexure,
      conversationBlob,
    ]
      .map((value) => String(value ?? ""))
      .join(" ")
      .toLowerCase();
  };

  const filteredAndSorted = useMemo(() => {
    const term = searchTerm.toLowerCase();

    const filtered = issues.filter((issue) => {
      const valuesMatch = !term || getSearchBlob(issue).includes(term);

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
      const base =
        sortField === "createdAt"
          ? compare(a.createdAt, b.createdAt)
          : sortField === "timeline"
          ? compare(getDueDate(a)?.toISOString(), getDueDate(b)?.toISOString())
          : compare(a[sortField], b[sortField]);
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

  useEffect(() => {
    setPage(1);
  }, [
    searchTerm,
    sortField,
    sortDirection,
    filterStatus,
    filterRisk,
    filterFiscalYear,
    filterProcess,
    filterEntity,
    filterCxo,
    viewMode,
    rowsPerPage,
  ]);

  const handleSort = (field: SortField) => {
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
    const total = filteredAndSorted.length;
    const open = filteredAndSorted.filter(
      (issue) => issue.currentStatus !== "Closed"
    ).length;
    const awaitingEvidence = filteredAndSorted.filter((issue) =>
      ["To Be Received", "In Progress"].includes(issue.currentStatus)
    ).length;
    const locked = filteredAndSorted.filter(
      (issue) =>
        (issue as any).isLocked === 1 ||
        (issue as any).isLocked === true ||
        issue.evidenceStatus === "Accepted"
    ).length;

    return { total, open, awaitingEvidence, locked };
  }, [filteredAndSorted]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / rowsPerPage));
  const paginatedIssues = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return filteredAndSorted.slice(start, start + rowsPerPage);
  }, [filteredAndSorted, page, rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

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

    await handleRefresh();

    const issue = issues.find((item) => item.id === viewerIssueId);
    if (issue) {
      setViewerFiles(
        getAllFilesForIssue(issue).filter(
          (file) => String(file.id) !== String(doc.id)
        )
      );
    }
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

    await handleRefresh();
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
      await handleRefresh();
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Failed to close audit issue.");
    }
  };

  const openFileViewer = (issue: AuditIssue) => {
    setViewerTitle(
      `Files for #${issue.serialNumber} - ${issue.process} / ${
        issue.entityCovered || "Unassigned"
      }`
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

  const toggleIssue = (issueId: string) => {
    setOpenIssueIds((current) =>
      current.includes(issueId)
        ? current.filter((id) => id !== issueId)
        : [...current, issueId]
    );
  };

  const exportIssues = async (rows: AuditIssue[], suffix: string) => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(buildExportRows(rows));
    XLSX.utils.book_append_sheet(workbook, worksheet, "Audit_Issues");
    XLSX.writeFile(
      workbook,
      `audit_issues_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const postStakeholderComment = async (issue: AuditIssue) => {
    if (!viewer) return;
    const element = commentRefs.current[issue.id];
    const value = (element?.value || "").trim();
    if (!value) return;

    setCommentIssueId(issue.id);
    try {
      const res = await fetch(`${API_BASE_URL}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          issueId: issue.id,
          content: value,
          actor: viewer,
        }),
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }

      if (element) element.value = "";
      await handleRefresh();
    } catch (err: any) {
      alert(err?.message || "Failed to add comment.");
    } finally {
      setCommentIssueId(null);
    }
  };

  const detailIssue =
    filteredAndSorted.find((issue) => issue.id === detailIssueId) ||
    issues.find((issue) => issue.id === detailIssueId) ||
    null;

  const renderIssueBody = (issue: AuditIssue) => {
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
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
        <div className="space-y-4">
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
                {highlightText(issue.recommendation || "—", searchTerm)}
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Ownership map
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Keep assignee, approver, and CXO ownership visible while moving
              the issue forward.
            </p>

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

        <div className="space-y-4">
          <section className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Quick actions
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Open the bundle, upload evidence, or complete review actions
                  without leaving this issue.
                </p>
              </div>
              <Button
                variant="outline"
                className="rounded-2xl border-slate-200"
                onClick={() => openFileViewer(issue)}
              >
                <Eye className="mr-2 h-4 w-4" />
                Open file hub
              </Button>
            </div>

            {actionColumn ? (
              <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Review actions
                </p>
                {actionColumn(issue)}
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {isViewerPR(issue) && (
                  <Button
                    className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                    onClick={() => handleUploadClick(issue)}
                    disabled={locked}
                    title={locked ? "Locked after acceptance" : "Upload evidence"}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload evidence
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="rounded-2xl"
                  onClick={() => handleManualClosure(issue.id)}
                  disabled={issue.currentStatus === "Closed" || locked}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Mark closed
                </Button>
              </div>
            )}
          </section>

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
              <Badge className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-600">
                {totalFiles} file{totalFiles === 1 ? "" : "s"}
              </Badge>
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
                    <span className="text-xs text-slate-400">Annexure</span>
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
                    <span className="text-xs text-slate-400">Evidence</span>
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
                  Evidence notes, reviewer comments, and stakeholder responses
                  are grouped here.
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
                    onClick={() => postStakeholderComment(issue)}
                    disabled={commentIssueId === issue.id}
                  >
                    {commentIssueId === issue.id ? "Posting..." : "Post comment"}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="rounded-3xl border bg-white/90 p-8 text-center">
        Loading audit issues...
      </div>
    );
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
          <CardHeader className="border-b border-slate-100 bg-[linear-gradient(135deg,rgba(37,99,235,0.08),rgba(15,118,110,0.05))] pb-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                  <ShieldCheck className="h-4 w-4" />
                  Issue Navigator
                </div>
                <CardTitle className="text-2xl font-semibold text-slate-950">
                  {title}
                </CardTitle>
                <p className="max-w-3xl text-xs text-slate-600 sm:text-sm">
                  Scan, filter, export, and work issues from one compact queue.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="rounded-2xl border-slate-200 bg-white"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {refreshing ? "Refreshing..." : "Refresh"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportIssues(issues, "all")}
                  className="rounded-2xl border-slate-200 bg-white"
                  disabled={issues.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export all
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportIssues(filteredAndSorted, "filtered")}
                  className="rounded-2xl border-slate-200 bg-white"
                  disabled={filteredAndSorted.length === 0}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Export filtered
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
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Visible issues
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {summary.total}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Open
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {summary.open}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Awaiting evidence
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {summary.awaitingEvidence}
                </p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/80 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Locked
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {summary.locked}
                </p>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search all fields, including issue #, owners, comments, and observations..."
                  className="h-12 rounded-2xl border-slate-200 bg-slate-50 pl-11"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <select
                  value={sortField}
                  onChange={(event) =>
                    setSortField(event.target.value as SortField)
                  }
                  className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700"
                >
                  <option value="serialNumber">Sort: issue #</option>
                  <option value="createdAt">Sort: created</option>
                  <option value="timeline">Sort: due date</option>
                  <option value="process">Sort: process</option>
                  <option value="entityCovered">Sort: company</option>
                  <option value="personResponsible">Sort: owner</option>
                  <option value="currentStatus">Sort: status</option>
                  <option value="riskLevel">Sort: risk</option>
                </select>
                <button
                  type="button"
                  onClick={() => handleSort(sortField)}
                  className="flex h-12 items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-700"
                >
                  {sortDirection === "asc" ? "Ascending" : "Descending"}
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
                <option value="all">All companies</option>
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

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-slate-100 px-3 py-1">
                  Sort: {String(sortField)} ({sortDirection})
                </span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  Counts grouped by issue
                </span>
                {viewer && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                    Viewer scoped to {viewer}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap rounded-2xl border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={[
                    "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                    viewMode === "list"
                      ? "bg-sky-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  List view
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("table")}
                  className={[
                    "rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                    viewMode === "table"
                      ? "bg-sky-600 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  Tabular view
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Showing{" "}
                {filteredAndSorted.length === 0
                  ? 0
                  : (page - 1) * rowsPerPage + 1}
                -
                {Math.min(page * rowsPerPage, filteredAndSorted.length)} of{" "}
                {filteredAndSorted.length}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={rowsPerPage}
                  onChange={(event) => setRowsPerPage(Number(event.target.value))}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700"
                >
                  <option value={10}>10 rows</option>
                  <option value={20}>20 rows</option>
                  <option value={50}>50 rows</option>
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <span className="min-w-[84px] text-center text-[11px] text-slate-500">
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
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {filteredAndSorted.length === 0 && (
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

        {viewMode === "list" && filteredAndSorted.length > 0 && (
          <div className="space-y-4">
            {paginatedIssues.map((issue) => {
              const locked =
                (issue as any).isLocked === 1 ||
                (issue as any).isLocked === true ||
                issue.evidenceStatus === "Accepted";
              const aging = getAgingInfo(issue);
              const totalFiles = getAllFilesForIssue(issue).length;
              const isOpen = openIssueIds.includes(issue.id);
              const preview = getObservationPreview(issue.observation);

              return (
                <Card
                  key={issue.id}
                  className="overflow-hidden rounded-[24px] border-slate-200/80 bg-white/95 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.4)]"
                >
                  <CardContent className="p-0">
                    <button
                      type="button"
                      onClick={() => toggleIssue(issue.id)}
                      className="w-full border-b border-slate-100 bg-[linear-gradient(135deg,rgba(248,250,252,1),rgba(239,246,255,0.88))] px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:px-5"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1 space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full border border-slate-200 bg-slate-950 px-3 py-1 text-xs text-white">
                              Issue #{issue.serialNumber}
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
                            <h3 className="mt-1 text-lg font-semibold text-slate-950 sm:text-xl">
                              {highlightText(issue.entityCovered || "—", searchTerm)}
                            </h3>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Company
                              </p>
                              <p
                                className="mt-1 break-words text-sm font-medium text-slate-900"
                                title={issue.entityCovered || "—"}
                              >
                                {issue.entityCovered || "—"}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Person responsible
                              </p>
                              <p
                                className="mt-1 whitespace-normal break-words text-sm font-medium leading-5 text-slate-900"
                                title={issue.personResponsible || "—"}
                              >
                                {issue.personResponsible || "—"}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Created at
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-900">
                                {formatDate(issue.createdAt)}
                              </p>
                            </div>
                            <div
                              className={`rounded-2xl border p-3 ${getAgingTone(
                                aging.days,
                                isClosedEquivalent(issue)
                              )}`}
                            >
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                                Aging
                              </p>
                              <p className="mt-1 text-sm font-medium">
                                {aging.label}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Observation
                              </p>
                              <p
                                className="mt-1 line-clamp-2 text-sm font-medium text-slate-900"
                                title={preview}
                              >
                                {highlightText(preview, searchTerm)}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3 self-start">
                          <div className="hidden rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right sm:block">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              Files
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {totalFiles}
                            </p>
                          </div>
                          <div className="hidden rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right sm:block">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              Updated
                            </p>
                            <p className="mt-1 text-sm font-semibold text-slate-900">
                              {formatDate(issue.updatedAt)}
                            </p>
                          </div>
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600">
                            {isOpen ? (
                              <ChevronUp className="h-5 w-5" />
                            ) : (
                              <ChevronDown className="h-5 w-5" />
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {isOpen && <div className="px-4 py-4 sm:px-5">{renderIssueBody(issue)}</div>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {viewMode === "table" && filteredAndSorted.length > 0 && (
          <Card className="overflow-hidden rounded-[28px] border-slate-200/80 bg-white/95 shadow-[0_22px_45px_-36px_rgba(15,23,42,0.45)]">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Issue</th>
                      <th className="px-4 py-3 text-left font-semibold">Process</th>
                      <th className="px-4 py-3 text-left font-semibold">Company</th>
                      <th className="px-4 py-3 text-left font-semibold">
                        Person Responsible
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">
                        Created
                      </th>
                      <th className="px-4 py-3 text-left font-semibold">Due</th>
                      <th className="px-4 py-3 text-left font-semibold">Aging</th>
                      <th className="px-4 py-3 text-left font-semibold">Status</th>
                      <th className="px-4 py-3 text-left font-semibold">Evidence</th>
                      <th className="px-4 py-3 text-left font-semibold">Files</th>
                      <th className="px-4 py-3 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedIssues.map((issue) => {
                      const aging = getAgingInfo(issue);
                      const totalFiles = getAllFilesForIssue(issue).length;

                      return (
                        <tr
                          key={issue.id}
                          className="border-t border-slate-100 align-top"
                        >
                          <td className="px-4 py-4 font-semibold text-slate-900">
                            #{issue.serialNumber}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {issue.process || "—"}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            <div className="max-w-[220px] whitespace-normal">
                              {issue.entityCovered || "—"}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            <div className="max-w-[240px] whitespace-normal">
                              {issue.personResponsible || "—"}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {formatDate(issue.createdAt)}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {getDueDate(issue)?.toLocaleDateString() || "—"}
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${getAgingTone(
                                aging.days,
                                isClosedEquivalent(issue)
                              )}`}
                            >
                              {aging.label}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-col gap-2">
                              <Badge
                                className={`w-fit rounded-full border px-3 py-1 text-xs ${getStatusTone(
                                  issue.currentStatus
                                )}`}
                              >
                                {issue.currentStatus}
                              </Badge>
                              <Badge
                                className={`w-fit rounded-full border px-3 py-1 text-xs ${getRiskTone(
                                  issue.riskLevel
                                )}`}
                              >
                                {issue.riskLevel.toUpperCase()}
                              </Badge>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {issue.evidenceStatus || "—"}
                          </td>
                          <td className="px-4 py-4 text-slate-700">
                            {totalFiles}
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={() => setDetailIssueId(issue.id)}
                              >
                                Details
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={() => openFileViewer(issue)}
                              >
                                Files
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={!!detailIssueId}
        onOpenChange={(open) => {
          if (!open) setDetailIssueId(null);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-[1200px] overflow-y-auto rounded-[28px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-slate-950">
              {detailIssue
                ? `Issue #${detailIssue.serialNumber} - ${detailIssue.process}`
                : "Issue details"}
            </DialogTitle>
          </DialogHeader>
          {detailIssue && renderIssueBody(detailIssue)}
        </DialogContent>
      </Dialog>

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
            handleRefresh();
          }}
        />
      )}
    </>
  );
};
