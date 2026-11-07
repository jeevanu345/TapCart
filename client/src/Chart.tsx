import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { date, money, type DailySale } from "./api";
function RevenueDot({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
  return <circle cx={cx} cy={cy} r={4} fill="var(--ink)" stroke="var(--surface)" strokeWidth={2} />;
}
export default function RevenueChart({ sales }: { sales: DailySale[] }) {
  return (
    <div
      className="revenue-chart"
      role="img"
      aria-label={`Revenue over ${sales.length} days, totaling ${money(sales.reduce((sum, row) => sum + row.revenueCents, 0))}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={sales} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) =>
              new Date(String(value)).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })
            }
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={(value) => {
              const rupees = Number(value) / 100;
              return rupees >= 1000
                ? `₹${Number((rupees / 1000).toFixed(1))}k`
                : `₹${Math.round(rupees)}`;
            }}
            tick={{ fill: "var(--ink-3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={56}
          />
          <Tooltip
            formatter={(value) => [money(Number(value)), "Revenue"]}
            labelFormatter={(value) => date(String(value))}
            cursor={{ stroke: "var(--ink-3)", strokeWidth: 1 }}
            contentStyle={{
              background: "var(--inv)",
              border: 0,
              borderRadius: "var(--radius-control)",
              color: "var(--inv-ink)",
              fontSize: 12,
              boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
            }}
            itemStyle={{ color: "var(--inv-ink)" }}
            labelStyle={{ color: "var(--inv-ink)", opacity: 0.75 }}
          />
          <Area
            type="linear"
            dataKey="revenueCents"
            stroke="var(--ink)"
            strokeWidth={2}
            fill="url(#revenue-fill)"
            activeDot={RevenueDot}
            animationDuration={650}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
