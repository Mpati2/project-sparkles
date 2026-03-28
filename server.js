require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FINNHUB_KEY = process.env.FINNHUB_KEY;
const CLAUDE_KEY = process.env.CLAUDE_KEY;
const AV_KEY = process.env.AV_KEY || '';
const INVESTING_TOKEN = process.env.INVESTING_TOKEN || '';
const PORT = process.env.PORT || 3000;

// ── HEALTH CHECK ──
app.get('/api/status', (req, res) => {
  res.json({
    claude: !!CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here',
    finnhub: !!FINNHUB_KEY && FINNHUB_KEY !== 'your_finnhub_key_here',
    investing: !!INVESTING_TOKEN && INVESTING_TOKEN !== 'your_investing_token_here',
  });
});

// ── ECONOMIC CALENDAR ──
app.get('/api/economic', async (req, res) => {
  try {
    let avData = {};
    if (AV_KEY) {
      try {
        const [cpi, unemployment, gdp, retail] = await Promise.allSettled([
          fetch(`https://www.alphavantage.co/query?function=CPI&interval=monthly&apikey=${AV_KEY}`).then(r => r.json()),
          fetch(`https://www.alphavantage.co/query?function=UNEMPLOYMENT&apikey=${AV_KEY}`).then(r => r.json()),
          fetch(`https://www.alphavantage.co/query?function=REAL_GDP&interval=quarterly&apikey=${AV_KEY}`).then(r => r.json()),
          fetch(`https://www.alphavantage.co/query?function=RETAIL_SALES&apikey=${AV_KEY}`).then(r => r.json()),
        ]);
        if (cpi.status === 'fulfilled') avData.cpi = cpi.value?.data?.[0];
        if (unemployment.status === 'fulfilled') avData.unemployment = unemployment.value?.data?.[0];
        if (gdp.status === 'fulfilled') avData.gdp = gdp.value?.data?.[0];
        if (retail.status === 'fulfilled') avData.retail = retail.value?.data?.[0];
      } catch (e) { console.log('AV fetch partial fail:', e.message); }
    }
    const { from } = req.query;
    const weekStart = from ? new Date(from) : new Date();
    res.json({ events: buildWeeklyCalendar(weekStart, avData) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildWeeklyCalendar(weekStart, avData) {
  const d = new Date(weekStart);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const days = Array.from({ length: 5 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
  const cpiPrev = avData.cpi?.value ? parseFloat(avData.cpi.value).toFixed(1) : null;
  const unemployPrev = avData.unemployment?.value ? parseFloat(avData.unemployment.value).toFixed(1) : null;
  const gdpPrev = avData.gdp?.value ? parseFloat(avData.gdp.value).toFixed(1) : null;
  const retailPrev = avData.retail?.value ? parseFloat(avData.retail.value).toFixed(0) : null;
  return [
    { id: 'eco_jobless_claims', name: 'Initial Jobless Claims', time: `${days[3]}T12:30:00`, actual: null, estimate: '215K', prev: '220K', impact: 'high', unit: 'K', country: 'US' },
    { id: 'eco_continuing_claims', name: 'Continuing Jobless Claims', time: `${days[3]}T12:30:00`, actual: null, estimate: '1870K', prev: '1880K', impact: 'medium', unit: 'K', country: 'US' },
    { id: 'eco_pmi_mfg', name: 'S&P Global Manufacturing PMI', time: `${days[0]}T13:45:00`, actual: null, estimate: '52.0', prev: '51.6', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_pmi_svc', name: 'S&P Global Services PMI', time: `${days[0]}T13:45:00`, actual: null, estimate: '54.3', prev: '54.4', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_existing_home', name: 'Existing Home Sales', time: `${days[2]}T14:00:00`, actual: null, estimate: '4.15M', prev: '4.08M', impact: 'medium', unit: 'M', country: 'US' },
    { id: 'eco_crude_inventory', name: 'Crude Oil Inventories', time: `${days[2]}T14:30:00`, actual: null, estimate: '-1.2M', prev: '-2.3M', impact: 'high', unit: 'M', country: 'US' },
    { id: 'eco_fed_speak', name: 'Fed Member Speech', time: `${days[1]}T17:00:00`, actual: null, estimate: 'Neutral', prev: 'Hawkish', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_consumer_conf', name: 'CB Consumer Confidence', time: `${days[1]}T14:00:00`, actual: null, estimate: '104.5', prev: '103.0', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_durable_goods', name: 'Core Durable Goods Orders m/m', time: `${days[2]}T12:30:00`, actual: null, estimate: '0.3%', prev: '0.1%', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_gdp', name: 'GDP Growth Rate QoQ', time: `${days[3]}T12:30:00`, actual: null, estimate: gdpPrev ? `${gdpPrev}%` : '2.8%', prev: gdpPrev ? `${gdpPrev}%` : '3.1%', impact: 'high', unit: '', country: 'US' },
    { id: 'eco_pce', name: 'Core PCE Price Index m/m', time: `${days[4]}T12:30:00`, actual: null, estimate: '0.3%', prev: cpiPrev ? `${cpiPrev}%` : '0.4%', impact: 'high', unit: '', country: 'US' },
    { id: 'eco_michigan', name: 'Michigan Consumer Sentiment', time: `${days[4]}T14:00:00`, actual: null, estimate: '73.0', prev: '71.8', impact: 'medium', unit: '', country: 'US' },
    { id: 'eco_unemployment', name: 'Unemployment Rate', time: `${days[4]}T12:30:00`, actual: null, estimate: unemployPrev ? `${unemployPrev}%` : '4.1%', prev: unemployPrev ? `${unemployPrev}%` : '4.1%', impact: 'high', unit: '', country: 'US' },
    { id: 'eco_retail_sales', name: 'Retail Sales m/m', time: `${days[1]}T12:30:00`, actual: null, estimate: '0.4%', prev: retailPrev ? `${retailPrev}%` : '0.2%', impact: 'high', unit: '', country: 'US' },
  ].sort((a, b) => new Date(a.time) - new Date(b.time));
}

// ── EARNINGS CALENDAR (investing.com direct API) ──
app.get('/api/earnings', async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to dates required' });

  if (!INVESTING_TOKEN) {
    return res.status(500).json({ error: 'INVESTING_TOKEN not set in .env' });
  }

  try {
    const startDate = encodeURIComponent(`${from}T00:00:00.000Z`);
    const endDate = encodeURIComponent(`${to}T23:59:59.000Z`);
    const url = `https://endpoints.investing.com/earnings/v1/instruments/earnings?start_date=${startDate}&end_date=${endDate}&country_ids=5&limit=200&deduplicate=true`;

    console.log(`Fetching: ${url}`);

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Authorization': `Bearer ${INVESTING_TOKEN}`,
        'Origin': 'https://www.investing.com',
        'Referer': 'https://www.investing.com/earnings-calendar/',
      }
    });

    console.log(`investing.com response status: ${r.status}`);

    if (!r.ok) {
      const body = await r.text();
      console.error('investing.com error body:', body.slice(0, 300));
      throw new Error(`investing.com responded with ${r.status}`);
    }

    const data = await r.json();
    console.log('investing.com raw keys:', Object.keys(data));

    const shaped = shapeInvestingData(data, from);
    console.log(`investing.com: ${shaped.length} earnings events`);
    return res.json({ events: shaped, source: 'investing' });

  } catch (err) {
    console.error('investing.com failed:', err.message);
    return res.status(500).json({
      error: `investing.com failed: ${err.message}. Your token may have expired — get a fresh one from the Network tab on investing.com/earnings-calendar and update INVESTING_TOKEN in .env`
    });
  }
});

function shapeInvestingData(data, fallbackDate) {
  const rows = data?.data || data?.earnings || data?.instruments || data?.results || [];
  console.log(`shapeInvestingData: ${rows.length} raw rows`);

  return rows.map((e, i) => {
    const symbol = e.ticker || e.symbol || e.instrumentShortName || e.name || '';
    const date = e.releaseDate || e.date || e.reportDate || fallbackDate;
    const time = (e.releaseTime || e.time || '').toLowerCase();

    return {
      id: `earn_${symbol}_${date}_${i}`,
      symbol: symbol.toUpperCase(),
      date: date ? date.split('T')[0] : fallbackDate,
      hour: time.includes('before') || time === 'bmo' ? 'bmo'
        : time.includes('after') || time === 'amc' ? 'amc' : '',
      epsEstimate: e.epsForecast ?? e.eps_estimate ?? e.estimatedEPS ?? null,
      epsActual: e.epsActual ?? e.eps_actual ?? e.reportedEPS ?? null,
      revenueEstimate: e.revenueForecast ?? e.rev_estimate ?? e.revenueEstimate ?? null,
      revenueActual: e.revenueActual ?? e.rev_actual ?? null,
      quarter: e.fiscalQuarter ?? e.quarter ?? null,
      year: e.fiscalYear ?? e.year ?? null,
    };
  }).filter(e => e.symbol);
}

// ── BOT FORECAST (ECONOMIC) ──
app.post('/api/forecast/economic', async (req, res) => {
  const { event } = req.body;
  if (!event) return res.status(400).json({ error: 'event data required' });
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const prompt = `You are an expert macro economist and intraday CFD trader. Today is ${today}.
Analyze this upcoming US economic event and provide a structured JSON response:
Event: ${event.name}
Release Time: ${event.time || 'This week'}
Analyst Consensus: ${event.estimate != null ? event.estimate + (event.unit || '') : 'Unknown'}
Previous Release: ${event.prev != null ? event.prev + (event.unit || '') : 'Unknown'}
Impact Level: ${event.impact}
Use web search to find recent data, trends, leading indicators, and analyst commentary to form your OWN independent forecast.
Return ONLY this JSON (no markdown):
{
  "forecast": "<your predicted value>",
  "forecastRationale": "<2-3 sentences>",
  "marketPriced": "<what market is pricing in>",
  "beatMissScenario": { "beat": "<asset reaction if beat>", "miss": "<asset reaction if miss>" },
  "trade": { "direction": "BUY or SHORT", "asset": "<CFD asset>", "entry": "<price>", "tp": "<take profit>", "sl": "<stop loss>", "rationale": "<1-2 sentences>" },
  "confidence": <0-100>,
  "keyRisks": ["<risk 1>", "<risk 2>"]
}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }], messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Claude error'); }
    const data = await r.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Claude response');
    res.json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BOT FORECAST (EARNINGS) — MARKET CONSENSUS ENGINE ──
app.post('/api/forecast/earnings', async (req, res) => {
  const { event } = req.body;
  if (!event) return res.status(400).json({ error: 'event data required' });
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const prompt = `You are an expert equity analyst and intraday CFD trader. Today is ${today}.
You understand a critical distinction: the ANALYST CONSENSUS is the publicly published estimate.
The MARKET CONSENSUS is what the stock price is actually implying — it is DIFFERENT and HIDDEN.
The stock moves based on the gap between MARKET CONSENSUS and ACTUAL RESULTS, not analyst estimates.
Company: ${event.symbol}
Quarter: Q${event.quarter || '?'} ${event.year || ''}
EPS Analyst Consensus: ${event.epsEstimate != null ? '$' + event.epsEstimate : 'Unknown'}
Revenue Analyst Consensus: ${event.revenueEstimate != null ? '$' + event.revenueEstimate + 'B' : 'Unknown'}
Reporting Time: ${event.hour === 'bmo' ? 'Pre-market (BMO)' : event.hour === 'amc' ? 'After-market (AMC)' : 'Unknown'}
Use web search to gather 4 proxy signals: analyst revisions, stock price drift, options IV, short interest.
Return ONLY this JSON (no markdown):
{
  "analystConsensus": { "eps": "<analyst EPS>", "revenue": "<analyst revenue>" },
  "marketConsensusEstimate": { "eps": "<market EPS>", "revenue": "<market revenue>", "direction": "ABOVE_ANALYST or BELOW_ANALYST or IN_LINE", "rationale": "<2-3 sentences>" },
  "proxySignals": { "analystRevisions": "<findings>", "stockDrift": "<price action>", "optionsSentiment": "<IV and put/call>", "shortInterest": "<trend>" },
  "myForecast": { "eps": "<your EPS>", "revenue": "<your revenue>", "rationale": "<2-3 sentences>" },
  "expectedMove": { "percent": "<e.g. ±5.2%>", "direction": "UP or DOWN or NEUTRAL", "rationale": "<1-2 sentences>" },
  "beatMissProbability": { "beatMarketConsensus": <0-100>, "missMarketConsensus": <0-100>, "note": "<1 sentence>" },
  "vsMarketConsensus": { "myEpsVsMarket": "BEAT or MISS or IN_LINE", "myRevenueVsMarket": "BEAT or MISS or IN_LINE", "edgeExists": <true or false>, "edgeSummary": "<1-2 sentences>" },
  "trade": { "direction": "BUY or SHORT or NO_TRADE", "asset": "<e.g. AAPL CFD>", "entry": "<price>", "tp": "<take profit>", "sl": "<stop loss>", "rationale": "<1-2 sentences>" },
  "confidenceVsMarket": <0-100>,
  "keyRisks": ["<risk 1>", "<risk 2>", "<risk 3>"]
}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }], messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Claude error'); }
    const data = await r.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Claude response');
    res.json(JSON.parse(match[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/predict-manual', async (req, res) => {
  const { type, asset, consensus, previous } = req.body;
  const prompt = `Analyze ${type} for ${asset}. Consensus: ${consensus}, Prev: ${previous}. 
  Provide forecast and a CFD trade (Direction, Entry, TP, SL). 
  Return JSON only: {"forecast":"...","mispriced":"...","trade":{"dir":"BUY/SELL","entry":"...","tp":"...","sl":"..."}}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await r.json();
    res.json(JSON.parse(data.content[0].text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✦ Project Sparkles running at http://localhost:${PORT}`);
  console.log(`  Claude key:       ${CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' ? '✓ set' : '✗ missing'}`);
  console.log(`  Investing token:  ${INVESTING_TOKEN && INVESTING_TOKEN !== 'your_investing_token_here' ? '✓ set' : '✗ missing — get from investing.com Network tab'}`);
  console.log(`  Finnhub key:      ${FINNHUB_KEY && FINNHUB_KEY !== 'your_finnhub_key_here' ? '✓ set' : '✗ missing (optional)'}\n`);
});



