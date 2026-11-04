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
export default function RevenueChart({ sales }: { sales: DailySale[] }) {
  return (
    <div
      className="revenue-chart"
      role="img"
      aria-label={`Revenue over ${sales.length} days, totaling ${money(sales.reduce((sum, row) => sum + row.revenueCents, 0))}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={sales} margin={{ top: 15, right: 16, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#417a5f" stopOpacity={0.17} />
              <stop offset="100%" stopColor="#417a5f" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#eceee8" strokeDasharray="4 4" />
          <XAxis
            dataKey="date"
            tickFormatter={(value) =>
              new Date(String(value)).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })
            }
            tick={{ fill: "#8b918a", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={35}
          />
          <YAxis
            tickFormatter={(value) =>
              `₹${Number(value) >= 100000 ? `${Math.round(Number(value) / 100000)}k` : Math.round(Number(value) / 100)}`
            }
            tick={{ fill: "#8b918a", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value) => [money(Number(value)), "Revenue"]}
            labelFormatter={(value) => date(String(value))}
            contentStyle={{ borderRadius: 10, border: "1px solid #e3e6de", fontSize: 12 }}
            cursor={{ stroke: "#b2c6b7" }}
          />
          <Area
            type="monotone"
            dataKey="revenueCents"
            stroke="#3d755a"
            strokeWidth={2.5}
            fill="url(#revenue-fill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
