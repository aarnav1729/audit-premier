// CMD-F ANCHOR: Reports component
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const API_BASE_URL = `${window.location.origin}/api`;

function cell(n: number) {
  return n ? n : "—";
}

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

  const chartRows = useMemo(() => atr?.chart || [], [atr]);

  const maxTotal = useMemo(() => {
    const mx = Math.max(...chartRows.map((r: any) => Number(r.Total || 0)), 0);
    return mx || 1;
  }, [chartRows]);

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-600">Loading reports…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-red-600">{error}</div>
        <Button variant="outline" onClick={load}>Retry</Button>
      </div>
    );
  }

  const rows1 = actionTaken?.rows || [];
  const t1 = actionTaken?.totals;

  const rows2 = atr?.rows || [];
  const t2 = atr?.totals;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-2xl font-bold text-gray-900">
            SUMMARY OF ACTION TAKEN STATUS
          </div>
          <div className="text-sm text-gray-600">
            Generated: {new Date(actionTaken?.generatedAt || Date.now()).toLocaleString()}
          </div>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>

      {/* ===== Report 1 (screenshot 1) ===== */}
      <div className="rounded-lg border bg-white overflow-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th rowSpan={2} className="p-2 text-left">Sl.No.</th>
              <th rowSpan={2} className="p-2 text-left">CXO</th>
              <th colSpan={4} className="p-2 text-center bg-cyan-700">Total</th>
              <th colSpan={3} className="p-2 text-center bg-emerald-700">Closed</th>
              <th colSpan={3} className="p-2 text-center bg-orange-500">Open</th>
              <th colSpan={7} className="p-2 text-center bg-slate-900">Ageing</th>
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
            {rows1.map((r: any, idx: number) => (
              <tr key={r.cxoKey || idx} className="border-t">
                <td className="p-2">{idx + 1}</td>
                <td className="p-2">{r.cxoName}</td>

                <td className="p-2 text-center">{cell(r.total.high)}</td>
                <td className="p-2 text-center">{cell(r.total.medium)}</td>
                <td className="p-2 text-center">{cell(r.total.low)}</td>
                <td className="p-2 text-center font-semibold">{cell(r.total.total)}</td>

                <td className="p-2 text-center">{cell(r.closed.high)}</td>
                <td className="p-2 text-center">{cell(r.closed.medium)}</td>
                <td className="p-2 text-center">{cell(r.closed.low)}</td>

                <td className="p-2 text-center">{cell(r.open.high)}</td>
                <td className="p-2 text-center">{cell(r.open.medium)}</td>
                <td className="p-2 text-center">{cell(r.open.low)}</td>

                <td className="p-2 text-center">{cell(r.ageing.notOverdue)}</td>
                <td className="p-2 text-center">{cell(r.ageing.d0_90)}</td>
                <td className="p-2 text-center">{cell(r.ageing.d91_180)}</td>
                <td className="p-2 text-center">{cell(r.ageing.d181_270)}</td>
                <td className="p-2 text-center">{cell(r.ageing.d271_360)}</td>
                <td className="p-2 text-center">{cell(r.ageing.d360plus)}</td>
                <td className="p-2 text-center font-semibold">{cell(r.ageing.total)}</td>
              </tr>
            ))}

            {/* Total row */}
            {t1 && (
              <tr className="border-t bg-yellow-100 font-semibold">
                <td className="p-2" colSpan={2}>Total</td>

                <td className="p-2 text-center">{cell(t1.total.high)}</td>
                <td className="p-2 text-center">{cell(t1.total.medium)}</td>
                <td className="p-2 text-center">{cell(t1.total.low)}</td>
                <td className="p-2 text-center">{cell(t1.total.total)}</td>

                <td className="p-2 text-center">{cell(t1.closed.high)}</td>
                <td className="p-2 text-center">{cell(t1.closed.medium)}</td>
                <td className="p-2 text-center">{cell(t1.closed.low)}</td>

                <td className="p-2 text-center">{cell(t1.open.high)}</td>
                <td className="p-2 text-center">{cell(t1.open.medium)}</td>
                <td className="p-2 text-center">{cell(t1.open.low)}</td>

                <td className="p-2 text-center">{cell(t1.ageing.notOverdue)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.d0_90)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.d91_180)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.d181_270)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.d271_360)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.d360plus)}</td>
                <td className="p-2 text-center">{cell(t1.ageing.total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Report 2 (screenshot 2) ===== */}
      <div className="rounded-lg border bg-white p-4 space-y-4">
        <div className="text-center font-semibold underline">
          Summary of Internal Audit-ATR Status
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: table */}
          <div className="overflow-auto border rounded">
            <table className="min-w-[720px] w-full text-sm">
              <thead>
                <tr className="bg-orange-600 text-white">
                  <th colSpan={4} className="p-2 text-center">Pending action points</th>
                  <th colSpan={5} className="p-2 text-center">Expected Closure from AC date in dates</th>
                </tr>
                <tr className="bg-slate-100">
                  <th className="p-2 text-left">CXO</th>
                  <th className="p-2 text-center">Manual</th>
                  <th className="p-2 text-center">System</th>
                  <th className="p-2 text-center font-semibold">Total</th>
                  <th className="p-2 text-center">Due*</th>
                  <th className="p-2 text-center">0-30</th>
                  <th className="p-2 text-center">31-60</th>
                  <th className="p-2 text-center">61-90</th>
                  <th className="p-2 text-center">&gt;91</th>
                </tr>
              </thead>
              <tbody>
                {rows2.map((r: any) => (
                  <tr key={r.cxoKey} className="border-t">
                    <td className="p-2">{r.cxoName}</td>
                    <td className="p-2 text-center">{cell(r.pending.manual)}</td>
                    <td className="p-2 text-center">{cell(r.pending.system)}</td>
                    <td className="p-2 text-center font-semibold">{cell(r.pending.total)}</td>
                    <td className="p-2 text-center">{cell(r.expected.due)}</td>
                    <td className="p-2 text-center">{cell(r.expected.d0_30)}</td>
                    <td className="p-2 text-center">{cell(r.expected.d31_60)}</td>
                    <td className="p-2 text-center">{cell(r.expected.d61_90)}</td>
                    <td className="p-2 text-center">{cell(r.expected.d91plus)}</td>
                  </tr>
                ))}

                {t2 && (
                  <tr className="border-t font-semibold">
                    <td className="p-2">Total</td>
                    <td className="p-2 text-center">{cell(t2.pending.manual)}</td>
                    <td className="p-2 text-center">{cell(t2.pending.system)}</td>
                    <td className="p-2 text-center">{cell(t2.pending.total)}</td>
                    <td className="p-2 text-center">{cell(t2.expected.due)}</td>
                    <td className="p-2 text-center">{cell(t2.expected.d0_30)}</td>
                    <td className="p-2 text-center">{cell(t2.expected.d31_60)}</td>
                    <td className="p-2 text-center">{cell(t2.expected.d61_90)}</td>
                    <td className="p-2 text-center">{cell(t2.expected.d91plus)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Right: simple horizontal bar chart (no new deps) */}
          <div className="border rounded p-4">
            <div className="text-center text-gray-700 mb-4">Pending Action Point</div>

            <div className="space-y-3">
              {chartRows.map((r: any) => {
                const sysPct = (Number(r.System || 0) / maxTotal) * 100;
                const manPct = (Number(r.Manual || 0) / maxTotal) * 100;
                return (
                  <div key={r.name} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-gray-600 truncate" title={r.name}>
                      {r.name}
                    </div>
                    <div className="flex-1 h-3 bg-gray-200 rounded overflow-hidden flex">
                      <div
                        className="h-full bg-orange-400"
                        style={{ width: `${sysPct}%` }}
                        title={`System: ${r.System || 0}`}
                      />
                      <div
                        className="h-full bg-slate-900"
                        style={{ width: `${manPct}%` }}
                        title={`Manual: ${r.Manual || 0}`}
                      />
                    </div>
                    <div className="w-10 text-right text-xs text-gray-700">
                      {r.Total || 0}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-center gap-6 text-xs text-gray-600">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 bg-orange-400 rounded-sm" />
                System
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 bg-slate-900 rounded-sm" />
                Manual
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          *Due = overdue items (or items with no due date).
        </div>
      </div>
    </div>
  );
};
// CMD-F ANCHOR: Reports component