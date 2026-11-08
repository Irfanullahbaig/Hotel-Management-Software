"use client";

import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const C = { brand: "#1f4d45", brand2: "#7fa89f", grid: "#ececea", axis: "#8a8c91", accent: "#b7791f" };
const axis = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltip = { contentStyle: { borderRadius: 8, border: "1px solid #e4e4e0", fontSize: 12 }, cursor: { fill: "rgba(0,0,0,0.03)" } };

function Empty() {
  return <div className="flex h-full items-center justify-center text-xs text-ink-3">No data for this period</div>;
}

export function RevenueTrend({ data, currency }: { data: { date: string; revenue: number }[]; currency: string }) {
  if (!data.some((d) => d.revenue)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="date" {...axis} minTickGap={16} />
        <YAxis {...axis} width={56} />
        <Tooltip {...tooltip} formatter={(v: number) => [new Intl.NumberFormat("en-US", { style: "currency", currency }).format(v), "Revenue"]} />
        <Bar dataKey="revenue" fill={C.brand} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OccupancyTrend({ data }: { data: { date: string; occupied: number; available: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="date" {...axis} minTickGap={16} />
        <YAxis {...axis} width={32} allowDecimals={false} />
        <Tooltip {...tooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="occupied" name="Occupied" stackId="a" fill={C.brand} maxBarSize={28} />
        <Bar dataKey="available" name="Available" stackId="a" fill={C.brand2} fillOpacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Movement({ data }: { data: { date: string; arrivals: number; departures: number }[] }) {
  if (!data.some((d) => d.arrivals || d.departures)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={C.grid} />
        <XAxis dataKey="date" {...axis} minTickGap={16} />
        <YAxis {...axis} width={32} allowDecimals={false} />
        <Tooltip {...tooltip} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line dataKey="arrivals" name="Check-ins" stroke={C.brand} strokeWidth={2} dot={false} />
        <Line dataKey="departures" name="Check-outs" stroke={C.accent} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HBar({ data, valueLabel, money }: { data: { name: string; value: number }[]; valueLabel: string; money?: string }) {
  if (!data.length) return <Empty />;
  const fmt = (v: number) => (money ? new Intl.NumberFormat("en-US", { style: "currency", currency: money, maximumFractionDigits: 0 }).format(v) : String(v));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={C.grid} />
        <XAxis type="number" {...axis} tickFormatter={fmt} allowDecimals={false} />
        <YAxis type="category" dataKey="name" {...axis} width={110} tick={{ fontSize: 11, fill: "#55575c", textTransform: "capitalize" } as object} />
        <Tooltip {...tooltip} formatter={(v: number) => [fmt(v), valueLabel]} />
        <Bar dataKey="value" fill={C.brand} radius={[0, 3, 3, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
