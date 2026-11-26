"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export interface InlineChartSpec {
  chartType: "bar" | "line" | "pie";
  title: string;
  valuePrefix?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  data: Array<{
    label: string;
    value: number;
    secondaryValue?: number;
  }>;
}

const COLORS = [
  "#10b981",
  "#6366f1",
  "#f59e0b",
  "#f43f5e",
  "#06b6d4",
  "#a855f7",
  "#ec4899",
];

export function ChatInlineChart({ spec }: { spec: InlineChartSpec }) {
  const prefix = spec.valuePrefix ?? "R$ ";

  const formatVal = (v: number) =>
    `${prefix}${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="my-3 rounded-xl border border-slate-700/80 bg-slate-950/80 p-4">
      <div className="mb-3 text-xs font-semibold text-slate-200">{spec.title}</div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.chartType === "pie" ? (
            <PieChart>
              <Pie
                data={spec.data}
                dataKey="value"
                nameKey="label"
                innerRadius={45}
                outerRadius={78}
                paddingAngle={3}
              >
                {spec.data.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                formatter={(v: number) => formatVal(v)}
              />
            </PieChart>
          ) : spec.chartType === "line" ? (
            <LineChart data={spec.data} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                formatter={(v: number) => formatVal(v)}
              />
              <Line
                type="monotone"
                dataKey="value"
                name={spec.primaryLabel ?? "Valor"}
                stroke="#10b981"
                strokeWidth={2.5}
                dot={{ r: 3 }}
              />
              {spec.secondaryLabel && (
                <Line
                  type="monotone"
                  dataKey="secondaryValue"
                  name={spec.secondaryLabel}
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              )}
            </LineChart>
          ) : (
            <BarChart data={spec.data} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderColor: "#334155",
                  borderRadius: "10px",
                  fontSize: "12px",
                }}
                formatter={(v: number) => formatVal(v)}
              />
              <Bar
                dataKey="value"
                name={spec.primaryLabel ?? "Valor"}
                fill="#10b981"
                radius={[6, 6, 0, 0]}
              />
              {spec.secondaryLabel && (
                <Bar
                  dataKey="secondaryValue"
                  name={spec.secondaryLabel}
                  fill="#f43f5e"
                  radius={[6, 6, 0, 0]}
                />
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
