// root/src/components/Analytics.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { AuditIssue } from "@/types/audit";
import { toast } from "@/components/ui/use-toast";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// SSR-safe base URL (falls back to relative /api during SSR/build)
const API_BASE_URL =
  typeof window !== "undefined" ? `${window.location.origin}/api` : "/api";

interface AnalyticsProps {
  title?: string;
}

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

/** Helpers */
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};
const parseDate = (val: any): Date | null => {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};
const daysBetween = (a: Date, b: Date) =>
  Math.floor((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

function Analytics({ title = "Analytics Dashboard" }: AnalyticsProps) {
  const [mounted, setMounted] = useState(false);
  const [auditIssues, setAuditIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  // Fetch from server
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/audit-issues`);
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data: AuditIssue[] = await res.json();
        if (!cancelled) setAuditIssues(data);
      } catch (err) {
        console.error("Failed to load audit issues for analytics", err);
        if (!cancelled) setError("Failed to load data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="p-6 text-center">Loading analytics…</div>;
  }
  if (error) {
    return <div className="p-6 text-center text-red-500">{error}</div>;
  }

  // Calculate analytics
  const totalIssues = auditIssues.length;
  const highRiskIssues = auditIssues.filter(
    (i) => i.riskLevel === "high"
  ).length;
  const completedIssues = auditIssues.filter(
    (i) => i.currentStatus === "Received"
  ).length;
  const pendingIssues = totalIssues - completedIssues;
  const completionRate =
    totalIssues > 0 ? (completedIssues / totalIssues) * 100 : 0;

  const statusData = [
    { name: "Received", value: completedIssues, color: "#10B981" },
    { name: "To Be Received", value: pendingIssues, color: "#F59E0B" },
  ];

  const riskData = [
    {
      name: "High",
      value: auditIssues.filter((i) => i.riskLevel === "high").length,
      color: "#EF4444",
    },
    {
      name: "Medium",
      value: auditIssues.filter((i) => i.riskLevel === "medium").length,
      color: "#F59E0B",
    },
    {
      name: "Low",
      value: auditIssues.filter((i) => i.riskLevel === "low").length,
      color: "#10B981",
    },
  ];

  const processData = Array.from(
    new Set(auditIssues.map((i) => i.process))
  ).map((proc) => ({
    name: proc,
    value: auditIssues.filter((i) => i.process === proc).length,
  }));

  const cxoData = Array.from(
    new Set(auditIssues.map((i) => i.cxoResponsible))
  ).map((cxo) => ({
    name: cxo.split("@")[0],
    received: auditIssues.filter(
      (i) => i.cxoResponsible === cxo && i.currentStatus === "Received"
    ).length,
    pending: auditIssues.filter(
      (i) => i.cxoResponsible === cxo && i.currentStatus !== "Received"
    ).length,
  }));

  const fiscalYearData = Array.from(
    new Set(auditIssues.map((i) => i.fiscalYear))
  )
    .sort()
    .map((year) => ({
      year,
      total: auditIssues.filter((i) => i.fiscalYear === year).length,
      high: auditIssues.filter(
        (i) => i.fiscalYear === year && i.riskLevel === "high"
      ).length,
    }));

  // Issues by Entity (split multi-entity fields into separate buckets)
  const entityCounts = new Map<string, { name: string; value: number }>();
  auditIssues.forEach((issue) => {
    const parts = String(issue.entityCovered || "")
      .split(/[;,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);

    const seenInIssue = new Set<string>();
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seenInIssue.has(key)) continue;
      seenInIssue.add(key);

      if (!entityCounts.has(key)) {
        entityCounts.set(key, { name: p, value: 1 });
      } else {
        const curr = entityCounts.get(key)!;
        curr.value += 1;
      }
    }
  });

  const entityData = Array.from(entityCounts.values());

  const downloadReport = async (type: "next3" | "next6" | "overdue") => {
    try {
      const res = await fetch(`${API_BASE_URL}/audit-issues/reports/${type}`);
      if (!res.ok) throw new Error(`Status ${res.status}`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const filename =
        type === "next3"
          ? "next-3-months-report.xlsx"
          : type === "next6"
          ? "next-6-months-report.xlsx"
          : "overdue-report.xlsx";
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Report download error:", err);
      toast({
        title: "Download Failed",
        description: err.message || "Unable to download report",
        variant: "destructive",
      });
    }
  };

  /** Reports Table (Upcoming Due / Recently Closed / Overdue) */
  type ReportMode = "upcoming" | "recent" | "overdue";
  const [reportMode, setReportMode] = useState<ReportMode>("upcoming");
  const [periodDays, setPeriodDays] = useState<"30" | "60" | "90">("90");

  const today = startOfDay(new Date());
  const horizonEnd = addDays(today, Number(periodDays));
  const horizonStart = addDays(today, -Number(periodDays));

  const displayIssues = useMemo(() => {
    const isClosed = (i: AuditIssue) => i.currentStatus === "Closed";
    const due = (i: AuditIssue) =>
      parseDate((i as any).dueDate ?? (i as any).timeline);
    const upd = (i: AuditIssue) => parseDate((i as any).updatedAt);

    if (reportMode === "upcoming") {
      // due within next N days, not closed
      return auditIssues
        .filter((i) => {
          const d = due(i);
          if (!d) return false;
          return d >= today && d <= horizonEnd && !isClosed(i);
        })
        .sort((a, b) => {
          const da = due(a)!.getTime();
          const db = due(b)!.getTime();
          return da - db;
        });
    }

    if (reportMode === "recent") {
      // closed within last N days (by updatedAt)
      return auditIssues
        .filter((i) => {
          if (!isClosed(i)) return false;
          const u = upd(i);
          if (!u) return false;
          return u >= horizonStart && u <= today;
        })
        .sort((a, b) => {
          const ua = upd(a)!.getTime();
          const ub = upd(b)!.getTime();
          return ub - ua; // newest first
        });
    }

    // overdue: due date in the past and not closed
    return auditIssues
      .filter((i) => {
        const d = due(i);
        if (!d) return false;
        return d < today && !isClosed(i);
      })
      .sort((a, b) => {
        const da = due(a)!.getTime();
        const db = due(b)!.getTime();
        return da - db; // oldest due first
      });
  }, [auditIssues, reportMode, periodDays, today, horizonEnd, horizonStart]);

  const renderAging = (issue: AuditIssue) => {
    const d = parseDate((issue as any).dueDate ?? (issue as any).timeline);
    if (!d) return "—";
    const diff = daysBetween(today, d); // today - due
    if (diff > 0) return `${diff} day(s)`; // overdue by diff days
    if (diff === 0) return "due today";
    return `in ${Math.abs(diff)} day(s)`; // not yet due
  };

  const renderReportTitle = () => {
    if (reportMode === "upcoming") return `Due in next ${periodDays} days`;
    if (reportMode === "recent") return `Closed in last ${periodDays} days`;
    return "Overdue";
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">{title}</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-600">Total Issues</p>
                <p className="text-3xl font-bold">{totalIssues}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-600">High Risk</p>
                <p className="text-3xl font-bold text-red-600">
                  {highRiskIssues}
                </p>
              </div>
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-600">Completed</p>
                <p className="text-3xl font-bold text-green-600">
                  {completedIssues}
                </p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-600">Pending</p>
                <p className="text-3xl font-bold text-orange-600">
                  {pendingIssues}
                </p>
              </div>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-gray-600">Completion Rate</p>
                <p className="text-3xl font-bold text-blue-600">
                  {completionRate.toFixed(1)}%
                </p>
              </div>
              <Users className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts — render only after mount to keep chart libs fully client-side */}
      {mounted && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value, percent }) =>
                      `${name}: ${value} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {statusData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk Level Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={riskData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    dataKey="value"
                    label={({ name, value, percent }) =>
                      `${name}: ${value} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {riskData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Issues by Process</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={processData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>CXO Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={cxoData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis />
                  <Tooltip />
                  <Bar
                    dataKey="received"
                    stackId="a"
                    fill="#10B981"
                    name="Received"
                  />
                  <Bar
                    dataKey="pending"
                    stackId="a"
                    fill="#F59E0B"
                    name="Pending"
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fiscal Year Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={fiscalYearData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    name="Total"
                  />
                  <Line
                    type="monotone"
                    dataKey="high"
                    stroke="#EF4444"
                    strokeWidth={2}
                    name="High Risk"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Issues by Entity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={entityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#10B981" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Reports (Downloads + Dynamic Table) */}
          <Card>
            <CardHeader>
              <CardTitle>Reports</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Downloads */}
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center">
                  <span>Next 3 Months</span>
                  <Button onClick={() => downloadReport("next3")}>
                    Download Excel
                  </Button>
                </div>
                <div className="flex justify-between items-center">
                  <span>Next 6 Months</span>
                  <Button onClick={() => downloadReport("next6")}>
                    Download Excel
                  </Button>
                </div>
                <div className="flex justify-between items-center">
                  <span>Overdue</span>
                  <Button onClick={() => downloadReport("overdue")}>
                    Download Excel
                  </Button>
                </div>
              </div>

              {/* Dynamic Table Filters (native selects for stability) */}
              <ReportsFilters
                reportMode={reportMode}
                setReportMode={setReportMode}
                periodDays={periodDays}
                setPeriodDays={setPeriodDays}
                renderReportTitle={renderReportTitle}
              />

              {/* Dynamic Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">S.No</TableHead>
                      <TableHead className="whitespace-nowrap">
                        Process
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Entity
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Due Date
                      </TableHead>
                      <TableHead className="whitespace-nowrap">
                        Status
                      </TableHead>
                      <TableHead className="whitespace-nowrap">Aging</TableHead>
                      <TableHead className="whitespace-nowrap">
                        Last Updated
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayIssues.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="text-center text-gray-500"
                        >
                          No issues found for the selected filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayIssues.map((i) => {
                        const dueDate = parseDate(
                          (i as any).dueDate ?? (i as any).timeline
                        );
                        const lastUpd = parseDate((i as any).updatedAt);
                        return (
                          <TableRow key={i.id}>
                            <TableCell className="whitespace-nowrap">
                              {i.serialNumber}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {i.process || "—"}
                            </TableCell>
                            <TableCell className="whitespace-pre-wrap">
                              {i.entityCovered || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {dueDate
                                ? dueDate.toISOString().slice(0, 10)
                                : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {i.currentStatus || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {renderAging(i)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {lastUpd
                                ? lastUpd.toISOString().slice(0, 10)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ReportsFilters(props: {
  reportMode: "upcoming" | "recent" | "overdue";
  setReportMode: (v: "upcoming" | "recent" | "overdue") => void;
  periodDays: "30" | "60" | "90";
  setPeriodDays: (v: "30" | "60" | "90") => void;
  renderReportTitle: () => string;
}) {
  const {
    reportMode,
    setReportMode,
    periodDays,
    setPeriodDays,
    renderReportTitle,
  } = props;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mb-4">
      <div>
        <div className="text-sm text-gray-600 mb-1">View</div>
        <select
          value={reportMode}
          onChange={(e) =>
            setReportMode(e.target.value as "upcoming" | "recent" | "overdue")
          }
          className="border rounded p-2 w-full"
        >
          <option value="upcoming">Due (next N days)</option>
          <option value="recent">Closed (last N days)</option>
          <option value="overdue">Overdue</option>
        </select>
      </div>

      <div>
        <div className="text-sm text-gray-600 mb-1">Period</div>
        <select
          value={periodDays}
          onChange={(e) => setPeriodDays(e.target.value as "30" | "60" | "90")}
          disabled={reportMode === "overdue"}
          className="border rounded p-2 w-full disabled:bg-gray-100 disabled:text-gray-500"
        >
          <option value="30">30 days</option>
          <option value="60">60 days</option>
          <option value="90">90 days</option>
        </select>
      </div>

      <div className="md:col-span-1">
        <div className="text-sm text-gray-600 mb-1">Title</div>
        <div className="p-2 border rounded text-gray-800 bg-gray-50">
          {renderReportTitle()}
        </div>
      </div>
    </div>
  );
}

export { Analytics }; // <-- add named export for compatibility
export default Analytics;
