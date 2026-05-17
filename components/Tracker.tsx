"use client"

import { useState, useEffect, useMemo } from "react"
import { useSession, signIn, signOut } from "next-auth/react"
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler
} from "chart.js"
import { Doughnut, Line } from "react-chartjs-2"

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler)

// ── Types ─────────────────────────────────────────────────────────────────────
type Region   = "US" | "Canada" | "India"
type PortType = "growth" | "income"
type Mode     = "junior" | "adult"

interface Holding {
  t: string; n: string; p: number; type: string; where: string
  cadence?: string; y?: number
  shares?: number; avgCost?: number
}
interface Wildcard {
  t: string; n: string; sector: string; kind: string; active: boolean
  where: string; blurb: string; y?: number; cadence?: string
}
interface TaxAccount { k: string; v: string; priority: 1 | 2 | 3 }
interface Portfolio {
  name: string; currency: string; symbol: string
  annual_default: number; return_pct: number
  base_holdings: Holding[]; wildcard_pool: Wildcard[]; tax_accounts: TaxAccount[]
}
type PortfoliosData = Record<Region, Record<PortType, Portfolio>>

// ── Palette ───────────────────────────────────────────────────────────────────
const SLICE_COLORS    = ["#5865F2","#6EC8C8","#6ECB81","#F0B23C","#AA78FF","#58A8FF","#FF9F40","#C8B0FF","#FF8FB7","#9B59B6"]
const WILDCARD_COLORS = ["#EB695F","#E14B6A","#C73E5F","#F0B23C","#FFB570"]
const PRIORITY_COLORS: Record<number,string> = { 1:"#6ECB81", 2:"#F0B23C", 3:"#94a0b0" }
const PRIORITY_LABEL:  Record<number,string> = { 1:"Open First", 2:"Next", 3:"Optional" }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(val: number, sym: string) {
  return sym + val.toLocaleString("en-US", { maximumFractionDigits: 0 })
}
function fmtDec(val: number, sym: string) {
  return sym + val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function scoreColor(s: number) {
  return s >= 70 ? "#6ECB81" : s >= 45 ? "#F0B23C" : "#EB695F"
}
function scoreGrade(s: number) {
  if (s >= 90) return "A+"
  if (s >= 80) return "A"
  if (s >= 70) return "B"
  if (s >= 60) return "C"
  if (s >= 50) return "D"
  return "F"
}

function goalProbability(start: number, dep: number, yrs: number, target: number, ret: number, vol: number) {
  if (target <= 0 || yrs <= 0) return 99
  let hits = 0
  const N = 600
  for (let i = 0; i < N; i++) {
    let bal = start
    for (let y = 0; y < yrs; y++) {
      const u1 = Math.random() + 1e-10, u2 = Math.random()
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      bal = Math.max(0, (bal + dep) * (1 + ret / 100 + z * vol / 100))
    }
    if (bal >= target) hits++
  }
  return Math.round((hits / N) * 100)
}

function calcScore(holdings: Holding[], pt: PortType, ret: number, start: number, dep: number, yrs: number, target: number) {
  const tot  = holdings.reduce((s, h) => s + h.p, 0) || 100
  const hhi  = holdings.reduce((s, h) => s + Math.pow(h.p / tot, 2), 0)
  const diversScore  = Math.min(100, Math.round((1 - hhi) * 110))
  const growthScore  = Math.min(100, Math.round((ret / 14) * 100))
  let   upsideScore  = 0
  if (pt === "growth") {
    const stockPct = holdings.filter(h => h.type?.toLowerCase().includes("stock")).reduce((s, h) => s + h.p, 0)
    upsideScore = Math.min(100, Math.round(25 + stockPct * 2.2))
  } else {
    const by = holdings.reduce((s, h) => s + (h.y ?? 0) * h.p / 100, 0)
    upsideScore = Math.min(100, Math.round((by / 10) * 100))
  }
  const goalProb = goalProbability(start, dep, yrs, target, ret, pt === "growth" ? 16 : 9)
  const overall  = Math.round(diversScore * 0.25 + growthScore * 0.30 + upsideScore * 0.20 + goalProb * 0.25)
  return { overall, diversScore, growthScore, upsideScore, goalProb }
}

function dynamicTaxTips(holdings: Holding[], pt: PortType, region: Region): string[] {
  const tips: string[] = []
  const types = holdings.map(h => h.type?.toLowerCase() ?? "")
  const hasREIT    = types.some(t => t.includes("reit"))
  const hasBDC     = types.some(t => t.includes("bdc"))
  const hasCovCall = types.some(t => t.includes("cov"))
  const hasStock   = types.some(t => t.includes("stock"))
  const hasDivETF  = types.some(t => t === "div etf")
  const hasInvIT   = types.some(t => t.includes("invit"))
  const hasPipe    = types.some(t => t.includes("pipeline"))

  if ((hasREIT || hasBDC) && region === "US")
    tips.push("REITs & BDCs pay ordinary income — always shelter these in a Roth IRA or Traditional IRA first to avoid your top marginal rate.")
  if ((hasREIT || hasBDC) && region === "Canada")
    tips.push("REIT distributions are a mix of income, capital gains, and return of capital. Hold in TFSA to make all three completely tax-free.")
  if ((hasREIT || hasBDC) && region === "India")
    tips.push("Indian REIT distributions have 3 tax buckets: interest (slab rate), dividend (exempt), capital return (basis reduction). Read the annual breakdown each year.")
  if (hasCovCall && region === "US")
    tips.push("Covered-call ETFs (JEPI/JEPQ) distribute Return-of-Capital which defers tax and reduces cost basis — more tax-efficient in taxable than REITs, but still best in a Roth IRA.")
  if (hasCovCall && region === "Canada")
    tips.push("ZWC covered-call distributions are partly ROC — most tax-efficient in TFSA; avoid RRSP where you'd lose the capital-gains advantage.")
  if (hasStock && region === "US")
    tips.push("Growth stocks (NVDA, MSFT, AAPL, GOOGL) generate capital gains — holding them in a Roth IRA makes all future gains permanently tax-free.")
  if (hasStock && region === "Canada")
    tips.push("Canadian stocks held in an ITF account attribute capital gains to the child's lower tax bracket — potentially saving 30–40% on realized gains.")
  if (hasDivETF && region === "US")
    tips.push("SCHD pays qualified dividends (0–20% tax rate) — acceptable in taxable brokerage. Still better in a Roth IRA where dividends compound 100% tax-free.")
  if (hasInvIT && region === "India")
    tips.push("InvIT distributions (PowerGrid, IndiGrid) are the most tax-efficient income in India: capital return is tax-free, interest is at slab rate, dividend is exempt.")
  if (hasPipe && region === "Canada")
    tips.push("Pipeline income (ENB, PPL, TRP) qualifies for the dividend tax credit in non-registered accounts — effective rate ~24–30% vs ~50% on interest income.")
  if (pt === "growth" && region === "US")
    tips.push("Rule of thumb: Roth IRA first (highest-growth picks), UTMA second (broad ETFs), 529 only if education is the clear goal.")
  if (pt === "growth" && region === "Canada")
    tips.push("RESP first ($2,500/yr to max the CESG grant), then ITF for everything above. At 18, roll RESP + ITF into TFSA as fast as contribution room allows.")
  if (pt === "growth" && region === "India")
    tips.push("LRS limit is USD 250K/yr per person. The 20% TCS above INR 7L is a tax pre-payment, not a penalty — credit it back when you file.")
  return tips.slice(0, 5)
}

const JUNIOR_TAX_TIPS: Record<Region, string[]> = {
  US: [
    "Open a Custodial Roth IRA as soon as your child has any earned income (babysitting, lawn mowing, etc.). Contributions grow 100% tax-free forever.",
    "The UTMA/UGMA brokerage account is your overflow bucket — first ~$1,300 of investment income per year is completely tax-free for a child.",
    "A 529 Plan is only worth it if college is the definite goal. If unsure, use UTMA — it's more flexible.",
    "Reinvest every dividend automatically. At a young age, time is the most powerful tool — compounding does the heavy lifting.",
    "Hold your highest-growth picks (NVDA, QQQM) inside the Roth IRA. When those grow 10× tax-free, that's the account working hardest for you.",
  ],
  Canada: [
    "Open an RESP the year your child is born. The government gives you 20% back on the first $2,500/yr (up to $500/yr free money).",
    "An In-Trust-For (ITF) account lets capital gains be taxed in the child's hands at their lower rate — a legal way to reduce the family tax bill.",
    "At age 18, start rolling money into a TFSA. Growth and withdrawals are tax-free forever — the most powerful account in Canada.",
    "If home ownership is a goal, the FHSA (First Home Savings Account) at 18 gives both a tax deduction going in AND tax-free money coming out.",
    "Reinvest dividends automatically. Canadian eligible dividends already get the dividend tax credit — inside an ITF they're even cheaper.",
  ],
  India: [
    "Open a minor demat account — parents act as guardian. All capital gains on growth stocks in the account can be planned for transfer at 18.",
    "LRS (Liberalised Remittance Scheme) lets you invest up to USD 250,000/yr in US stocks. INDmoney and Vested make this easy from ₹1.",
    "TCS at 20% above INR 7L in LRS remittances is a tax pre-payment, not an extra charge — you get it back when filing your ITR.",
    "SIPs into index funds (NIFTY 50, Nasdaq 100 via MON100) are the most tax-efficient way to invest in Indian markets — LTCG over ₹1L taxed at only 10%.",
    "At 18, shift US dividend income into the child's own name. US withholding (25% under DTAA) is creditable against Indian tax — file Form 67.",
  ],
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Tracker() {
  const { data: session, status } = useSession()
  const discordId = (session?.user as any)?.discordId as string | undefined

  const [data,      setData]      = useState<PortfoliosData | null>(null)
  const [mode,      setMode]      = useState<Mode>("junior")
  const [region,    setRegion]    = useState<Region>("US")
  const [portType,  setPortType]  = useState<PortType>("growth")
  const [wildcards, setWildcards] = useState<Record<string, Wildcard[]>>({})

  const [customHoldings, setCustomHoldings] = useState<Record<string, Holding[]>>({})
  const [editingIdx,     setEditingIdx]     = useState<number | null>(null)
  const [editTicker,     setEditTicker]     = useState("")
  const [editName,       setEditName]       = useState("")

  const [customTicker, setCustomTicker] = useState("")
  const [customName,   setCustomName]   = useState("")

  const [startBal,   setStartBal]   = useState(0)
  const [annualDep,  setAnnualDep]  = useState(7000)
  const [years,      setYears]      = useState(30)
  const [returnPct,  setReturnPct]  = useState(9)
  const [targetGoal, setTargetGoal] = useState(1000000)

  const [prices, setPrices] = useState<Record<string, { price: number; change: number }>>({})

  useEffect(() => {
    fetch("/api/portfolios").then(r => r.json()).then((d: PortfoliosData) => {
      setData(d)
      const wc: Record<string, Wildcard[]> = {}
      for (const reg of ["US","Canada","India"] as Region[])
        for (const pt of ["growth","income"] as PortType[])
          wc[`${reg}-${pt}`] = d[reg][pt].wildcard_pool.map(w => ({ ...w }))
      setWildcards(wc)
    })
  }, [])

  useEffect(() => {
    if (data) {
      const p = data[region][portType]
      setAnnualDep(p.annual_default)
      setReturnPct(p.return_pct)
    }
  }, [region, portType, data])

  useEffect(() => {
    if (!discordId || !data) return
    fetch("/api/user/data").then(r => r.json()).then(saved => {
      if (!saved.holdings) return
      const ch: Record<string, Holding[]> = {}
      for (const row of saved.holdings) ch[`${row.region}-${row.port_type}`] = row.holdings
      if (Object.keys(ch).length) setCustomHoldings(ch)

      const wc: Record<string, Wildcard[]> = {}
      for (const row of saved.wildcards) wc[`${row.region}-${row.port_type}`] = row.wildcards
      if (Object.keys(wc).length) setWildcards(wc)

      for (const row of saved.projections) {
        if (row.region === region && row.port_type === portType) {
          setStartBal(row.start_bal)
          setAnnualDep(row.annual_dep)
          setYears(row.years)
          setReturnPct(row.return_pct)
          setTargetGoal(row.target_goal)
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discordId, data])

  useEffect(() => {
    if (!data) return
    const port = data[region][portType]
    const tickers = port.base_holdings.map(h => h.t)
    fetch("/api/prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers, region }),
    }).then(r => r.json()).then(setPrices)
  }, [data, region, portType])

  useEffect(() => {
    if (!discordId || !data) return
    const timer = setTimeout(() => {
      fetch("/api/user/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region, port_type: portType,
          holdings: customHoldings[`${region}-${portType}`] ?? null,
          wildcards: wildcards[`${region}-${portType}`] ?? null,
          projection: { start_bal: startBal, annual_dep: annualDep, years, return_pct: returnPct, target_goal: targetGoal },
        }),
      })
    }, 2000)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discordId, region, portType, customHoldings, wildcards, startBal, annualDep, years, returnPct, targetGoal])

  const wcKey = `${region}-${portType}`

  const effectiveHoldings = useMemo(() => {
    if (!data) return []
    const p = data[region][portType]
    return mode === "junior" ? p.base_holdings : (customHoldings[wcKey] ?? p.base_holdings)
  }, [data, region, portType, mode, customHoldings, wcKey])

  const score = useMemo(
    () => effectiveHoldings.length > 0
      ? calcScore(effectiveHoldings, portType, returnPct, startBal, annualDep, years, targetGoal)
      : { overall: 0, diversScore: 0, growthScore: 0, upsideScore: 0, goalProb: 0 },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(effectiveHoldings), portType, returnPct, startBal, annualDep, years, targetGoal]
  )

  const taxTips = useMemo(() => {
    if (!data || effectiveHoldings.length === 0) return []
    return mode === "adult"
      ? dynamicTaxTips(effectiveHoldings, portType, region)
      : JUNIOR_TAX_TIPS[region]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, data, JSON.stringify(effectiveHoldings), portType, region])

  if (!data) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"var(--bg)" }}>
      <span style={{ color:"var(--sub)" }}>Loading portfolios…</span>
    </div>
  )

  const port     = data[region][portType]
  const isIncome = portType === "income"
  const isJunior = mode === "junior"

  const isCustomized    = mode === "adult" && !!customHoldings[wcKey]
  const activeWildcards = wildcards[wcKey]?.filter(w => w.active) ?? []
  const wildcardSlotPct = activeWildcards.length > 0 ? (5 / activeWildcards.length).toFixed(1) : "5.0"

  // ── Position calculations ───────────────────────────────────────────────────
  const positionData = effectiveHoldings.map(h => {
    const lp = prices[h.t]?.price ?? null
    const shares = h.shares ?? null
    const avgCost = h.avgCost ?? null
    const marketValue = (shares !== null && lp !== null) ? shares * lp : null
    const costBasis   = (shares !== null && avgCost !== null) ? shares * avgCost : null
    const gainLoss    = (marketValue !== null && costBasis !== null) ? marketValue - costBasis : null
    const gainLossPct = (avgCost !== null && lp !== null && avgCost > 0) ? (lp - avgCost) / avgCost * 100 : null
    return { marketValue, costBasis, gainLoss, gainLossPct }
  })

  const totalMarketValue = positionData.reduce((s, p) => s + (p.marketValue ?? 0), 0)
  const totalGainLoss    = positionData.reduce((s, p) => s + (p.gainLoss ?? 0), 0)
  const totalCostBasis   = positionData.reduce((s, p) => s + (p.costBasis ?? 0), 0)
  const totalGainLossPct = totalCostBasis > 0 ? (totalGainLoss / totalCostBasis) * 100 : null
  const hasAnyPositions  = positionData.some(p => p.marketValue !== null)
  const positionsFilled  = positionData.filter(p => p.marketValue !== null).length

  // ── Wildcard helpers ────────────────────────────────────────────────────────
  function toggleWildcard(ticker: string) {
    setWildcards(prev => ({ ...prev, [wcKey]: prev[wcKey].map(w => w.t === ticker ? { ...w, active: !w.active } : w) }))
  }
  function addCustomWildcard() {
    if (!customTicker.trim()) return
    setWildcards(prev => ({
      ...prev,
      [wcKey]: [...(prev[wcKey] ?? []), { t: customTicker.trim().toUpperCase(), n: customName.trim() || customTicker.trim().toUpperCase(), sector: "Custom", kind: "custom", active: true, where: "Your choice", blurb: "Custom pick." }]
    }))
    setCustomTicker(""); setCustomName("")
  }

  // ── Holdings helpers ────────────────────────────────────────────────────────
  function startEdit(idx: number) {
    setEditingIdx(idx)
    setEditTicker(effectiveHoldings[idx].t)
    setEditName(effectiveHoldings[idx].n)
  }
  function saveEdit() {
    if (editingIdx === null) return
    const base = port.base_holdings
    const curr: Holding[] = (customHoldings[wcKey] ?? base).map(h => ({ ...h }))
    curr[editingIdx] = { ...curr[editingIdx], t: editTicker.trim().toUpperCase() || curr[editingIdx].t, n: editName.trim() || editTicker.trim().toUpperCase() }
    setCustomHoldings(prev => ({ ...prev, [wcKey]: curr }))
    setEditingIdx(null)
  }
  function resetHolding(idx: number) {
    const base = port.base_holdings
    const curr: Holding[] = (customHoldings[wcKey] ?? base).map(h => ({ ...h }))
    curr[idx] = { ...base[idx] }
    if (curr.every((h, i) => h.t === base[i].t)) {
      setCustomHoldings(prev => { const n = { ...prev }; delete n[wcKey]; return n })
    } else {
      setCustomHoldings(prev => ({ ...prev, [wcKey]: curr }))
    }
    setEditingIdx(null)
  }
  function resetAllHoldings() {
    setCustomHoldings(prev => { const n = { ...prev }; delete n[wcKey]; return n })
    setEditingIdx(null)
  }
  function updatePosition(idx: number, field: "shares" | "avgCost", raw: string) {
    const value = raw === "" ? undefined : parseFloat(raw)
    const base = port.base_holdings
    const curr: Holding[] = (customHoldings[wcKey] ?? base).map(h => ({ ...h }))
    curr[idx] = { ...curr[idx], [field]: value }
    setCustomHoldings(prev => ({ ...prev, [wcKey]: curr }))
  }

  // ── Pie chart ───────────────────────────────────────────────────────────────
  const pieLabels = effectiveHoldings.map(h => h.t)
  const pieValues = hasAnyPositions && totalMarketValue > 0
    ? positionData.map(p => p.marketValue !== null ? Math.round((p.marketValue / totalMarketValue) * 100) : 0)
    : effectiveHoldings.map(h => h.p)
  const pieData = {
    labels: pieLabels,
    datasets: [{ data: pieValues, backgroundColor: effectiveHoldings.map((_, i) => SLICE_COLORS[i % SLICE_COLORS.length]), borderWidth: 1, borderColor: "var(--card)" }]
  }
  const pieOptions = {
    cutout: "55%", responsive: true,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: any) => ` ${ctx.label}: ${ctx.parsed}%` } } }
  }

  // ── Growth calculator ───────────────────────────────────────────────────────
  const calcStartBal = hasAnyPositions && totalMarketValue > 0 ? totalMarketValue : startBal
  const calcData = (() => {
    const labels: string[] = [], values: number[] = [], deposited: number[] = []
    let bal = calcStartBal, dep = 0
    const r = returnPct / 100
    for (let y = 0; y <= years; y++) {
      labels.push(y === 0 ? "Now" : `Yr ${y}`)
      values.push(Math.round(bal))
      deposited.push(Math.round(calcStartBal + dep))
      if (y < years) { bal = (bal + annualDep) * (1 + r); dep += annualDep }
    }
    return { labels, values, deposited, finalVal: values[values.length - 1], totalDep: deposited[deposited.length - 1], growth: values[values.length - 1] - deposited[deposited.length - 1] }
  })()

  const lineDatasets: any[] = [
    { label: "Portfolio Value",  data: calcData.values,    borderColor: "#5865F2", backgroundColor: "rgba(88,101,242,0.1)", fill: true,  tension: 0.4, pointRadius: 0 },
    { label: "Total Deposited",  data: calcData.deposited, borderColor: "#94a0b0", backgroundColor: "transparent",         fill: false, tension: 0,   pointRadius: 0, borderDash: [4,4] },
  ]
  if (mode === "adult" && targetGoal > 0)
    lineDatasets.push({ label: "Target", data: Array(calcData.labels.length).fill(targetGoal), borderColor: "#6ECB81", backgroundColor: "transparent", fill: false, tension: 0, pointRadius: 0, borderDash: [6,3] })

  const lineData = { labels: calcData.labels, datasets: lineDatasets }
  const lineOptions = {
    responsive: true,
    plugins: { legend: { labels: { color: "#b5bac1", boxWidth: 12 } }, tooltip: { callbacks: { label: (ctx: any) => ` ${port.symbol}${ctx.parsed.y.toLocaleString()}` } } },
    scales: {
      x: { ticks: { color: "#94a0b0", maxTicksLimit: 8 }, grid: { color: "#3c3f45" } },
      y: { ticks: { color: "#94a0b0", callback: (v: any) => port.symbol + (v >= 1e6 ? (v/1e6).toFixed(1)+"M" : (v/1e3).toFixed(0)+"K") }, grid: { color: "#3c3f45" } }
    }
  }

  const blendedYield  = isIncome ? effectiveHoldings.reduce((s, h) => s + (h.y ?? 0) * h.p / 100, 0) : null
  const monthlyIncome = blendedYield ? (annualDep * blendedYield / 100 / 12) : null

  function exportCSV(all: boolean) {
    const rows = ["Portfolio,Ticker,Name,Allocation%,Shares,AvgCost,MarketValue,GainLoss,Type,Where,Cadence,Yield%"]
    const regions: Region[]   = all ? ["US","Canada","India"] : [region]
    const types:   PortType[] = all ? ["growth","income"]     : [portType]
    for (const reg of regions) for (const pt of types) {
      const p = data![reg][pt]
      const hh = (reg === region && pt === portType) ? effectiveHoldings : p.base_holdings
      for (const h of hh) {
        const lp = prices[h.t]?.price
        const mv = (h.shares && lp) ? (h.shares * lp).toFixed(2) : ""
        const gl = (h.shares && h.avgCost && lp) ? ((lp - h.avgCost) * h.shares).toFixed(2) : ""
        rows.push([p.name, h.t, `"${h.n}"`, h.p, h.shares??"-", h.avgCost??"-", mv||"-", gl||"-", h.type, `"${h.where}"`, h.cadence??"-", h.y??"-"].join(","))
      }
    }
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }))
    a.download = all ? "flowstate_all_portfolios.csv" : `flowstate_${region}_${portType}.csv`
    a.click()
  }

  const scoreCol = scoreColor(score.overall)
  const inputStyle = { background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 4, padding: "3px 5px", color: "var(--text)", fontSize: 12, width: "100%" }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "0 0 48px" }}>

      {/* ── Header ── */}
      <div style={{ background: "var(--card)", borderBottom: "1px solid var(--divider)", padding: "18px 32px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 22, letterSpacing: "-0.5px" }}>
              <span style={{ color: "var(--accent)" }}>FlowState</span>
              <span style={{ color: "var(--text)" }}> Alpha</span>
            </div>
            <div style={{ color: "var(--sub)", fontSize: 13 }}>Portfolio tracker · educational only · not investment advice</div>
          </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4, background: "var(--card-alt)", borderRadius: 10, padding: 4, border: "1px solid var(--divider)" }}>
              <button onClick={() => setMode("junior")} style={{
                padding: "10px 22px", borderRadius: 7, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, transition: "all 0.2s",
                background: isJunior ? "#6ECB81" : "transparent",
                color:      isJunior ? "#1e1f22" : "var(--sub)",
              }}>Junior Portfolio</button>
              <button onClick={() => setMode("adult")} style={{
                padding: "10px 22px", borderRadius: 7, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14, transition: "all 0.2s",
                background: !isJunior ? "var(--accent)" : "transparent",
                color:      !isJunior ? "#ffffff"       : "var(--sub)",
              }}>Adult Portfolio</button>
            </div>

            {status === "loading" ? null : session ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {session.user?.image && (
                  <img src={session.user.image} alt="avatar" style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--accent)" }} />
                )}
                <div>
                  <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{session.user?.name}</div>
                  <div style={{ color: "var(--green)", fontSize: 11 }}>✓ Portfolio saved</div>
                </div>
                <button onClick={() => signOut()} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "1px solid var(--divider)", background: "transparent", color: "var(--muted)", cursor: "pointer" }}>
                  Sign out
                </button>
              </div>
            ) : (
              <button onClick={() => signIn("discord")} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 8,
                border: "none", background: "#5865F2", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer"
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                Sign in with Discord
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 0" }}>

        {/* Mode banner */}
        {isJunior ? (
          <div style={{ background: "rgba(110,203,129,0.12)", border: "1px solid #6ECB81", borderRadius: 10, padding: "12px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>🌱</span>
            <div>
              <div style={{ fontWeight: 700, color: "#6ECB81", fontSize: 14 }}>Junior Portfolio — Recommended Starting Point</div>
              <div style={{ color: "var(--sub)", fontSize: 12 }}>These are the original, expert-curated holdings. Holdings are locked — switch to Adult Portfolio to track your real positions.</div>
            </div>
          </div>
        ) : (
          <div style={{ background: "rgba(88,101,242,0.12)", border: "1px solid var(--accent)", borderRadius: 10, padding: "12px 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>🔓</span>
            <div>
              <div style={{ fontWeight: 700, color: "var(--accent)", fontSize: 14 }}>Adult Portfolio — Track Your Real Positions</div>
              <div style={{ color: "var(--sub)", fontSize: 12 }}>Enter your shares and average cost per holding to see your actual market value, gain/loss, and real portfolio allocation.</div>
            </div>
          </div>
        )}

        {/* ── Portfolio type + region toggles ── */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 4, background: "var(--card)", borderRadius: 8, padding: 4 }}>
            {(["growth","income"] as PortType[]).map(pt => (
              <button key={pt} onClick={() => setPortType(pt)} style={{
                padding: "8px 20px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.15s",
                background: portType === pt ? (pt === "growth" ? "var(--green)" : "var(--amber)") : "transparent",
                color:      portType === pt ? "#1e1f22" : "var(--sub)",
              }}>{pt === "growth" ? "Max Growth" : "Monthly Income"}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 4, background: "var(--card)", borderRadius: 8, padding: 4 }}>
            {(["US","Canada","India"] as Region[]).map(r => (
              <button key={r} onClick={() => setRegion(r)} style={{
                padding: "8px 18px", borderRadius: 6, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14, transition: "all 0.15s",
                background: region === r ? "var(--accent)" : "transparent",
                color:      region === r ? "#fff" : "var(--sub)",
              }}>{r === "India" ? "India (Global)" : r}</button>
            ))}
          </div>
        </div>

        <h2 style={{ fontWeight: 700, fontSize: 20, marginBottom: 20, color: "var(--text)" }}>{port.name}</h2>

        {/* ── Portfolio Value Summary (adult, when positions entered) ── */}
        {!isJunior && hasAnyPositions && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16, marginBottom: 20 }}>
            <div style={{ background: "var(--card)", borderRadius: 10, padding: 18, textAlign: "center" }}>
              <div style={{ color: "var(--sub)", fontSize: 12, marginBottom: 4 }}>Total Market Value</div>
              <div style={{ color: "var(--accent)", fontSize: 24, fontWeight: 800 }}>{fmtDec(totalMarketValue, port.symbol)}</div>
              <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>{positionsFilled} of {effectiveHoldings.length} positions entered</div>
            </div>
            <div style={{ background: "var(--card)", borderRadius: 10, padding: 18, textAlign: "center" }}>
              <div style={{ color: "var(--sub)", fontSize: 12, marginBottom: 4 }}>Total Cost Basis</div>
              <div style={{ color: "var(--text)", fontSize: 24, fontWeight: 800 }}>{fmtDec(totalCostBasis, port.symbol)}</div>
            </div>
            <div style={{ background: "var(--card)", borderRadius: 10, padding: 18, textAlign: "center" }}>
              <div style={{ color: "var(--sub)", fontSize: 12, marginBottom: 4 }}>Total Gain / Loss</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: totalGainLoss >= 0 ? "var(--green)" : "var(--red)" }}>
                {totalGainLoss >= 0 ? "+" : ""}{fmtDec(totalGainLoss, port.symbol)}
              </div>
              {totalGainLossPct !== null && (
                <div style={{ fontSize: 13, fontWeight: 600, color: totalGainLoss >= 0 ? "var(--green)" : "var(--red)" }}>
                  {totalGainLossPct >= 0 ? "+" : ""}{totalGainLossPct.toFixed(2)}%
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Two-column grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          {/* Left: Holdings */}
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 24, overflowX: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, color: "var(--text)", margin: 0 }}>Holdings</h3>
              {!isJunior ? (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {isCustomized && (
                    <button onClick={resetAllHoldings} style={{ fontSize: 11, color: "var(--muted)", background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 4, padding: "3px 8px", cursor: "pointer" }}>
                      Reset all
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>✏️ edit ticker/name</span>
                </div>
              ) : (
                <span style={{ fontSize: 11, color: "#6ECB81" }}>Original · locked</span>
              )}
            </div>

            <div style={{ width: 200, margin: "0 auto 16px" }}>
              <Doughnut data={pieData} options={pieOptions} />
            </div>
            {!isJunior && hasAnyPositions && (
              <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>Pie shows actual allocation based on market value</div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 12px", marginBottom: 16 }}>
              {effectiveHoldings.map((h, i) => {
                const pct = hasAnyPositions && totalMarketValue > 0 && positionData[i].marketValue !== null
                  ? Math.round((positionData[i].marketValue! / totalMarketValue) * 100)
                  : h.p
                return (
                  <span key={h.t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--sub)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: SLICE_COLORS[i % SLICE_COLORS.length], display: "inline-block" }} />
                    {h.t} {pct}%
                  </span>
                )
              })}
            </div>

            {/* ── Holdings table ── */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: isJunior ? 400 : 560 }}>
                <thead>
                  <tr style={{ color: "var(--muted)", borderBottom: "1px solid var(--divider)" }}>
                    <th style={{ textAlign: "left", padding: "4px 4px 4px 0" }}>Ticker</th>
                    <th style={{ textAlign: "left", padding: "4px 4px" }}>Name</th>
                    {isJunior ? (
                      <>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Alloc</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Price</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Day%</th>
                        {isIncome && <th style={{ textAlign: "right", padding: "4px 4px" }}>Yield</th>}
                        {isIncome && <th style={{ textAlign: "right", padding: "4px 4px" }}>Cadence</th>}
                        <th style={{ textAlign: "left", padding: "4px 4px" }}>Where</th>
                      </>
                    ) : (
                      <>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Shares</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Avg Cost</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Mkt Value</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Gain/Loss</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Price</th>
                        <th style={{ textAlign: "right", padding: "4px 4px" }}>Day%</th>
                        {isIncome && <th style={{ textAlign: "right", padding: "4px 4px" }}>Yield</th>}
                        <th style={{ padding: "4px 0" }} />
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {effectiveHoldings.map((h, i) => {
                    const isEditing = !isJunior && editingIdx === i
                    const isDefault = h.t === port.base_holdings[i]?.t && h.n === port.base_holdings[i]?.n
                    const col       = SLICE_COLORS[i % SLICE_COLORS.length]
                    const pd        = positionData[i]
                    const lp        = prices[h.t]?.price ?? null

                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--divider)" }}>
                        {/* Ticker */}
                        <td style={{ padding: "5px 4px 5px 0" }}>
                          {isEditing ? (
                            <input value={editTicker} onChange={e => setEditTicker(e.target.value)}
                              style={{ ...inputStyle, width: 58 }} />
                          ) : (
                            <span style={{ fontWeight: 700, color: col }}>
                              {h.t}{!isDefault && !isJunior && <span style={{ color: "var(--accent)", fontSize: 9, marginLeft: 2 }}>★</span>}
                            </span>
                          )}
                        </td>

                        {/* Name */}
                        <td style={{ padding: "5px 4px", color: "var(--sub)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {isEditing ? (
                            <input value={editName} onChange={e => setEditName(e.target.value)}
                              style={{ ...inputStyle, width: 90 }} />
                          ) : h.n}
                        </td>

                        {isJunior ? (
                          <>
                            <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--text)" }}>{h.p}%</td>
                            <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--sub)" }}>
                              {lp ? `${port.symbol}${lp.toFixed(2)}` : "—"}
                            </td>
                            <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600,
                              color: prices[h.t] ? (prices[h.t].change >= 0 ? "var(--green)" : "var(--red)") : "var(--muted)" }}>
                              {prices[h.t] ? `${prices[h.t].change >= 0 ? "+" : ""}${prices[h.t].change.toFixed(2)}%` : "—"}
                            </td>
                            {isIncome && <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--green)" }}>{h.y}%</td>}
                            {isIncome && <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--muted)", fontSize: 11 }}>{h.cadence}</td>}
                            <td style={{ padding: "5px 4px", color: "var(--muted)", fontSize: 11, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.where}</td>
                          </>
                        ) : (
                          <>
                            {/* Shares — always editable */}
                            <td style={{ padding: "5px 4px", textAlign: "right" }}>
                              <input
                                type="number" min={0} step="any"
                                value={h.shares ?? ""}
                                placeholder="0"
                                onChange={e => updatePosition(i, "shares", e.target.value)}
                                style={{ ...inputStyle, width: 64, textAlign: "right" }}
                              />
                            </td>

                            {/* Avg Cost — always editable */}
                            <td style={{ padding: "5px 4px", textAlign: "right" }}>
                              <input
                                type="number" min={0} step="any"
                                value={h.avgCost ?? ""}
                                placeholder="0.00"
                                onChange={e => updatePosition(i, "avgCost", e.target.value)}
                                style={{ ...inputStyle, width: 72, textAlign: "right" }}
                              />
                            </td>

                            {/* Market Value */}
                            <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--text)", fontWeight: 600 }}>
                              {pd.marketValue !== null ? fmtDec(pd.marketValue, port.symbol) : "—"}
                            </td>

                            {/* Gain/Loss */}
                            <td style={{ padding: "5px 4px", textAlign: "right" }}>
                              {pd.gainLoss !== null ? (
                                <span style={{ color: pd.gainLoss >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>
                                  {pd.gainLoss >= 0 ? "+" : ""}{fmtDec(pd.gainLoss, port.symbol)}
                                  {pd.gainLossPct !== null && (
                                    <span style={{ fontSize: 10, display: "block", fontWeight: 400 }}>
                                      {pd.gainLossPct >= 0 ? "+" : ""}{pd.gainLossPct.toFixed(1)}%
                                    </span>
                                  )}
                                </span>
                              ) : "—"}
                            </td>

                            {/* Live Price */}
                            <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--sub)" }}>
                              {lp ? `${port.symbol}${lp.toFixed(2)}` : "—"}
                            </td>

                            {/* Day % */}
                            <td style={{ padding: "5px 4px", textAlign: "right", fontWeight: 600,
                              color: prices[h.t] ? (prices[h.t].change >= 0 ? "var(--green)" : "var(--red)") : "var(--muted)" }}>
                              {prices[h.t] ? `${prices[h.t].change >= 0 ? "+" : ""}${prices[h.t].change.toFixed(2)}%` : "—"}
                            </td>

                            {isIncome && <td style={{ padding: "5px 4px", textAlign: "right", color: "var(--green)" }}>{h.y}%</td>}

                            {/* Edit button */}
                            <td style={{ padding: "5px 0", textAlign: "right", whiteSpace: "nowrap" }}>
                              {isEditing ? (
                                <span style={{ display: "flex", gap: 3 }}>
                                  <button onClick={saveEdit} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "none", background: "var(--green)", color: "#1e1f22", cursor: "pointer", fontWeight: 700 }}>Save</button>
                                  <button onClick={() => setEditingIdx(null)} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, border: "none", background: "var(--divider)", color: "var(--sub)", cursor: "pointer" }}>✕</button>
                                </span>
                              ) : (
                                <span style={{ display: "flex", gap: 3 }}>
                                  <button onClick={() => startEdit(i)} title="Edit ticker/name" style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "none", background: "var(--card-alt)", color: "var(--muted)", cursor: "pointer" }}>✏️</button>
                                  {!isDefault && <button onClick={() => resetHolding(i)} title="Reset to default" style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, border: "none", background: "var(--card-alt)", color: "var(--muted)", cursor: "pointer" }}>↺</button>}
                                </span>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    )
                  })}

                  {/* Totals row */}
                  {!isJunior && hasAnyPositions && (
                    <tr style={{ borderTop: "2px solid var(--divider)", fontWeight: 700 }}>
                      <td colSpan={4} style={{ padding: "6px 4px", color: "var(--muted)", fontSize: 11 }}>TOTAL</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", color: "var(--text)" }}>{fmtDec(totalMarketValue, port.symbol)}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", color: totalGainLoss >= 0 ? "var(--green)" : "var(--red)" }}>
                        {totalGainLoss >= 0 ? "+" : ""}{fmtDec(totalGainLoss, port.symbol)}
                        {totalGainLossPct !== null && <span style={{ fontSize: 10, display: "block", fontWeight: 400 }}>{totalGainLossPct >= 0 ? "+" : ""}{totalGainLossPct.toFixed(1)}%</span>}
                      </td>
                      <td colSpan={isIncome ? 3 : 2} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {isIncome && blendedYield != null && (
              <div style={{ marginTop: 16, padding: 14, background: "var(--card-alt)", borderRadius: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ color: "var(--sub)", fontSize: 13 }}>Blended yield</span>
                  <span style={{ color: "var(--amber)", fontWeight: 700 }}>{blendedYield.toFixed(1)}%</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--sub)", fontSize: 13 }}>Est. monthly income on {fmt(annualDep, port.symbol)} invested</span>
                  <span style={{ color: "var(--green)", fontWeight: 700 }}>{fmt(monthlyIncome!, port.symbol)}/mo</span>
                </div>
              </div>
            )}
          </div>

          {/* Right: Tax accounts + tips */}
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 24 }}>
            <h3 style={{ fontWeight: 700, marginBottom: 16, color: "var(--text)" }}>Tax-Advantaged Account Placement</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {port.tax_accounts.map((ta, i) => (
                <div key={i} style={{ background: "var(--card-alt)", borderRadius: 8, padding: 14, borderLeft: `3px solid ${PRIORITY_COLORS[ta.priority]}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 4, background: PRIORITY_COLORS[ta.priority], color: "#1e1f22" }}>{PRIORITY_LABEL[ta.priority]}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{ta.k}</span>
                  </div>
                  <p style={{ color: "var(--sub)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>{ta.v}</p>
                </div>
              ))}
            </div>

            {taxTips.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 14 }}>💡</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: "var(--amber)" }}>
                    {isJunior ? "Tips for Young Investors" : "Smart Tax Tips for Your Holdings"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {taxTips.map((tip, i) => (
                    <div key={i} style={{ background: "var(--card-alt)", borderRadius: 8, padding: 12, borderLeft: "3px solid var(--amber)", display: "flex", gap: 10 }}>
                      <span style={{ color: "var(--amber)", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>#{i+1}</span>
                      <p style={{ color: "var(--sub)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>{tip}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Portfolio Score Card (adult only) ── */}
        {!isJunior && (
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 24, marginBottom: 20, border: `1px solid ${scoreCol}` }}>
            <h3 style={{ fontWeight: 700, color: "var(--text)", marginBottom: 20 }}>Portfolio Score</h3>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 32, alignItems: "center" }}>
              <div style={{ textAlign: "center", minWidth: 120 }}>
                <div style={{ fontSize: 72, fontWeight: 900, color: scoreCol, lineHeight: 1 }}>{score.overall}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: scoreCol }}>{scoreGrade(score.overall)}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>out of 100</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Growth Potential",  val: score.growthScore,  desc: `${returnPct}% expected annual return` },
                  { label: "Diversification",   val: score.diversScore,  desc: `${effectiveHoldings.length} holdings across types` },
                  { label: "Upside Strength",   val: score.upsideScore,  desc: isIncome ? `${blendedYield?.toFixed(1) ?? "—"}% blended yield` : "Stock/growth allocation mix" },
                  { label: "Goal Probability",  val: score.goalProb,     desc: `Hit ${fmt(targetGoal, port.symbol)} in ${years} yrs (Monte Carlo)` },
                ].map(sub => (
                  <div key={sub.label} style={{ background: "var(--card-alt)", borderRadius: 8, padding: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--sub)", fontWeight: 600 }}>{sub.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: scoreColor(sub.val) }}>{sub.val}%</span>
                    </div>
                    <div style={{ height: 6, background: "var(--divider)", borderRadius: 3, marginBottom: 6 }}>
                      <div style={{ height: "100%", width: `${sub.val}%`, background: scoreColor(sub.val), borderRadius: 3, transition: "width 0.5s ease" }} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{sub.desc}</div>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11, marginTop: 16, marginBottom: 0 }}>
              Score weights: Growth Potential 30% · Diversification 25% · Goal Probability 25% · Upside Strength 20%. Monte Carlo runs 600 simulations. For illustration only.
            </p>
          </div>
        )}

        {/* ── Wildcard Manager ── */}
        <div style={{ background: "var(--card)", borderRadius: 12, padding: 24, marginBottom: 20, border: "1px solid var(--red)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <h3 style={{ fontWeight: 700, color: "var(--red)", margin: 0 }}>Wildcard Manager — 5% Slot</h3>
            <span style={{ color: "var(--sub)", fontSize: 13 }}>{activeWildcards.length} active · each gets {wildcardSlotPct}% of portfolio</span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 16 }}>
            {isJunior
              ? "These are higher-risk bonus picks for the 5% growth slot. Toggling is available in Adult mode."
              : "Click a card to toggle in or out. Add your own tickers below."}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12, marginBottom: isJunior ? 0 : 20 }}>
            {(wildcards[wcKey] ?? []).map((w, i) => {
              const col = WILDCARD_COLORS[i % WILDCARD_COLORS.length]
              return (
                <div key={w.t}
                  onClick={() => !isJunior && toggleWildcard(w.t)}
                  style={{
                    background: w.active ? "rgba(235,105,95,0.12)" : "var(--card-alt)",
                    border: `2px solid ${w.active ? col : "var(--divider)"}`,
                    borderRadius: 10, padding: 14,
                    cursor: isJunior ? "default" : "pointer",
                    transition: "all 0.15s", position: "relative",
                    opacity: isJunior && !w.active ? 0.5 : 1,
                  }}>
                  {w.active && !isJunior && <span style={{ position: "absolute", top: 8, right: 8, color: col, fontWeight: 700, fontSize: 14 }}>✓</span>}
                  {isJunior && w.active && <span style={{ position: "absolute", top: 8, right: 8, color: col, fontWeight: 700, fontSize: 12 }}>Default</span>}
                  <div style={{ fontWeight: 700, fontSize: 15, color: w.active ? col : "var(--sub)", marginBottom: 2 }}>{w.t}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{w.n}</div>
                  <div style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--divider)", display: "inline-block", color: "var(--sub)", marginBottom: 8 }}>{w.sector}</div>
                  {w.y && <div style={{ fontSize: 12, color: "var(--amber)", marginBottom: 4 }}>{w.y}% yield · {w.cadence}</div>}
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.4 }}>{w.blurb}</div>
                </div>
              )
            })}
          </div>
          {!isJunior && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={customTicker} onChange={e => setCustomTicker(e.target.value)} placeholder="Ticker (e.g. TSM)"
                style={{ background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", width: 140, fontSize: 13 }} />
              <input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="Name (optional)"
                style={{ background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", width: 200, fontSize: 13 }} />
              <button onClick={addCustomWildcard} style={{ background: "var(--red)", border: "none", borderRadius: 6, padding: "8px 18px", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ Add</button>
            </div>
          )}
        </div>

        {/* ── Growth Calculator ── */}
        <div style={{ background: "var(--card)", borderRadius: 12, padding: 24, marginBottom: 20 }}>
          <h3 style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
            {isJunior ? "Compounding Calculator — See What Time Can Do" : "Growth Calculator"}
          </h3>
          {!isJunior && hasAnyPositions && (
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 16 }}>Starting balance auto-filled from your current market value ({fmtDec(totalMarketValue, port.symbol)})</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20, marginBottom: 24, marginTop: 16 }}>
            <div>
              <label style={{ color: "var(--sub)", fontSize: 13, display: "block", marginBottom: 6 }}>Starting balance ({port.symbol})</label>
              <input type="number" value={hasAnyPositions && totalMarketValue > 0 ? Math.round(totalMarketValue) : startBal}
                onChange={e => setStartBal(+e.target.value)} min={0}
                style={{ width: "100%", background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 14 }} />
            </div>
            <div>
              <label style={{ color: "var(--sub)", fontSize: 13, display: "block", marginBottom: 6 }}>Annual deposit ({port.symbol})</label>
              <input type="number" value={annualDep} onChange={e => setAnnualDep(+e.target.value)} min={0}
                style={{ width: "100%", background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 14 }} />
            </div>
            {!isJunior && (
              <div>
                <label style={{ color: "var(--sub)", fontSize: 13, display: "block", marginBottom: 6 }}>Target goal ({port.symbol})</label>
                <input type="number" value={targetGoal} onChange={e => setTargetGoal(+e.target.value)} min={0}
                  style={{ width: "100%", background: "var(--card-alt)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 14 }} />
              </div>
            )}
            <div>
              <label style={{ color: "var(--sub)", fontSize: 13, display: "block", marginBottom: 6 }}>Years: {years}</label>
              <input type="range" min={5} max={60} value={years} onChange={e => setYears(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}><span>5</span><span>60</span></div>
            </div>
            <div>
              <label style={{ color: "var(--sub)", fontSize: 13, display: "block", marginBottom: 6 }}>Return: {returnPct}%/yr</label>
              <input type="range" min={4} max={14} value={returnPct} onChange={e => setReturnPct(+e.target.value)} style={{ width: "100%", accentColor: "var(--accent)" }} />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}><span>4%</span><span>14%</span></div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            {[
              { label: "Total Deposited",   val: fmt(calcData.totalDep, port.symbol), color: "var(--muted)" },
              { label: "Investment Growth",  val: fmt(calcData.growth,   port.symbol), color: "var(--green)" },
              { label: "Final Value",        val: fmt(calcData.finalVal, port.symbol), color: "var(--accent)" },
            ].map(card => (
              <div key={card.label} style={{ background: "var(--card-alt)", borderRadius: 8, padding: 16, textAlign: "center" }}>
                <div style={{ color: "var(--sub)", fontSize: 12, marginBottom: 6 }}>{card.label}</div>
                <div style={{ color: card.color, fontSize: 22, fontWeight: 800 }}>{card.val}</div>
              </div>
            ))}
          </div>

          <Line data={lineData} options={lineOptions as any} />
        </div>

        {/* ── CSV Export ── */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 24 }}>
          <button onClick={() => exportCSV(false)} style={{ background: "var(--card)", border: "1px solid var(--divider)", borderRadius: 6, padding: "8px 18px", color: "var(--sub)", fontSize: 13, cursor: "pointer" }}>
            Export current view (CSV)
          </button>
          <button onClick={() => exportCSV(true)} style={{ background: "var(--accent)", border: "none", borderRadius: 6, padding: "8px 18px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Export all 6 portfolios (CSV)
          </button>
        </div>

        <div style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, lineHeight: 1.7 }}>
          Educational tool only — not investment advice. Past performance does not guarantee future results.<br />
          Yield figures are approximate and fluctuate with price. Tax rules change — verify with a tax professional.
        </div>
      </div>
    </div>
  )
}
