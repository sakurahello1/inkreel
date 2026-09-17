/**
 * 查中转站当前有哪些渠道组开着、支持什么分辨率、多少钱。
 *
 * 存在的理由：便宜的 RQ2 会间歇性关闭，而关闭时提交 1080P 只会拿到一句
 * 「无可用渠道分组」，看不出是暂时的还是永久的。批量出片前先跑这个。
 *   npx tsx scripts/channels.ts [模型名]
 */
type Opt = { param_name: string; option_value: string; price_multiplier: number; final_price: number };
type Group = {
  group_name: string; is_active: boolean; in_key_whitelist: boolean;
  base_price: number; current_time_discount: number;
  success_rate_24h: number; avg_response_seconds: number; sample_count_1h: number;
  time_discounts: Array<{ discount: number; start: string; end: string; price_per_second: number }>;
  option_prices: Opt[];
};

async function main() {
  const model = process.argv[2] || process.env.VIDEO_MODEL_I2V || "hailuo-h3-shouweizhen";
  const base = (process.env.VIDEO_BASE_URL || "").replace(/\/$/, "");
  const key = process.env.VIDEO_API_KEY;
  if (!base || !key) throw new Error("缺少 VIDEO_BASE_URL / VIDEO_API_KEY");
  const r = await fetch(`${base}/v1/skills/models/${model}/pricing`, { headers: { Authorization: `Bearer ${key}` } });
  const d = (await r.json()) as { available_for_this_key: boolean; channel_groups: Group[] };

  const secs = Number(process.argv[3] || 594); // 默认按全片时长估
  console.log(`${model}  本 key 可用=${d.available_for_this_key}  按 ${secs}s 估算\n`);

  const rows: Array<[string, string, string, string, string]> = [];
  for (const g of d.channel_groups) {
    const res = g.option_prices.filter((o) => o.param_name === "resolution");
    for (const o of res) {
      // final_price 已经含了当前时段折扣（base_price 就是此刻的实付价），不能再乘一次
      const now = o.final_price;
      rows.push([
        g.is_active ? "开" : "关",
        g.group_name,
        o.option_value,
        `$${now.toFixed(4)}/秒`,
        `$${(now * secs).toFixed(2)}`,
      ]);
    }
  }
  rows.sort((a, b) => (a[0] === b[0] ? parseFloat(a[4].slice(1)) - parseFloat(b[4].slice(1)) : a[0] === "开" ? -1 : 1));
  for (const r of rows) console.log(`  ${r[0]}  ${r[1].padEnd(14)} ${r[2].padEnd(6)} ${r[3].padStart(12)}  全片 ${r[4].padStart(8)}`);

  const active = new Set(d.channel_groups.filter((g) => g.is_active).flatMap((g) => g.option_prices.filter((o) => o.param_name === "resolution").map((o) => o.option_value)));
  console.log(`\n当前可提交的分辨率：${[...active].join(" / ") || "无"}`);

  for (const g of d.channel_groups) {
    if (!g.time_discounts?.length) continue;
    const win = g.time_discounts.map((t) => `${t.start}-${t.end} ${t.discount}折 $${t.price_per_second}/秒`).join("  ");
    console.log(`${g.group_name}${g.is_active ? "" : "（当前关闭）"} 时段价（768P 基准）：${win}`);
    console.log(`   24h成功率 ${g.success_rate_24h}%  平均出片 ${(g.avg_response_seconds / 60).toFixed(1)} 分钟  近1h样本 ${g.sample_count_1h}`);
  }
}
main();
