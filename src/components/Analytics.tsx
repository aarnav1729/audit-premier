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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuditIssue } from "@/types/audit";
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Download,
  Eye,
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

type ChartSelection = {
  category: string;
  series?: string;
};

/* ------------------------------- Utils ------------------------------------ */
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
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
  onSelect?: (selection: ChartSelection) => void;
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
        cursorOverStyle: "pointer",
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

      if (onSelect) {
        series.slices.template.events.on("click", (event) => {
          const ctx = event.target.dataItem?.dataContext as any;
          const category = String(ctx?.name || "").trim();
          if (category) onSelect({ category });
        });
      }

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
  }, [rootRef, data, colors, innerRadiusPct, onSelect]);

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
  onSelect,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  height?: number;
  angleLabels?: boolean;
  onSelect?: (selection: ChartSelection) => void;
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
        cursorOverStyle: "pointer",
      });

      if (onSelect) {
        series.columns.template.events.on("click", (event) => {
          const ctx = event.target.dataItem?.dataContext as any;
          const category = String(ctx?.name || "").trim();
          if (category) onSelect({ category });
        });
      }

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
  }, [rootRef, data, angleLabels, onSelect]);

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
  onSelect,
}: {
  title: string;
  data: Array<{ name: string; closed: number; open: number }>;
  height?: number;
  onSelect?: (selection: ChartSelection) => void;
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
            cursorOverStyle: "pointer",
          });
        }
        if (onSelect) {
          series.columns.template.events.on("click", (event) => {
            const ctx = event.target.dataItem?.dataContext as any;
            const category = String(ctx?.name || "").trim();
            if (category) {
              onSelect({
                category,
                series: field,
              });
            }
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
  }, [rootRef, data, onSelect]);

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
  onSelect,
}: {
  title: string;
  data: Array<{ year: string; total: number; closed: number }>;
  height?: number;
  onSelect?: (selection: ChartSelection) => void;
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

      const mk = (name: string, field: "total" | "closed", color: string) => {
        const series = chart!.series.push(
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

        series.strokes.template.setAll({ strokeWidth: 3 });
        series.bullets.push((_root, _series, dataItem) => {
          const circle = am5.Circle.new(root, {
            radius: 5,
            fill: am5.color(color),
            stroke: am5.color(0xffffff),
            strokeWidth: 2,
            cursorOverStyle: "pointer",
          });

          if (onSelect) {
            circle.events.on("click", () => {
              const ctx = dataItem.dataContext as any;
              const category = String(ctx?.year || "").trim();
              if (category) {
                onSelect({
                  category,
                  series: field,
                });
              }
            });
          }

          return am5.Bullet.new(root, {
            sprite: circle,
          });
        });

        return series;
      };

      xAxis.data.setAll(data ?? []);

      const s1 = mk("Total", "total", "#3B82F6");
      const s2 = mk("Closed/Accepted", "closed", "#10B981");

      s1.data.setAll(data ?? []);
      s2.data.setAll(data ?? []);

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
  }, [rootRef, data, onSelect]);

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
  const auditStorage = useAuditStorage() as { auditIssues?: AuditIssue[] };
  const storageIssues = auditStorage?.auditIssues || [];

  // API fallback
  const [apiIssues, setApiIssues] = useState<AuditIssue[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<{
    sourceKey: string;
    title: string;
    description: string;
    rows: AuditIssue[];
  } | null>(null);
  const [detailIssue, setDetailIssue] = useState<AuditIssue | null>(null);
  const drilldownRef = useRef<HTMLDivElement | null>(null);

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
    { key: string; name: string; closed: number; open: number }
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
        cxoAgg.set(key, { key, name: human, closed: 0, open: 0 });
      if (closedEq) cxoAgg.get(key)!.closed += 1;
      else cxoAgg.get(key)!.open += 1;
    }
    // handle issues with no CXO
    if (cxos.length === 0) {
      const key = "—";
      if (!cxoAgg.has(key))
        cxoAgg.set(key, { key, name: "—", closed: 0, open: 0 });
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

  const processTopNames = processTop.map((item) => item.name);
  const entityTopNames = entityTop.map((item) => item.name);

  const formatIssueDate = (value?: string | null) => {
    if (!value) return "—";
    const parsed = parseDateSmart(value);
    return parsed ? parsed.toLocaleDateString() : String(value);
  };

  const renderAging = (issue: AuditIssue) => {
    const d = getDueDate(issue);
    if (!d) return "No due date";
    const diff = daysBetween(today, d);
    if (isClosedEquivalent(issue)) return "Closed";
    if (diff > 0) return `${diff} day(s) overdue`;
    if (diff === 0) return "Due today";
    return `Due in ${Math.abs(diff)} day(s)`;
  };

  const buildExportRows = (rows: AuditIssue[]) =>
    rows.map((issue, index) => ({
      "S.No": issue.serialNumber ?? index + 1,
      Process: issue.process || "",
      Entity: issue.entityCovered || "",
      Observation: issue.observation || "",
      "Person Responsible": issue.personResponsible || "",
      Approver: issue.approver || "",
      "CXO Responsible": issue.cxoResponsible || "",
      "Due Date": getDueDate(issue)?.toISOString().slice(0, 10) || "",
      Status: issue.currentStatus || "",
      "Evidence Status": (issue as any).evidenceStatus || "",
      Aging: renderAging(issue),
      "Accepted/Closed On":
        getAcceptedAt(issue)?.toISOString().slice(0, 10) || "",
      "Updated At": issue.updatedAt || "",
    }));

  const exportIssues = async (rows: AuditIssue[], suffix: string) => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(buildExportRows(rows));
    XLSX.utils.book_append_sheet(workbook, worksheet, "Analytics");
    XLSX.writeFile(
      workbook,
      `analytics_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const openDrilldown = (
    sourceKey: string,
    nextTitle: string,
    rows: AuditIssue[],
    description: string
  ) => {
    setDrilldown({
      sourceKey,
      title: nextTitle,
      rows,
      description,
    });

    window.requestAnimationFrame(() => {
      drilldownRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleStatusDrilldown = (selection: ChartSelection) => {
    const category = selection.category;
    const rows = auditIssues.filter(
      (issue) => (issue.currentStatus || "Unknown").trim() === category
    );
    openDrilldown(
      "status",
      `Status: ${category}`,
      rows,
      "Issues contributing to the selected status bucket."
    );
  };

  const handleRiskDrilldown = (selection: ChartSelection) => {
    const target = selection.category.toLowerCase();
    const rows = auditIssues.filter(
      (issue) => normalizeRisk(issue.riskLevel) === target
    );
    openDrilldown(
      "risk",
      `Risk level: ${selection.category}`,
      rows,
      "Issues contributing to the selected risk distribution."
    );
  };

  const handleProcessDrilldown = (selection: ChartSelection) => {
    const category = selection.category;
    const rows =
      category === "Others"
        ? auditIssues.filter(
            (issue) => !processTopNames.includes((issue.process || "—").trim())
          )
        : auditIssues.filter((issue) => (issue.process || "—").trim() === category);
    openDrilldown(
      "process",
      `Process: ${category}`,
      rows,
      "Issues grouped under the selected process bucket."
    );
  };

  const handleCxoDrilldown = (selection: ChartSelection) => {
    const category = selection.category;
    const rows = auditIssues.filter((issue) => {
      const cxos = splitList(issue.cxoResponsible);
      const matches =
        category === "—"
          ? cxos.length === 0
          : cxos.some((raw) => (raw.split("@")[0] || raw || "—") === category);

      if (!matches) return false;

      if (selection.series === "closed") return isClosedEquivalent(issue);
      if (selection.series === "open") return !isClosedEquivalent(issue);
      return true;
    });

    openDrilldown(
      "cxo",
      `CXO: ${category}${
        selection.series === "closed"
          ? " · Closed/Accepted"
          : selection.series === "open"
          ? " · Open"
          : ""
      }`,
      rows,
      "Issues represented by the selected CXO performance segment."
    );
  };

  const handleFiscalYearDrilldown = (selection: ChartSelection) => {
    const rows = auditIssues.filter((issue) => {
      if (issue.fiscalYear !== selection.category) return false;
      if (selection.series === "closed") return isClosedEquivalent(issue);
      return true;
    });

    openDrilldown(
      "fiscal-year",
      `Fiscal year: ${selection.category}${
        selection.series === "closed" ? " · Closed/Accepted" : ""
      }`,
      rows,
      "Issues represented by the selected fiscal year trend point."
    );
  };

  const handleEntityDrilldown = (selection: ChartSelection) => {
    const category = selection.category;
    const rows =
      category === "Others"
        ? auditIssues.filter((issue) =>
            splitList(issue.entityCovered).every(
              (entity) => !entityTopNames.includes(entity)
            )
          )
        : auditIssues.filter((issue) =>
            splitList(issue.entityCovered).includes(category)
          );
    openDrilldown(
      "entity",
      `Entity: ${category}`,
      rows,
      "Issues represented by the selected entity bucket."
    );
  };

  const handleOverdueDrilldown = (selection: ChartSelection) => {
    const rows = auditIssues.filter((issue) => {
      if (isClosedEquivalent(issue)) return false;
      const d = getDueDate(issue);
      if (!d || d >= today) return false;
      const late = daysBetween(today, d);
      if (selection.category === "0–30") return late <= 30;
      if (selection.category === "31–60") return late > 30 && late <= 60;
      if (selection.category === "61–90") return late > 60 && late <= 90;
      return late > 90;
    });
    openDrilldown(
      "overdue",
      `Overdue bucket: ${selection.category}`,
      rows,
      "Open issues represented by the selected overdue aging bucket."
    );
  };

  const handleUpcomingDrilldown = (selection: ChartSelection) => {
    const rows = auditIssues.filter((issue) => {
      if (isClosedEquivalent(issue)) return false;
      const d = getDueDate(issue);
      if (!d || d < today) return false;
      const ahead = daysBetween(d, today);
      if (selection.category === "≤30") return ahead <= 30;
      if (selection.category === "31–60") return ahead > 30 && ahead <= 60;
      return ahead > 60 && ahead <= 90;
    });
    openDrilldown(
      "upcoming",
      `Due soon: ${selection.category}`,
      rows,
      "Open issues represented by the selected upcoming due bucket."
    );
  };

  const renderDrilldownCard = (sourceKey: string) => {
    if (!drilldown || drilldown.sourceKey !== sourceKey) return null;

    return (
      <Card ref={drilldownRef}>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <CardTitle>{drilldown.title}</CardTitle>
              <p className="text-sm text-gray-600">{drilldown.description}</p>
              <Badge
                variant="secondary"
                className="w-fit border border-slate-200 bg-slate-100 text-slate-700"
              >
                {drilldown.rows.length} issue
                {drilldown.rows.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => exportIssues(auditIssues, "all_visible")}
                disabled={auditIssues.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export all
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  exportIssues(drilldown.rows, `${sourceKey}_filtered`)
                }
                disabled={drilldown.rows.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export filtered
              </Button>
              <Button variant="ghost" onClick={() => setDrilldown(null)}>
                Clear selection
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Issue</TableHead>
                  <TableHead className="whitespace-nowrap">Process</TableHead>
                  <TableHead className="whitespace-nowrap">Entity</TableHead>
                  <TableHead className="whitespace-nowrap">
                    Person Responsible
                  </TableHead>
                  <TableHead className="whitespace-nowrap">Due</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap">Aging</TableHead>
                  <TableHead className="whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drilldown.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-gray-500">
                      No issues found for the selected chart segment.
                    </TableCell>
                  </TableRow>
                ) : (
                  drilldown.rows.map((issue, index) => (
                    <TableRow
                      key={(issue as any).id || `${issue.serialNumber}-${index}`}
                    >
                      <TableCell className="whitespace-nowrap font-medium">
                        #{issue.serialNumber ?? index + 1}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {issue.process || "—"}
                      </TableCell>
                      <TableCell className="max-w-[260px] whitespace-normal">
                        {issue.entityCovered || "—"}
                      </TableCell>
                      <TableCell className="max-w-[260px] whitespace-normal">
                        {issue.personResponsible || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {getDueDate(issue)?.toLocaleDateString() || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {issue.currentStatus || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {renderAging(issue)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailIssue(issue)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          Detail
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    );
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
        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-600">
            Click any chart slice, bar, or point to open the supporting issue
            table directly below that chart.
          </div>

          <ErrorBoundary title="Status Distribution">
            <PieChartBox
              title="Status Distribution"
              data={statusData}
              // Colors (tune to your palette)
              colors={["#10B981", "#3B82F6", "#F59E0B", "#EF4444", "#6B7280"]}
              innerRadiusPct={55}
              height={360}
              onSelect={handleStatusDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("status")}

          <ErrorBoundary title="Risk Level Distribution">
            <PieChartBox
              title="Risk Level Distribution"
              data={riskData}
              colors={["#EF4444", "#F59E0B", "#10B981"]} // High, Medium, Low
              innerRadiusPct={55}
              height={360}
              onSelect={handleRiskDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("risk")}

          <ErrorBoundary title="Issues by Process (Top 12)">
            <BarChartBox
              title="Issues by Process (Top 12)"
              data={processData}
              angleLabels
              height={360}
              onSelect={handleProcessDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("process")}

          <ErrorBoundary title="CXO Performance (Closed/Accepted vs Open)">
            <StackedBarChartBox
              title="CXO Performance (Closed/Accepted vs Open)"
              data={cxoData}
              height={380}
              onSelect={handleCxoDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("cxo")}

          <ErrorBoundary title="Fiscal Year Trend (Total vs Closed/Accepted)">
            <LineChartBox
              title="Fiscal Year Trend (Total vs Closed/Accepted)"
              data={fiscalYearData}
              height={360}
              onSelect={handleFiscalYearDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("fiscal-year")}

          <ErrorBoundary title="Issues by Entity (Top 12)">
            <BarChartBox
              title="Issues by Entity (Top 12)"
              data={entityData}
              angleLabels
              height={360}
              onSelect={handleEntityDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("entity")}

          <ErrorBoundary title="Aging — Overdue Buckets">
            <PieChartBox
              title="Aging — Overdue Buckets"
              data={overdueData}
              innerRadiusPct={55} // donut
              // yellow → amber → orange → red
              colors={["#FDE047", "#F59E0B", "#F97316", "#EF4444"]}
              height={360}
              onSelect={handleOverdueDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("overdue")}

          <ErrorBoundary title="Due in Next 30/60/90 Days">
            <BarChartBox
              title="Due in Next 30/60/90 Days"
              data={upcomingData}
              height={340}
              onSelect={handleUpcomingDrilldown}
            />
          </ErrorBoundary>
          {renderDrilldownCard("upcoming")}
        </div>
      )}

      <Dialog
        open={!!detailIssue}
        onOpenChange={(open) => {
          if (!open) setDetailIssue(null);
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-[900px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detailIssue
                ? `Issue #${detailIssue.serialNumber} - ${detailIssue.process}`
                : "Issue detail"}
            </DialogTitle>
          </DialogHeader>

          {detailIssue && (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Entity
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {detailIssue.entityCovered || "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Person Responsible
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {detailIssue.personResponsible || "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Due Date
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {getDueDate(detailIssue)?.toLocaleDateString() || "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Updated
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {formatIssueDate(detailIssue.updatedAt)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Accepted/Closed
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {getAcceptedAt(detailIssue)?.toLocaleDateString() || "—"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Observation</CardTitle>
                </CardHeader>
                <CardContent className="text-sm leading-6 text-slate-700">
                  {detailIssue.observation || "—"}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Action required</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-slate-700">
                    {detailIssue.actionRequired || "—"}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recommendation</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-6 text-slate-700">
                    {detailIssue.recommendation || "—"}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Routing</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Approver
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {detailIssue.approver || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      CXO Responsible
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {detailIssue.cxoResponsible || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                      Evidence Status
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {(detailIssue as any).evidenceStatus || "—"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { Analytics };
export default Analytics;
