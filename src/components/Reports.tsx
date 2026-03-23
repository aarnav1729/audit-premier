import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_BASE_URL = `${window.location.origin}/api`;

function cell(n: number) {
  return n ? n : "—";
}

type ActionTakenRow = {
  cxoKey: string;
  cxoName: string;
  total: { high: number; medium: number; low: number; total: number };
  closed: { high: number; medium: number; low: number; total: number };
  open: { high: number; medium: number; low: number; total: number };
  ageing: {
    notOverdue: number;
    d0_90: number;
    d91_180: number;
    d181_270: number;
    d271_360: number;
    d360plus: number;
    total: number;
  };
};

type AtrRow = {
  cxoKey: string;
  cxoName: string;
  pending: { manual: number; system: number; total: number };
  expected: {
    due: number;
    d0_30: number;
    d31_60: number;
    d61_90: number;
    d91plus: number;
  };
};

type Totals = Record<string, any>;

export const Reports: React.FC<{ viewerEmail: string }> = ({ viewerEmail }) => {
  const [loading, setLoading] = useState(true);
  const [actionTaken, setActionTaken] = useState<any>(null);
  const [atr, setAtr] = useState<any>(null);
  const [error, setError] = useState<string>("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const qs = `viewer=${encodeURIComponent(viewerEmail)}`;
      const [r1, r2] = await Promise.all([
        fetch(`${API_BASE_URL}/reports/action-taken-status?${qs}`, {
          credentials: "include",
        }),
        fetch(`${API_BASE_URL}/reports/internal-audit-atr-status?${qs}`, {
          credentials: "include",
        }),
      ]);

      const j1 = await r1.json();
      const j2 = await r2.json();

      if (!r1.ok) throw new Error(j1?.error || "Failed action-taken report");
      if (!r2.ok) throw new Error(j2?.error || "Failed ATR report");

      setActionTaken(j1);
      setAtr(j2);
    } catch (e: any) {
      setError(e?.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerEmail]);

  const actionRows = useMemo<ActionTakenRow[]>(
    () => actionTaken?.rows || [],
    [actionTaken]
  );
  const atrRows = useMemo<AtrRow[]>(() => atr?.rows || [], [atr]);
  const actionTotals = actionTaken?.totals as Totals | undefined;
  const atrTotals = atr?.totals as Totals | undefined;

  const cxoSummary = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        total: number;
        open: number;
        closed: number;
        manual: number;
        system: number;
        pending: number;
      }
    >();

    actionRows.forEach((row) => {
      map.set(row.cxoKey, {
        key: row.cxoKey,
        name: row.cxoName,
        total: row.total.total,
        open: row.open.total,
        closed: row.closed.total,
        manual: 0,
        system: 0,
        pending: 0,
      });
    });

    atrRows.forEach((row) => {
      const existing =
        map.get(row.cxoKey) ||
        ({
          key: row.cxoKey,
          name: row.cxoName,
          total: 0,
          open: 0,
          closed: 0,
          manual: 0,
          system: 0,
          pending: 0,
        } as const);

      map.set(row.cxoKey, {
        ...existing,
        name: row.cxoName || existing.name,
        manual: row.pending.manual,
        system: row.pending.system,
        pending: row.pending.total,
      });
    });

    return Array.from(map.values()).sort(
      (a, b) => b.total + b.pending - (a.total + a.pending)
    );
  }, [actionRows, atrRows]);

  const maxIssueTotal = useMemo(() => {
    const max = Math.max(...cxoSummary.map((row) => row.total), 0);
    return max || 1;
  }, [cxoSummary]);

  const maxPendingTotal = useMemo(() => {
    const max = Math.max(...cxoSummary.map((row) => row.pending), 0);
    return max || 1;
  }, [cxoSummary]);

  const ageingCards = useMemo(
    () => [
      {
        label: "Not overdue",
        value: actionTotals?.ageing?.notOverdue || 0,
      },
      { label: "0-90", value: actionTotals?.ageing?.d0_90 || 0 },
      { label: "91-180", value: actionTotals?.ageing?.d91_180 || 0 },
      { label: "181-270", value: actionTotals?.ageing?.d181_270 || 0 },
      { label: "271-360", value: actionTotals?.ageing?.d271_360 || 0 },
      { label: ">360", value: actionTotals?.ageing?.d360plus || 0 },
    ],
    [actionTotals]
  );

  const expectedCards = useMemo(
    () => [
      { label: "Due", value: atrTotals?.expected?.due || 0 },
      { label: "0-30", value: atrTotals?.expected?.d0_30 || 0 },
      { label: "31-60", value: atrTotals?.expected?.d31_60 || 0 },
      { label: "61-90", value: atrTotals?.expected?.d61_90 || 0 },
      { label: ">91", value: atrTotals?.expected?.d91plus || 0 },
    ],
    [atrTotals]
  );

  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Loading reports…</div>;
  }

  if (error) {
    return (
      <div className="space-y-3 p-4">
        <div className="text-sm text-red-600">{error}</div>
        <Button variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-2xl font-bold text-slate-950">
            Audit reports overview
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Live report data grouped by the unique CXOs returned from the audit
            database.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
            Generated{" "}
            {new Date(
              actionTaken?.generatedAt || atr?.generatedAt || Date.now()
            ).toLocaleString()}
          </Badge>
          <Button variant="outline" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Unique CXOs</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {cxoSummary.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Total issues</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">
              {actionTotals?.total?.total || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Open issues</p>
            <p className="mt-2 text-3xl font-semibold text-amber-600">
              {actionTotals?.open?.total || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Closed issues</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-600">
              {actionTotals?.closed?.total || 0}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-500">Pending action points</p>
            <p className="mt-2 text-3xl font-semibold text-sky-600">
              {atrTotals?.pending?.total || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg text-slate-950">
              Open vs closed by CXO
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {cxoSummary.length === 0 && (
              <div className="text-sm text-slate-500">No report data available.</div>
            )}
            {cxoSummary.map((row) => {
              const closedWidth = (row.closed / maxIssueTotal) * 100;
              const openWidth = (row.open / maxIssueTotal) * 100;
              return (
                <div key={row.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-slate-900">
                      {row.name}
                    </span>
                    <span className="text-slate-500">{row.total}</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${closedWidth}%` }}
                      title={`Closed: ${row.closed}`}
                    />
                    <div
                      className="h-full bg-amber-500"
                      style={{ width: `${openWidth}%` }}
                      title={`Open: ${row.open}`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-emerald-500" />
                Closed
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-amber-500" />
                Open
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg text-slate-950">
              Manual vs system pending action points
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5">
            {cxoSummary.length === 0 && (
              <div className="text-sm text-slate-500">No ATR data available.</div>
            )}
            {cxoSummary.map((row) => {
              const systemWidth = (row.system / maxPendingTotal) * 100;
              const manualWidth = (row.manual / maxPendingTotal) * 100;
              return (
                <div key={`${row.key}-pending`} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-medium text-slate-900">
                      {row.name}
                    </span>
                    <span className="text-slate-500">{row.pending}</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-orange-400"
                      style={{ width: `${systemWidth}%` }}
                      title={`System: ${row.system}`}
                    />
                    <div
                      className="h-full bg-slate-900"
                      style={{ width: `${manualWidth}%` }}
                      title={`Manual: ${row.manual}`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center gap-5 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-orange-400" />
                System
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm bg-slate-900" />
                Manual
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg text-slate-950">
              Open issue ageing
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {ageingCards.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {item.value}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="text-lg text-slate-950">
              Expected closure buckets
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {expectedCards.map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              >
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  {item.label}
                </p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">
                  {item.value}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg text-slate-950">
            Summary of action taken status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th rowSpan={2} className="p-2 text-left">
                    Sl.No.
                  </th>
                  <th rowSpan={2} className="p-2 text-left">
                    CXO
                  </th>
                  <th colSpan={4} className="p-2 text-center bg-cyan-700">
                    Total
                  </th>
                  <th colSpan={3} className="p-2 text-center bg-emerald-700">
                    Closed
                  </th>
                  <th colSpan={3} className="p-2 text-center bg-orange-500">
                    Open
                  </th>
                  <th colSpan={7} className="p-2 text-center bg-slate-900">
                    Ageing
                  </th>
                </tr>
                <tr className="bg-slate-100 text-slate-900">
                  <th className="p-2">High</th>
                  <th className="p-2">Medium</th>
                  <th className="p-2">Low</th>
                  <th className="p-2 font-semibold">Total</th>
                  <th className="p-2">High</th>
                  <th className="p-2">Medium</th>
                  <th className="p-2">Low</th>
                  <th className="p-2">High</th>
                  <th className="p-2">Medium</th>
                  <th className="p-2">Low</th>
                  <th className="p-2">Not overdue</th>
                  <th className="p-2">0-90</th>
                  <th className="p-2">91-180</th>
                  <th className="p-2">181-270</th>
                  <th className="p-2">271-360</th>
                  <th className="p-2">&gt;360</th>
                  <th className="p-2 font-semibold">Total</th>
                </tr>
              </thead>

              <tbody>
                {actionRows.map((row, idx) => (
                  <tr key={row.cxoKey || idx} className="border-t">
                    <td className="p-2">{idx + 1}</td>
                    <td className="p-2">{row.cxoName}</td>
                    <td className="p-2 text-center">{cell(row.total.high)}</td>
                    <td className="p-2 text-center">{cell(row.total.medium)}</td>
                    <td className="p-2 text-center">{cell(row.total.low)}</td>
                    <td className="p-2 text-center font-semibold">
                      {cell(row.total.total)}
                    </td>
                    <td className="p-2 text-center">{cell(row.closed.high)}</td>
                    <td className="p-2 text-center">{cell(row.closed.medium)}</td>
                    <td className="p-2 text-center">{cell(row.closed.low)}</td>
                    <td className="p-2 text-center">{cell(row.open.high)}</td>
                    <td className="p-2 text-center">{cell(row.open.medium)}</td>
                    <td className="p-2 text-center">{cell(row.open.low)}</td>
                    <td className="p-2 text-center">
                      {cell(row.ageing.notOverdue)}
                    </td>
                    <td className="p-2 text-center">{cell(row.ageing.d0_90)}</td>
                    <td className="p-2 text-center">
                      {cell(row.ageing.d91_180)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(row.ageing.d181_270)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(row.ageing.d271_360)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(row.ageing.d360plus)}
                    </td>
                    <td className="p-2 text-center font-semibold">
                      {cell(row.ageing.total)}
                    </td>
                  </tr>
                ))}

                {actionTotals && (
                  <tr className="border-t bg-yellow-100 font-semibold">
                    <td className="p-2" colSpan={2}>
                      Total
                    </td>
                    <td className="p-2 text-center">{cell(actionTotals.total.high)}</td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.total.medium)}
                    </td>
                    <td className="p-2 text-center">{cell(actionTotals.total.low)}</td>
                    <td className="p-2 text-center">{cell(actionTotals.total.total)}</td>
                    <td className="p-2 text-center">{cell(actionTotals.closed.high)}</td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.closed.medium)}
                    </td>
                    <td className="p-2 text-center">{cell(actionTotals.closed.low)}</td>
                    <td className="p-2 text-center">{cell(actionTotals.open.high)}</td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.open.medium)}
                    </td>
                    <td className="p-2 text-center">{cell(actionTotals.open.low)}</td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.notOverdue)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.d0_90)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.d91_180)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.d181_270)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.d271_360)}
                    </td>
                    <td className="p-2 text-center">
                      {cell(actionTotals.ageing.d360plus)}
                    </td>
                    <td className="p-2 text-center">{cell(actionTotals.ageing.total)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg text-slate-950">
            Summary of internal audit ATR status
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead>
                <tr className="bg-orange-600 text-white">
                  <th colSpan={4} className="p-2 text-center">
                    Pending action points
                  </th>
                  <th colSpan={5} className="p-2 text-center">
                    Expected closure from AC date in days
                  </th>
                </tr>
                <tr className="bg-slate-100">
                  <th className="p-2 text-left">CXO</th>
                  <th className="p-2 text-center">Manual</th>
                  <th className="p-2 text-center">System</th>
                  <th className="p-2 text-center font-semibold">Total</th>
                  <th className="p-2 text-center">Due</th>
                  <th className="p-2 text-center">0-30</th>
                  <th className="p-2 text-center">31-60</th>
                  <th className="p-2 text-center">61-90</th>
                  <th className="p-2 text-center">&gt;91</th>
                </tr>
              </thead>
              <tbody>
                {atrRows.map((row) => (
                  <tr key={row.cxoKey} className="border-t">
                    <td className="p-2">{row.cxoName}</td>
                    <td className="p-2 text-center">{cell(row.pending.manual)}</td>
                    <td className="p-2 text-center">{cell(row.pending.system)}</td>
                    <td className="p-2 text-center font-semibold">
                      {cell(row.pending.total)}
                    </td>
                    <td className="p-2 text-center">{cell(row.expected.due)}</td>
                    <td className="p-2 text-center">{cell(row.expected.d0_30)}</td>
                    <td className="p-2 text-center">{cell(row.expected.d31_60)}</td>
                    <td className="p-2 text-center">{cell(row.expected.d61_90)}</td>
                    <td className="p-2 text-center">
                      {cell(row.expected.d91plus)}
                    </td>
                  </tr>
                ))}

                {atrTotals && (
                  <tr className="border-t font-semibold">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-center">{cell(atrTotals.pending.manual)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.pending.system)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.pending.total)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.expected.due)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.expected.d0_30)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.expected.d31_60)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.expected.d61_90)}</td>
                    <td className="p-2 text-center">{cell(atrTotals.expected.d91plus)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
