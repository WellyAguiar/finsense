"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from "recharts";
import { formatBRL, formatPercent } from "@/lib/format";

export function CashflowChart({
  data,
}: {
  data: Array<{
    monthKey: string;
    label: string;
    incomeCents: number;
    expenseCents: number;
    netCents: number;
  }>;
}) {
  const chartData = data.map((d) => ({
    label: d.label,
    Entradas: Number((d.incomeCents / 100).toFixed(2)),
    Saídas: Number((d.expenseCents / 100).toFixed(2)),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis
            stroke="#94a3b8"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `R$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              borderColor: "#334155",
              borderRadius: "12px",
              fontSize: "12px",
            }}
            formatter={(value: number) => formatBRL(Math.round(value * 100))}
          />
          <Bar dataKey="Entradas" fill="#10b981" radius={[6, 6, 0, 0]} />
          <Bar dataKey="Saídas" fill="#f43f5e" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBreakdownChart({
  data,
}: {
  data: Array<{
    categoryId: string;
    categoryName: string;
    categoryColor: string;
    totalCents: number;
    share: number;
  }>;
}) {
  const top = data.slice(0, 7);

  if (top.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-slate-400">
        Sem despesas categorizadas neste mês.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={top}
              dataKey="totalCents"
              nameKey="categoryName"
              innerRadius={52}
              outerRadius={82}
              paddingAngle={3}
            >
              {top.map((entry) => (
                <Cell key={entry.categoryId} fill={entry.categoryColor} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                borderColor: "#334155",
                borderRadius: "12px",
                fontSize: "12px",
              }}
              formatter={(value: number) => formatBRL(value)}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {top.map((item) => (
          <div key={item.categoryId} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.categoryColor }}
              />
              <span className="truncate text-slate-200">{item.categoryName}</span>
            </div>
            <div className="ml-2 shrink-0 text-right">
              <span className="font-medium text-white">{formatBRL(item.totalCents)}</span>
              <span className="ml-1.5 text-slate-400">{formatPercent(item.share, 0)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
