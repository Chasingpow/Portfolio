import { NextRequest, NextResponse } from "next/server"

// Maps Canadian tickers to Yahoo Finance format
const CAD_TICKERS = new Set([
  "VFV","XEQT","VDY","ZQQ","SHOP","RY","ENB","BAM","CNR",
  "LSPD","CSU","HUT","OTEX","CCO","ATD","WCN","DOO",
  "PPL","ZWC","EIF","FTS","BCE","BNS","TRP","T","AQN","NPI","CHE.UN","BPYP.PR",
])
const CAD_UN = new Set(["REI.UN","DIR.UN","GRT.UN","BIP.UN","CHE.UN"])
const INDIA_TICKERS = new Set([
  "EMBASSY","POWERGRIDINVIT","INDIGRID","COALINDIA","ITC","NIPPONDIV",
  "MINDSPACE","BIRET","NEXUS","ONGC","MON100",
])

function toYahoo(ticker: string, region: string): string {
  if (region === "Canada") {
    if (CAD_UN.has(ticker)) return ticker.replace(".UN", "-UN.TO").replace(".PR", "-PR.TO")
    if (CAD_TICKERS.has(ticker)) return `${ticker}.TO`
  }
  if (region === "India" && INDIA_TICKERS.has(ticker)) return `${ticker}.NS`
  // LRS tickers have suffix stripped
  return ticker.replace(/-LRS$/, "")
}

export async function POST(req: NextRequest) {
  try {
    const { tickers, region } = await req.json() as { tickers: string[], region: string }

    const yahooSymbols = tickers.map(t => toYahoo(t, region)).join(",")
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(yahooSymbols)}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketPreviousClose,currency`

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 300 }, // cache 5 min
    })

    if (!res.ok) return NextResponse.json({})

    const data = await res.json()
    const results: Record<string, { price: number; change: number; currency: string }> = {}

    for (let i = 0; i < tickers.length; i++) {
      const quote = data?.quoteResponse?.result?.[i]
      if (quote) {
        results[tickers[i]] = {
          price: quote.regularMarketPrice ?? 0,
          change: quote.regularMarketChangePercent ?? 0,
          currency: quote.currency ?? "USD",
        }
      }
    }

    return NextResponse.json(results)
  } catch {
    return NextResponse.json({})
  }
}
