// root/src/components/Analytics.tsx
"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useState,
} from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AuditIssue } from "@/types/audit";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Download,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Optional: use the same store as AuditTable for consistent data.
// If the hook is absent in your build, remove this import and the usage below.
import { useAuditStorage } from "@/hooks/useAuditStorage";
import { useAuth } from "@/hooks/useAuth";
// amCharts 5
import * as am5 from "@amcharts/amcharts5";
import * as am5xy from "@amcharts/amcharts5/xy";
import * as am5percent from "@amcharts/amcharts5/percent";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

const API_BASE_URL = `${window.location.origin}/api`;

interface AnalyticsProps {
  title?: string;
  /** Optional: allow parent to pass issues directly */
  auditIssues?: AuditIssue[];
  /**
   * Controls data scope:
   *  - 'auto' (default): auditor → all, others → mine (keeps current behavior)
   *  - 'mine': force only the logged-in user's issues; ignore local store supersets
   *  - 'all':  force all issues (requires auditor on server)
   */
  mode?: "auto" | "mine" | "all";
}

/* ------------------------------- Utils ------------------------------------ */
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

/** Robust date parse with many common shapes */
const parseDateSmart = (val: any): Date | null => {
  if (val === undefined || val === null) return null;

  // Date instance
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  // Number (epoch seconds/ms)
  if (typeof val === "number") {
    const n = val;
    const ms = n > 1e12 ? n : n * 1000; // seconds -> ms
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  // String
  const s = String(val).trim();
  if (!s) return null;

  // ISO / RFC
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;

  // dd-MMM-yyyy / dd MMM yyyy / dd-Mon-yy
  const m = s.match(/^(\d{1,2})[ \-\/]([A-Za-z]{3,})[ \-\/](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monStr = m[2].toLowerCase();
    const yRaw = parseInt(m[3], 10);
    const monthMap: Record<string, number> = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11,
    };
    const month = monthMap[monStr];
    if (month !== undefined) {
      let year = yRaw;
      if (year < 100) year += 2000;
      const dt = new Date(year, month, day);
      if (!isNaN(dt.getTime())) return dt;
    }
  }

  // yyyy/mm/dd or dd/mm/yyyy or dd-mm-yyyy
  const parts = s.split(/[\/\-]/);
  if (parts.length === 3) {
    const a = parseInt(parts[0], 10);
    const b = parseInt(parts[1], 10);
    let y = parseInt(parts[2], 10);
    if (y < 100) y += 2000;
    // If first part > 12 -> dd/mm, else if second part > 12 -> mm/dd, else assume dd/mm
    let d = a,
      mth = b;
    if (a <= 12 && b > 12) {
      d = b;
      mth = a;
    }
    const dt = new Date(y, mth - 1, d);
    if (!isNaN(dt.getTime())) return dt;
  }

  return null;
};

const daysBetween = (a: Date, b: Date) =>
  Math.floor((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);

/** Case-insensitive, trimmed split on commas/semicolons */
const splitList = (s: string | undefined | null) =>
  String(s || "")
    .split(/[;,]\s*/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Treat “Accepted” as “Closed” for analytics */
const isClosedEquivalent = (i: AuditIssue) => {
  const status = String(i.currentStatus || "").toLowerCase();
  const ev = String((i as any).evidenceStatus || "").toLowerCase();
  return status === "closed" || status === "accepted" || ev === "accepted";
};

/** Shallow + nested date key finder by regex (depth-limited) */
const deepFindDateByKey = (
  obj: any,
  keyRegex: RegExp,
  depth = 0,
  maxDepth = 3
): Date | null => {
  if (!obj || typeof obj !== "object" || depth > maxDepth) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (keyRegex.test(k)) {
      const d = parseDateSmart(v as any);
      if (d) return d;
    }
    if (v && typeof v === "object") {
      const d = deepFindDateByKey(v, keyRegex, depth + 1, maxDepth);
      if (d) return d;
    }
  }
  return null;
};

/** Pull the date when an issue was accepted/closed (handles many field shapes) */
const getAcceptedAt = (i: AuditIssue): Date | null => {
  // Common direct fields
  const directFields = [
    "acceptedAt",
    "accepted_on",
    "acceptedDate",
    "acceptanceDate",
    "acceptanceTimestamp",
    "evidenceAcceptedAt",
    "closureDate",
    "closedAt",
    "closed_on",
    "statusChangedAt",
    "statusChangeDate",
    "statusDate",
    "approvedAt",
  ];
  for (const f of directFields) {
    const d = parseDateSmart((i as any)[f]);
    if (d) return d;
  }

  // Nested common
  const nestedPaths = [
    (i as any).evidence,
    (i as any).closure,
    (i as any).meta,
    (i as any).dates,
  ];
  for (const n of nestedPaths) {
    const d =
      deepFindDateByKey(
        n,
        /(accepted|approve|closure|closed).*?(date|time|at|on)$/i
      ) || deepFindDateByKey(n, /^(accepted|approve|closure|closed)(At|On)$/i);
    if (d) return d;
  }

  // Status history arrays
  const historyArrays: any[] = []
    .concat((i as any).statusHistory || [])
    .concat((i as any).history || [])
    .concat((i as any).statusLog || [])
    .filter(Boolean);
  if (historyArrays.length) {
    const interesting = historyArrays.flat().filter((e: any) =>
      String(e?.status || e?.state || e?.to || e?.value || "")
        .toLowerCase()
        .match(/accepted|closed/)
    );
    // Take the most recent of any typical date keys
    let best: Date | null = null;
    for (const e of interesting) {
      const cand =
        parseDateSmart(e?.date) ||
        parseDateSmart(e?.at) ||
        parseDateSmart(e?.timestamp) ||
        parseDateSmart(e?.time) ||
        parseDateSmart(e?.createdAt) ||
        parseDateSmart(e?.updatedAt);
      if (cand && (!best || cand > best)) best = cand;
    }
    if (best) return best;
  }

  // Fallback: if it's closed/accepted and updatedAt exists, use updatedAt
  if (isClosedEquivalent(i)) {
    const upd = parseDateSmart((i as any).updatedAt);
    if (upd) return upd;
  }

  return null;
};

/** Due date getter supporting multiple field names */
const getDueDate = (i: AuditIssue): Date | null => {
  const direct = [
    "dueDate",
    "timeline",
    "targetDate",
    "due_on",
    "due",
    "deadline",
    "expectedClosureDate",
    "expectedCloseOn",
    "target",
  ];
  for (const f of direct) {
    const d = parseDateSmart((i as any)[f]);
    if (d) return d;
  }
  // Nested lookups
  const nested =
    deepFindDateByKey(
      (i as any).meta,
      /(due|deadline|target).*?(date|time|at|on)$/i
    ) ||
    deepFindDateByKey(
      (i as any).dates,
      /(due|deadline|target).*?(date|time|at|on)$/i
    );
  if (nested) return nested;

  return null;
};

/** Normalize risk strings like “High”, “HIGH RISK”, “Med.”, “Low ” → high/medium/low/unknown */
const normalizeRisk = (
  r: string | undefined | null
): "high" | "medium" | "low" | "unknown" => {
  const s = String(r || "")
    .trim()
    .toLowerCase();
  if (/high/.test(s)) return "high";
  if (/med/.test(s)) return "medium";
  // use word boundary to avoid matching "slow"
  if (/\blow\b/.test(s) || s === "low") return "low";
  return "unknown";
};

/* ------------------------------ ErrorBoundary ----------------------------- */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; title?: string },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: any, info: any) {
    console.error("Analytics subcomponent crashed:", err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{this.props.title ?? "Chart"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-red-600">
              Could not render this visualization.
            </div>
          </CardContent>
        </Card>
      );
    }
    return this.props.children;
  }
}

/* ----------------------- Reusable Chart Root Hook ------------------------- */
function useAmRoot(containerRef: React.RefObject<HTMLDivElement>) {
  const rootRef = useRef<am5.Root | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (rootRef.current) {
      rootRef.current.dispose();
      rootRef.current = null;
    }
    const root = am5.Root.new(el);
    root.setThemes([am5themes_Animated.new(root)]);
    // Nice human-readable numbers everywhere
    root.numberFormatter.set("numberFormat", "#,###");
    rootRef.current = root;
    return () => {
      try {
        rootRef.current?.dispose();
      } catch {}
      rootRef.current = null;
    };
  }, [containerRef]);
  return rootRef;
}

/* ----------------------- Reusable Chart Components ------------------------ */
function PieChartBox({
  title,
  data,
  colors,
  height = 300,
  innerRadiusPct = 50,
  onSelect,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  colors?: string[];
  height?: number;
  innerRadiusPct?: number;
  onSelect?: (category: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useAmRoot(containerRef);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    // Reset the container so we don't stack multiple charts
    root.container.children.clear();

    let chart: am5percent.PieChart | null = null;
    try {
      chart = root.container.children.push(
        am5percent.PieChart.new(root, {
          layout: root.verticalLayout,
          innerRadius: am5.percent(innerRadiusPct),
          radius: am5.percent(95),
          startAngle: 0,
          endAngle: 360,
        })
      );

      const series = chart.series.push(
        am5percent.PieSeries.new(root, {
          name: "Series",
          categoryField: "name",
          valueField: "value",
          startAngle: 0,
          endAngle: 360,
        })
      );

      // keep given order (amCharts otherwise sorts by value)
      (series as any).set("sorting", "none");

      // slice + label styling
      series.slices.template.setAll({
        tooltipText:
          "{category}: {value.formatNumber('#,###')} ({valuePercentTotal.formatNumber('0.')}%)",
        stroke: am5.color(0xffffff),
        strokeOpacity: 1,
        strokeWidth: 1,
      });
      series.labels.template.setAll({
        text: "{category}",
        maxWidth: 160,
        oversizedBehavior: "truncate",
      });

      // --- sanitize data: numeric, drop zeros and "Unknown" ---
      const finalData = (data || [])
        .map((d) => ({ name: String(d.name), value: Number(d.value) || 0 }))
        .filter((d) => d.value > 0 && d.name !== "Unknown");

      series.data.setAll(finalData);

      // --- lock colors by category name after data validates ---
      const colorByName: Record<string, string> = {
        High: colors?.[0] ?? "#EF4444",
        Medium: colors?.[1] ?? "#F59E0B",
        Low: colors?.[2] ?? "#10B981",
      };

      series.events.on("datavalidated", () => {
        series.dataItems.forEach((di) => {
          const cat = (di.dataContext as any)?.name;
          const hex = colorByName[cat];
          if (hex) {
            const c = am5.color(hex);
            di.get("slice")?.setAll({ fill: c, stroke: c });
          }
        });
      });

      series.appear(600, 50);

      // legend with percents
      const legend = chart.children.push(
        am5.Legend.new(root, {
          centerX: am5.percent(50),
          x: am5.percent(50),
          marginTop: 10,
          layout: root.verticalLayout,
        })
      );
      legend.valueLabels.template.setAll({
        text: "{valuePercentTotal.formatNumber('0.00')}%",
      });
      legend.data.setAll(series.dataItems);
    } catch (e) {
      console.error("PieChart render error:", e);
    }

    return () => {
      try {
        chart?.dispose();
      } catch {}
    };
  }, [rootRef, data, colors, innerRadiusPct]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          style={{ width: "100%", height }}
          aria-label={`${title} chart`}
        />
      </CardContent>
    </Card>
  );
}

function BarChartBox({
  title,
  data,
  height = 300,
  angleLabels = false,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  height?: number;
  angleLabels?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useAmRoot(containerRef);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.container.children.clear();

    let chart: am5xy.XYChart | null = null;
    try {
      chart = root.container.children.push(
        am5xy.XYChart.new(root, {
          panX: false,
          panY: false,
          wheelX: "none",
          wheelY: "none",
          layout: root.verticalLayout,
        })
      );

      const xRenderer = am5xy.AxisRendererX.new(root, {
        minGridDistance: 20,
        cellStartLocation: 0.1,
        cellEndLocation: 0.9,
      });
      if (angleLabels) {
        xRenderer.labels.template.setAll({
          rotation: -45,
          centerY: am5.p50,
          centerX: am5.p100,
          oversizedBehavior: "truncate",
          maxWidth: 120,
        });
      }

      const xAxis = chart.xAxes.push(
        am5xy.CategoryAxis.new(root, {
          categoryField: "name",
          renderer: xRenderer,
          tooltip: am5.Tooltip.new(root, {}),
        })
      );

      const yAxis = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          renderer: am5xy.AxisRendererY.new(root, {}),
          min: 0,
          strictMinMax: true,
        })
      );

      const series = chart.series.push(
        am5xy.ColumnSeries.new(root, {
          name: "Count",
          xAxis,
          yAxis,
          categoryXField: "name",
          valueYField: "value",
          sequencedInterpolation: true,
          tooltip: am5.Tooltip.new(root, {
            labelText: "{categoryX}: {valueY.formatNumber('#,###')}",
          }),
        })
      );

      series.columns.template.setAll({
        cornerRadiusTL: 4,
        cornerRadiusTR: 4,
      });

      xAxis.data.setAll(data ?? []);
      series.data.setAll(data ?? []);

      chart.set(
        "cursor",
        am5xy.XYCursor.new(root, { behavior: "none", xAxis })
      );

      series.appear(600);
      chart.appear(600, 50);
    } catch (e) {
      console.error("BarChart render error:", e);
    }

    return () => {
      try {
        chart?.dispose();
      } catch {}
    };
  }, [rootRef, data, angleLabels]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          style={{ width: "100%", height }}
          aria-label={`${title} chart`}
        />
      </CardContent>
    </Card>
  );
}

function StackedBarChartBox({
  title,
  data,
  height = 300,
}: {
  title: string;
  data: Array<{ name: string; closed: number; open: number }>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useAmRoot(containerRef);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.container.children.clear();

    let chart: am5xy.XYChart | null = null;
    try {
      chart = root.container.children.push(
        am5xy.XYChart.new(root, {
          panX: false,
          panY: false,
          wheelX: "none",
          wheelY: "none",
          layout: root.verticalLayout,
        })
      );

      const xAxis = chart.xAxes.push(
        am5xy.CategoryAxis.new(root, {
          categoryField: "name",
          renderer: am5xy.AxisRendererX.new(root, {
            minGridDistance: 20,
            cellStartLocation: 0.1,
            cellEndLocation: 0.9,
          }),
        })
      );
      xAxis.get("renderer").labels.template.setAll({
        rotation: -45,
        centerY: am5.p50,
        centerX: am5.p100,
        oversizedBehavior: "truncate",
        maxWidth: 120,
      });

      const yAxis = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          renderer: am5xy.AxisRendererY.new(root, {}),
          min: 0,
          strictMinMax: true,
        })
      );

      const makeSeries = (
        name: string,
        field: "closed" | "open",
        color?: string
      ) => {
        const series = chart!.series.push(
          am5xy.ColumnSeries.new(root, {
            name,
            xAxis,
            yAxis,
            stacked: true,
            valueYField: field,
            categoryXField: "name",
            tooltip: am5.Tooltip.new(root, {
              labelText: `${name}: {valueY.formatNumber('#,###')}`,
            }),
          })
        );
        if (color) {
          series.columns.template.setAll({
            fill: am5.color(color),
            stroke: am5.color(color),
          });
        }
        series.data.setAll(data ?? []);
        series.appear(600);
        return series;
      };

      xAxis.data.setAll(data ?? []);

      makeSeries("Closed/Accepted", "closed", "#10B981"); // green
      makeSeries("Open", "open", "#F59E0B"); // amber

      chart.set(
        "cursor",
        am5xy.XYCursor.new(root, { behavior: "none", xAxis })
      );

      const legend = chart.children.push(
        am5.Legend.new(root, {
          centerX: am5.percent(50),
          x: am5.percent(50),
          marginTop: 10,
        })
      );
      legend.data.setAll(chart.series.values);
    } catch (e) {
      console.error("StackedBar render error:", e);
    }

    return () => {
      try {
        chart?.dispose();
      } catch {}
    };
  }, [rootRef, data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          style={{ width: "100%", height }}
          aria-label={`${title} chart`}
        />
      </CardContent>
    </Card>
  );
}

function LineChartBox({
  title,
  data,
  height = 300,
}: {
  title: string;
  data: Array<{ year: string; total: number; closed: number }>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useAmRoot(containerRef);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    root.container.children.clear();

    let chart: am5xy.XYChart | null = null;
    try {
      chart = root.container.children.push(
        am5xy.XYChart.new(root, {
          panX: false,
          panY: false,
          wheelX: "none",
          wheelY: "none",
          layout: root.verticalLayout,
        })
      );

      const xAxis = chart.xAxes.push(
        am5xy.CategoryAxis.new(root, {
          categoryField: "year",
          renderer: am5xy.AxisRendererX.new(root, {
            minGridDistance: 30,
          }),
        })
      );

      const yAxis = chart.yAxes.push(
        am5xy.ValueAxis.new(root, {
          renderer: am5xy.AxisRendererY.new(root, {}),
          min: 0,
        })
      );

      const mk = (name: string, field: "total" | "closed", color: string) =>
        chart!.series.push(
          am5xy.LineSeries.new(root, {
            name,
            xAxis,
            yAxis,
            valueYField: field,
            categoryXField: "year",
            sequencedInterpolation: true,
            tooltip: am5.Tooltip.new(root, {
              labelText: `${name}: {valueY.formatNumber('#,###')}`,
            }),
            stroke: am5.color(color),
          })
        );

      xAxis.data.setAll(data ?? []);

      const s1 = mk("Total", "total", "#3B82F6");
      const s2 = mk("Closed/Accepted", "closed", "#10B981");

      s1.data.setAll(data ?? []);
      s2.data.setAll(data ?? []);

      [s1, s2].forEach((s) =>
        s.bullets.push(() =>
          am5.Bullet.new(root, {
            sprite: am5.Circle.new(root, { radius: 4, fill: s.get("stroke") }),
          })
        )
      );

      chart.set(
        "cursor",
        am5xy.XYCursor.new(root, { behavior: "none", xAxis })
      );

      const legend = chart.children.push(
        am5.Legend.new(root, {
          centerX: am5.percent(50),
          x: am5.percent(50),
          marginTop: 10,
        })
      );
      legend.data.setAll(chart.series.values);
    } catch (e) {
      console.error("LineChart render error:", e);
    }

    return () => {
      try {
        chart?.dispose();
      } catch {}
    };
  }, [rootRef, data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={containerRef}
          style={{ width: "100%", height }}
          aria-label={`${title} chart`}
        />
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Main ----------------------------------- */
function Analytics({
  title = "Analytics Dashboard",
  auditIssues: propIssues,
  mode = "auto",
}: AnalyticsProps) {
  // All hooks must remain above ANY return
  const [mounted, setMounted] = useState(false);

  // Try to get the logged-in user's email for server-side filtering
  const auth = (useAuth?.() as any) || {};
  const viewerEmail: string =
    (
      auth?.user?.email ||
      auth?.email ||
      auth?.currentUser?.email ||
      auth?.profile?.email ||
      ""
    )?.toLowerCase?.() || "";

  // Pull from store if available (keeps Analytics consistent with AuditTable)
  let storageIssues: AuditIssue[] = [];
  try {
    storageIssues = (useAuditStorage() as any)?.auditIssues || [];
  } catch {
    // hook not available; ignore
  }

  // API fallback
  const [apiIssues, setApiIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // If parent/store already have something, stop spinner — but STILL fetch.
    // This lets auditors expand to ALL issues via API even if the store has a subset.
    if (
      (propIssues && propIssues.length) ||
      (storageIssues && storageIssues.length)
    ) {
      setLoading(false);
      setError(null);
      // no return; still attempt API below
    }

    let cancelled = false;

    (async () => {
      try {
        if (!viewerEmail) {
          // No viewer yet; rely on store/prop. Avoid hitting API which requires viewer.
          if (!cancelled) {
            setApiIssues([]);
            setLoading(false);
          }
          return;
        }

        // Try auditor scope first (server authorizes using viewer email), then fall back to mine.
        const tryFetch = async (urlStr: string) => {
          const res = await fetch(urlStr);
          if (!res.ok)
            throw Object.assign(new Error(`HTTP ${res.status}`), {
              status: res.status,
            });
          return (await res.json()) as AuditIssue[];
        };

        const base = `${API_BASE_URL}/audit-issues`;
        let data: AuditIssue[] = [];

        if (mode === "all") {
          // Force all
          data = await tryFetch(
            `${base}?scope=all&viewer=${encodeURIComponent(viewerEmail)}`
          );
        } else if (mode === "mine") {
          // Force mine
          data = await tryFetch(
            `${base}?viewer=${encodeURIComponent(viewerEmail)}`
          );
        } else {
          // auto (existing behavior): try all, then mine
          try {
            data = await tryFetch(
              `${base}?scope=all&viewer=${encodeURIComponent(viewerEmail)}`
            );
          } catch (e: any) {
            data = await tryFetch(
              `${base}?viewer=${encodeURIComponent(viewerEmail)}`
            );
          }
        }

        if (!cancelled) {
          setApiIssues(Array.isArray(data) ? data : []);
          setError(null);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerEmail, propIssues, storageIssues]);

  /** Effective source of truth for analytics */
  /** Effective source of truth for analytics */
  const auditIssues = useMemo<AuditIssue[]>(() => {
    const a = Array.isArray(apiIssues) ? apiIssues : [];
    const p = Array.isArray(propIssues) ? propIssues : [];
    const s = Array.isArray(storageIssues) ? storageIssues : [];

    if (mode === "mine") {
      // Never let a broader local store override a "my-only" view
      return p.length ? p : a;
    }
    if (mode === "all") {
      // Prefer API for all; fall back to prop/store if provided
      if (a.length) return a;
      if (p.length) return p;
      return s;
    }
    // auto (existing behavior): pick the broadest dataset
    const candidates = [a, p, s];
    return candidates.reduce(
      (best, cur) => ((cur?.length || 0) > (best?.length || 0) ? cur : best),
      [] as AuditIssue[]
    );
  }, [mode, propIssues, storageIssues, apiIssues]);

  // Safe to return after ALL hooks above
  if (loading) return <div className="p-6 text-center">Loading analytics…</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;

  /* --------------------------- Metrics & Datasets -------------------------- */

  // Completion = Closed OR Accepted; Open = not (Closed or Accepted)
  const totalIssues = auditIssues.length;
  const closedIssues = auditIssues.filter((i) => isClosedEquivalent(i)).length;
  const openIssues = totalIssues - closedIssues;
  const highRiskIssues = auditIssues.filter(
    (i) => normalizeRisk(i.riskLevel) === "high"
  ).length;
  const completionRate =
    totalIssues > 0 ? (closedIssues / totalIssues) * 100 : 0;

  // Status distribution (all statuses, shown as-is)
  const statusCounts = new Map<string, number>();
  for (const i of auditIssues) {
    const s = (i.currentStatus || "Unknown").trim();
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1);
  }
  const statusData = Array.from(statusCounts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // Risk distribution — normalize, and ALWAYS include High/Medium/Low buckets (Unknown only if present)
  // Risk distribution — High / Medium / Low only
  const riskBuckets = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const i of auditIssues) {
    riskBuckets[normalizeRisk(i.riskLevel)]++;
  }
  const riskData = [
    { name: "High", value: riskBuckets.high },
    { name: "Medium", value: riskBuckets.medium },
    { name: "Low", value: riskBuckets.low },
  ];

  // Process distribution: top 12 + "Others"
  const processCounts = new Map<string, number>();
  for (const i of auditIssues) {
    const p = (i.process || "—").trim();
    processCounts.set(p, (processCounts.get(p) || 0) + 1);
  }
  const processSorted = Array.from(processCounts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const processTop = processSorted.slice(0, 12);
  const processRest = processSorted.slice(12);
  const processOthers =
    processRest.length > 0
      ? [
          {
            name: "Others",
            value: processRest.reduce((s, x) => s + x.value, 0),
          },
        ]
      : [];
  const processData = [...processTop, ...processOthers];

  // Entity distribution: split multi-entity fields, top 12 + "Others"
  const entityCounts = new Map<string, { name: string; value: number }>();
  for (const issue of auditIssues) {
    const parts = splitList(issue.entityCovered);
    const seen = new Set<string>();
    for (const raw of parts) {
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (!entityCounts.has(key))
        entityCounts.set(key, { name: raw, value: 1 });
      else entityCounts.get(key)!.value += 1;
    }
  }
  const entitySorted = Array.from(entityCounts.values()).sort(
    (a, b) => b.value - a.value
  );
  const entityTop = entitySorted.slice(0, 12);
  const entityRest = entitySorted.slice(12);
  const entityOthers =
    entityRest.length > 0
      ? [{ name: "Others", value: entityRest.reduce((s, x) => s + x.value, 0) }]
      : [];
  const entityData = [...entityTop, ...entityOthers];

  // CXO performance: Closed/Accepted vs Open, aggregated across all emails in cxoResponsible
  const cxoAgg = new Map<
    string,
    { name: string; closed: number; open: number }
  >();
  for (const i of auditIssues) {
    const cxos = splitList(i.cxoResponsible);
    const closedEq = isClosedEquivalent(i);
    // count an issue once per listed CXO
    const seen = new Set<string>();
    for (const raw of cxos) {
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const human = raw.split("@")[0] || raw || "—";
      if (!cxoAgg.has(key))
        cxoAgg.set(key, { name: human, closed: 0, open: 0 });
      if (closedEq) cxoAgg.get(key)!.closed += 1;
      else cxoAgg.get(key)!.open += 1;
    }
    // handle issues with no CXO
    if (cxos.length === 0) {
      const key = "—";
      if (!cxoAgg.has(key)) cxoAgg.set(key, { name: "—", closed: 0, open: 0 });
      if (closedEq) cxoAgg.get(key)!.closed += 1;
      else cxoAgg.get(key)!.open += 1;
    }
  }
  const cxoData = Array.from(cxoAgg.values())
    .sort((a, b) => b.closed + b.open - (a.closed + a.open))
    .slice(0, 12);

  // Fiscal year trend: Total vs Closed/Accepted per fiscalYear
  const fySet = Array.from(
    new Set(auditIssues.map((i) => i.fiscalYear))
  ).sort();
  const fiscalYearData = fySet.map((year) => ({
    year,
    total: auditIssues.filter((i) => i.fiscalYear === year).length,
    closed: auditIssues.filter(
      (i) => i.fiscalYear === year && isClosedEquivalent(i)
    ).length,
  }));

  // --- Aging buckets (open items only) ---
  const today = startOfDay(new Date());

  const overdueBuckets: Record<string, number> = {
    "0–30": 0,
    "31–60": 0,
    "61–90": 0,
    ">90": 0,
  };
  const upcomingBuckets: Record<string, number> = {
    "≤30": 0,
    "31–60": 0,
    "61–90": 0,
  };

  for (const i of auditIssues) {
    if (isClosedEquivalent(i)) continue;
    const d = getDueDate(i);
    if (!d) continue;

    if (d < today) {
      // overdue
      const late = daysBetween(today, d); // 1..N
      if (late <= 30) overdueBuckets["0–30"]++;
      else if (late <= 60) overdueBuckets["31–60"]++;
      else if (late <= 90) overdueBuckets["61–90"]++;
      else overdueBuckets[">90"]++;
    } else {
      // upcoming (due today counts as ≤30)
      const ahead = daysBetween(d, today); // 0..N
      if (ahead <= 30) upcomingBuckets["≤30"]++;
      else if (ahead <= 60) upcomingBuckets["31–60"]++;
      else if (ahead <= 90) upcomingBuckets["61–90"]++;
    }
  }

  const overdueData = ["0–30", "31–60", "61–90", ">90"].map((k) => ({
    name: k,
    value: overdueBuckets[k],
  }));

  const upcomingData = ["≤30", "31–60", "61–90"].map((k) => ({
    name: k,
    value: upcomingBuckets[k],
  }));

  /* --------------------------------- Render -------------------------------- */

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
                <p className="text-sm text-gray-600">
                  Completed (Closed/Accepted)
                </p>
                <p className="text-3xl font-bold text-green-600">
                  {closedIssues}
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
                <p className="text-sm text-gray-600">Open</p>
                <p className="text-3xl font-bold text-orange-600">
                  {openIssues}
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

      {/* Charts (render after mount to avoid SSR/hydration hitches) */}
      {mounted && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ErrorBoundary title="Status Distribution">
            <PieChartBox
              title="Status Distribution"
              data={statusData}
              // Colors (tune to your palette)
              colors={["#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#6B7280"]}
              innerRadiusPct={55}
            />
          </ErrorBoundary>

          <ErrorBoundary title="Risk Level Distribution">
            <PieChartBox
              title="Risk Level Distribution"
              data={riskData}
              colors={["#EF4444", "#F59E0B", "#10B981"]} // High, Medium, Low
              innerRadiusPct={55}
            />
          </ErrorBoundary>

          <ErrorBoundary title="Issues by Process (Top 12)">
            <BarChartBox
              title="Issues by Process (Top 12)"
              data={processData}
              angleLabels
            />
          </ErrorBoundary>

          <ErrorBoundary title="CXO Performance (Closed/Accepted vs Open)">
            <StackedBarChartBox
              title="CXO Performance (Closed/Accepted vs Open)"
              data={cxoData}
            />
          </ErrorBoundary>

          <ErrorBoundary title="Fiscal Year Trend (Total vs Closed/Accepted)">
            <LineChartBox
              title="Fiscal Year Trend (Total vs Closed/Accepted)"
              data={fiscalYearData}
            />
          </ErrorBoundary>

          <ErrorBoundary title="Issues by Entity (Top 12)">
            <BarChartBox
              title="Issues by Entity (Top 12)"
              data={entityData}
              angleLabels
            />
          </ErrorBoundary>

          <ErrorBoundary title="Aging — Overdue Buckets">
            <PieChartBox
              title="Aging — Overdue Buckets"
              data={overdueData}
              innerRadiusPct={55} // donut
              // yellow → amber → orange → red
              colors={["#FDE047", "#F59E0B", "#F97316", "#EF4444"]}
            />
          </ErrorBoundary>

          <ErrorBoundary title="Due in Next 30/60/90 Days">
            <BarChartBox
              title="Due in Next 30/60/90 Days"
              data={upcomingData}
            />
          </ErrorBoundary>
        </div>
      )}

      {/* Reports: Dynamic Table (always shows rows; includes fallback) */}
      <ReportsTableSection issues={auditIssues} viewerEmail={viewerEmail} />
    </div>
  );
}

/* ------------------------- Reports Table Section -------------------------- */

function ReportsTableSection({
  issues,
  viewerEmail,
}: {
  issues: AuditIssue[];
  viewerEmail?: string;
}) {
  type ReportMode = "upcoming" | "recent" | "overdue";
  const [reportMode, setReportMode] = React.useState<ReportMode>("upcoming");
  const [periodDays, setPeriodDays] = React.useState<"30" | "60" | "90">("90");
  const userTouched = React.useRef(false);

  const today = React.useMemo(() => startOfDay(new Date()), []);
  const horizonStart = React.useMemo(
    () => addDays(today, -Number(periodDays)),
    [today, periodDays]
  );
  const horizonEnd = React.useMemo(
    () => addDays(today, Number(periodDays)),
    [today, periodDays]
  );

  // Pick an initial view that actually has rows (only once)
  React.useEffect(() => {
    if (!issues?.length || userTouched.current) return;

    const due = (i: AuditIssue) => getDueDate(i);
    const accepted = (i: AuditIssue) => getAcceptedAt(i);

    const upcomingCount = issues.filter((i) => {
      const d = due(i);
      return !!d && d >= today && d <= horizonEnd && !isClosedEquivalent(i);
    }).length;

    const overdueCount = issues.filter((i) => {
      const d = due(i);
      return !!d && d < today && !isClosedEquivalent(i);
    }).length;

    const recentCount = issues.filter((i) => {
      if (!isClosedEquivalent(i)) return false;
      const a = accepted(i) || parseDateSmart((i as any).updatedAt);
      return !!a && a >= horizonStart && a <= today;
    }).length;

    if (upcomingCount > 0) setReportMode("upcoming");
    else if (overdueCount > 0) setReportMode("overdue");
    else if (recentCount > 0) setReportMode("recent");
  }, [issues, today, horizonEnd, horizonStart]);

  // Main filtered rows
  const rowsMain = React.useMemo(() => {
    if (!Array.isArray(issues) || issues.length === 0) return [];

    const due = (i: AuditIssue) => getDueDate(i);
    const accepted = (i: AuditIssue) => getAcceptedAt(i);

    if (reportMode === "recent") {
      // Closed/Accepted in last N days
      return issues
        .filter((i) => {
          if (!isClosedEquivalent(i)) return false;
          const a = accepted(i) || parseDateSmart((i as any).updatedAt);
          return !!a && a >= horizonStart && a <= today;
        })
        .sort(
          (a, b) =>
            (
              accepted(b) ||
              parseDateSmart((b as any).updatedAt) ||
              today
            ).getTime() -
            (
              accepted(a) ||
              parseDateSmart((a as any).updatedAt) ||
              today
            ).getTime()
        );
    }

    if (reportMode === "upcoming") {
      // Due in next N days
      return issues
        .filter((i) => {
          const d = due(i);
          return !!d && d >= today && d <= horizonEnd && !isClosedEquivalent(i);
        })
        .sort((a, b) => due(a)!.getTime() - due(b)!.getTime());
    }

    // Overdue in last N days (bucketed same as upcoming but in the past)
    return issues
      .filter((i) => {
        const d = due(i);
        return !!d && d < today && d >= horizonStart && !isClosedEquivalent(i);
      })
      .sort((a, b) => due(a)!.getTime() - due(b)!.getTime());
  }, [issues, reportMode, horizonStart, horizonEnd, today]);

  // Hard fallback to ensure table is populated even when nothing matches
  const fallbackRows = React.useMemo(() => {
    if (!Array.isArray(issues) || issues.length === 0) return [];
    // Sort by a "best available" timestamp: acceptedAt > updatedAt > dueDate > createdAt
    const getBestDate = (i: any): Date | null =>
      getAcceptedAt(i) ||
      parseDateSmart(i?.updatedAt) ||
      getDueDate(i) ||
      parseDateSmart(i?.createdAt) ||
      null;

    return [...issues].sort((a, b) => {
      const da = getBestDate(a) || new Date(0);
      const db = getBestDate(b) || new Date(0);
      return db.getTime() - da.getTime();
    });
  }, [issues]);

  const usingFallback = rowsMain.length === 0 && fallbackRows.length > 0;
  const rows = usingFallback ? fallbackRows : rowsMain;

  const title = usingFallback
    ? "All Issues (no matches — showing all)"
    : reportMode === "upcoming"
    ? `Due in next ${periodDays} days`
    : reportMode === "recent"
    ? `Closed/Accepted in last ${periodDays} days`
    : `Overdue (last ${periodDays} days)`;

  const renderAging = (issue: AuditIssue) => {
    const d = getDueDate(issue);
    if (!d) return "—";
    const diff = daysBetween(today, d); // positive => overdue, negative => in future
    if (diff > 0) return `${diff} day(s) overdue`;
    if (diff === 0) return "due today";
    return `in ${Math.abs(diff)} day(s)`;
  };

  const onExportXlsx = async () => {
    // (unchanged) client-side quick export of the visible columns
    const XLSX = await import("xlsx");
    const exportRows = rows.map((i, idx) => {
      const due = getDueDate(i);
      const accepted = getAcceptedAt(i) || parseDateSmart((i as any).updatedAt);
      return {
        "S.No": i.serialNumber ?? idx + 1,
        Process: i.process || "",
        Entity: i.entityCovered || "",
        "Due Date": due ? due.toISOString().slice(0, 10) : "",
        Status: i.currentStatus || "",
        Aging: renderAging(i),
        "Accepted/Updated On": accepted
          ? accepted.toISOString().slice(0, 10)
          : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `analytics_${reportMode}_${periodDays}d.xlsx`);
  };

  // NEW: server-side detailed export (uses viewer auth + same filters)
  const onExportServer = async () => {
    if (!viewerEmail) {
      alert("Sign in to export the detailed report.");
      return;
    }
    const params = new URLSearchParams({
      viewer: viewerEmail,
      scope: "all", // server will down-scope if needed
      mode: reportMode, // upcoming|recent|overdue
      days: String(periodDays), // 30|60|90
    });
    const url = `${API_BASE_URL}/audit-issues/export-filtered?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      alert(`Export failed (${res.status}). ${msg || ""}`);
      return;
    }
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `analytics_${reportMode}_${periodDays}d_detailed.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Report — {title}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters specifically for the table */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end mb-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">View</div>
            <select
              value={reportMode}
              onChange={(e) => {
                userTouched.current = true;
                setReportMode(e.target.value as ReportMode);
              }}
              className="border rounded p-2 w-full"
            >
              <option value="upcoming">Due (next N days)</option>
              <option value="recent">Closed/Accepted (last N days)</option>
              <option value="overdue">Overdue (last N days)</option>
            </select>

            <select
              value={periodDays}
              onChange={(e) =>
                setPeriodDays(e.target.value as "30" | "60" | "90")
              }
              className="border rounded p-2 w-full"
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">Period</div>
            <select
              value={periodDays}
              onChange={(e) =>
                setPeriodDays(e.target.value as "30" | "60" | "90")
              }
              disabled={reportMode === "overdue" || usingFallback}
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
              {title}
            </div>
          </div>
        </div>

        {usingFallback && (
          <div className="text-xs text-gray-500 mb-2">
            No items matched the current filter. Showing all issues instead.
          </div>
        )}

        <div className="flex justify-end gap-2 mb-3">
          <Button
            variant="outline"
            onClick={onExportXlsx}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Export XLSX (this table)
          </Button>
          <Button
            onClick={onExportServer}
            className="flex items-center gap-2"
            disabled={!viewerEmail}
            title={
              !viewerEmail
                ? "Sign in required"
                : "Download detailed XLSX from server"
            }
          >
            <Download className="h-4 w-4" />
            Export Detailed XLSX
          </Button>
        </div>

        {/* The table */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">S.No</TableHead>
                <TableHead className="whitespace-nowrap">Process</TableHead>
                <TableHead className="whitespace-nowrap">Entity</TableHead>
                <TableHead className="whitespace-nowrap">Due Date</TableHead>
                <TableHead className="whitespace-nowrap">Status</TableHead>
                <TableHead className="whitespace-nowrap">Aging</TableHead>
                <TableHead className="whitespace-nowrap">
                  Accepted/Updated On
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-500">
                    No issues available.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((i, idx) => {
                  const due = getDueDate(i);
                  const accepted =
                    getAcceptedAt(i) || parseDateSmart((i as any).updatedAt);
                  const rowKey =
                    (i as any).id ??
                    `${i.process || "proc"}-${i.serialNumber || idx}`;

                  return (
                    <TableRow key={rowKey}>
                      <TableCell className="whitespace-nowrap">
                        {i.serialNumber ?? idx + 1}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {i.process || "—"}
                      </TableCell>
                      <TableCell className="whitespace-pre-wrap">
                        {i.entityCovered || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {due ? due.toISOString().slice(0, 10) : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {i.currentStatus || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {renderAging(i)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {accepted ? accepted.toISOString().slice(0, 10) : "—"}
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
  );
}

export { Analytics };
export default Analytics;
