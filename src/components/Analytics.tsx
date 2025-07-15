// root/src/components/Analytics.tsx

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
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
const API_BASE_URL = 'http://localhost:7723/api';
interface AnalyticsProps {
  title?: string;
}

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6"];

export const Analytics: React.FC<AnalyticsProps> = ({
  title = "Analytics Dashboard",
}) => {
  const [auditIssues, setAuditIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch from server
  useEffect(() => {
    fetch(`${API_BASE_URL}/audit-issues`)
      .then((res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res.json();
      })
      .then((data: AuditIssue[]) => {
        setAuditIssues(data);
      })
      .catch((err) => {
        console.error("Failed to load audit issues for analytics", err);
        setError("Failed to load data");
      })
      .finally(() => setLoading(false));
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

  const entityData = Array.from(
    new Set(auditIssues.map((i) => i.entityCovered))
  ).map((ent) => ({
    name: ent,
    value: auditIssues.filter((i) => i.entityCovered === ent).length,
  }));

  const downloadReport = async (type: "next3" | "next6" | "overdue") => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/audit-issues/reports/${type}`
      );
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

      {/* Charts */}
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
        {/* ─── New Reports Section ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span>Next 3 Months</span>
              <Button onClick={() => downloadReport('next3')}>
                Download Excel
              </Button>
            </div>
            <div className="flex justify-between items-center">
              <span>Next 6 Months</span>
              <Button onClick={() => downloadReport('next6')}>
                Download Excel
              </Button>
            </div>
            <div className="flex justify-between items-center">
              <span>Overdue</span>
              <Button onClick={() => downloadReport('overdue')}>
                Download Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </div>

      
    </div>
  );
};
