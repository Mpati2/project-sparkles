require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const PORT = process.env.PORT || 3000;

// ── PERSISTENT STORAGE ──
const DATA_FILE = path.join(__dirname, 'events.json');
const PORTFOLIO_FILE = path.join(__dirname, 'portfolio.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { console.error('Load error:', e.message); }
  return { events: [] };
}

function saveData(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Save error:', e.message); }
}

function loadPortfolio() {
  try {
    if (fs.existsSync(PORTFOLIO_FILE)) return JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8'));
  } catch (e) { console.error('Portfolio load error:', e.message); }
  return { startingBalance: 10000, trades: [] };
}

function savePortfolio(data) {
  try { fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Portfolio save error:', e.message); }
}

// ── HEALTH CHECK ──
app.get('/api/status', (req, res) => {
  res.json({ claude: !!CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' });
});

// ── GET ALL EVENTS ──
app.get('/api/events', (req, res) => {
  const { type } = req.query;
  const data = loadData();
  const events = type ? data.events.filter(e => e.type === type) : data.events;
  events.sort((a, b) => {
    const aDate = new Date(a.eventDate);
    const bDate = new Date(b.eventDate);
    const now = new Date();
    const aPast = aDate < now;
    const bPast = bDate < now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? bDate - aDate : aDate - bDate;
  });
  res.json({ events });
});

// ── ADD EVENT ──
app.post('/api/events', (req, res) => {
  const { type, ticker, companyName, eventDate, eventTime,
          epsEstimate, epsPrevious, revenueEstimate, revenuePrevious,
          economicName, economicConsensus, economicPrevious, economicUnit,
          notes } = req.body;

  if (!type || !eventDate) return res.status(400).json({ error: 'type and eventDate required' });

  const data = loadData();
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const event = {
    id, type, eventDate,
    eventTime: eventTime || '08:30',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ticker: ticker?.toUpperCase() || null,
    companyName: companyName || null,
    epsEstimate: epsEstimate || null,
    epsPrevious: epsPrevious || null,
    revenueEstimate: revenueEstimate || null,
    revenuePrevious: revenuePrevious || null,
    economicName: economicName || null,
    economicConsensus: economicConsensus || null,
    economicPrevious: economicPrevious || null,
    economicUnit: economicUnit || '',
    notes: notes || '',
    analysis: null,
    actualEps: null,
    actualRevenue: null,
    actualEconomic: null,
    resultOutcome: null,
    resultNotes: null,
    resultedAt: null,
  };

  data.events.push(event);
  saveData(data);
  res.json({ event });
});

// ── DELETE EVENT ──
app.delete('/api/events/:id', (req, res) => {
  const data = loadData();
  data.events = data.events.filter(e => e.id !== req.params.id);
  saveData(data);
  res.json({ ok: true });
});

// ── ANALYZE EVENT ──
app.post('/api/events/:id/analyze', async (req, res) => {
  const data = loadData();
  const event = data.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Claude key not set in .env' });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  let prompt;

  if (event.type === 'earnings') {
    prompt = `You are an expert equity analyst and intraday CFD trader. Today is ${today}.
The MARKET CONSENSUS is what the stock price actually implies — different from the published analyst number.
Company: ${event.ticker} (${event.companyName || event.ticker})
Upcoming Earnings Date: ${event.eventDate} ${event.eventTime}
EPS Analyst Consensus: ${event.epsEstimate ? '$' + event.epsEstimate : 'Not provided'}
EPS Previous: ${event.epsPrevious ? '$' + event.epsPrevious : 'Not provided'}
Revenue Analyst Consensus: ${event.revenueEstimate ? '$' + event.revenueEstimate + 'B' : 'Not provided'}
Revenue Previous: ${event.revenuePrevious ? '$' + event.revenuePrevious + 'B' : 'Not provided'}
Notes: ${event.notes || 'None'}
Use web search for 4 proxy signals: analyst revisions, stock drift, options IV/put-call, short interest.
Return ONLY this JSON (no markdown):
{
  "analystConsensus": { "eps": "<analyst EPS>", "revenue": "<analyst revenue>" },
  "marketConsensusEstimate": { "eps": "<market EPS>", "revenue": "<market revenue>", "direction": "ABOVE_ANALYST or BELOW_ANALYST or IN_LINE", "rationale": "<2-3 sentences>" },
  "proxySignals": { "analystRevisions": "<findings>", "stockDrift": "<price action>", "optionsSentiment": "<IV and put/call>", "shortInterest": "<trend>" },
  "myForecast": { "eps": "<your EPS>", "revenue": "<your revenue>", "rationale": "<2-3 sentences>" },
  "expectedMove": { "percent": "<e.g. ±5.2%>", "direction": "UP or DOWN or NEUTRAL", "rationale": "<1-2 sentences>" },
  "trade": { "direction": "BUY or SHORT or NO_TRADE", "asset": "<e.g. AAPL CFD>", "entry": "<price>", "tp": "<take profit>", "sl": "<stop loss>", "rationale": "<1-2 sentences>" },
  "confidenceScore": <0-100>,
  "keyRisks": ["<risk 1>", "<risk 2>", "<risk 3>"]
}`;
  } else {
    prompt = `You are an expert macro economist and intraday CFD trader. Today is ${today}.
Event: ${event.economicName}
Release: ${event.eventDate} ${event.eventTime} ET
Consensus: ${event.economicConsensus}${event.economicUnit}
Previous: ${event.economicPrevious}${event.economicUnit}
Notes: ${event.notes || 'None'}
Use web search for recent data, leading indicators, and analyst commentary.
Return ONLY this JSON (no markdown):
{
  "forecast": "<your predicted value>",
  "forecastRationale": "<2-3 sentences>",
  "marketPricedIn": "<what market expects>",
  "marketPricedRationale": "<2-3 sentences>",
  "beatMissScenario": { "beat": "<reaction if beat>", "miss": "<reaction if miss>" },
  "trade": { "direction": "BUY or SHORT", "asset": "<CFD asset>", "entry": "<price>", "tp": "<take profit>", "sl": "<stop loss>", "rationale": "<1-2 sentences>" },
  "confidenceScore": <0-100>,
  "keyRisks": ["<risk 1>", "<risk 2>"]
}`;
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || `Claude error ${r.status}`); }
    const aiData = await r.json();
    const text = aiData.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Claude JSON response');

    event.analysis = JSON.parse(match[0]);
    event.status = 'analyzed';
    event.analyzedAt = new Date().toISOString();
    saveData(data);
    res.json({ event });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RECORD RESULT ──
app.post('/api/events/:id/result', (req, res) => {
  const { actualEps, actualRevenue, actualEconomic, resultOutcome, resultNotes } = req.body;
  const data = loadData();
  const event = data.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  event.actualEps = actualEps || null;
  event.actualRevenue = actualRevenue || null;
  event.actualEconomic = actualEconomic || null;
  event.resultOutcome = resultOutcome;
  event.resultNotes = resultNotes || null;
  event.status = resultOutcome ? 'resulted' : 'analyzed';
  event.resultedAt = new Date().toISOString();

  saveData(data);
  res.json({ event });
});

// ── STATS ──
app.get('/api/stats', (req, res) => {
  const data = loadData();
  const resulted = data.events.filter(e => e.status === 'resulted');
  const correct = resulted.filter(e => e.resultOutcome === 'correct').length;
  const partial = resulted.filter(e => e.resultOutcome === 'partial').length;
  const incorrect = resulted.filter(e => e.resultOutcome === 'incorrect').length;
  const total = resulted.length;
  res.json({
    total, correct, partial, incorrect,
    winRate: total > 0 ? Math.round((correct / total) * 100) : 0,
  });
});

// ── PORTFOLIO: GET ALL TRADES ──
app.get('/api/portfolio', (req, res) => {
  const portfolio = loadPortfolio();
  res.json(portfolio);
});

// ── PORTFOLIO: ADD TRADE ──
app.post('/api/portfolio/trades', (req, res) => {
  const { asset, direction, entryPrice, exitPrice, pnl, tradeDate, tradeTime, linkedEventId, notes } = req.body;
  if (!asset || pnl === undefined) return res.status(400).json({ error: 'asset and pnl required' });

  const portfolio = loadPortfolio();
  const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

  const trade = {
    id,
    asset,
    direction: direction || 'BUY',
    entryPrice: entryPrice || null,
    exitPrice: exitPrice || null,
    pnl: parseFloat(pnl),
    tradeDate: tradeDate || new Date().toISOString().split('T')[0],
    tradeTime: tradeTime || new Date().toTimeString().slice(0, 5),
    linkedEventId: linkedEventId || null,
    notes: notes || '',
    createdAt: new Date().toISOString(),
  };

  portfolio.trades.push(trade);
  savePortfolio(portfolio);
  res.json({ trade });
});

// ── PORTFOLIO: DELETE TRADE ──
app.delete('/api/portfolio/trades/:id', (req, res) => {
  const portfolio = loadPortfolio();
  portfolio.trades = portfolio.trades.filter(t => t.id !== req.params.id);
  savePortfolio(portfolio);
  res.json({ ok: true });
});

// ── PORTFOLIO: UPDATE STARTING BALANCE ──
app.post('/api/portfolio/balance', (req, res) => {
  const { startingBalance } = req.body;
  const portfolio = loadPortfolio();
  portfolio.startingBalance = parseFloat(startingBalance);
  savePortfolio(portfolio);
  res.json({ ok: true });
});

// ── S&P 500 DATA (Yahoo Finance unofficial) ──
app.get('/api/sp500', async (req, res) => {
  const { interval } = req.query; // 5m, 1h, 1d, 1wk
  const validIntervals = { '5m': { interval: '5m', range: '1d' }, '1h': { interval: '1h', range: '5d' }, '1d': { interval: '1d', range: '1mo' }, '1wk': { interval: '1wk', range: '1y' } };
  const params = validIntervals[interval] || validIntervals['1d'];

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=${params.interval}&range=${params.range}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) throw new Error(`Yahoo Finance error ${r.status}`);
    const data = await r.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const firstClose = closes.find(c => c != null);

    const points = timestamps.map((ts, i) => ({
      time: ts * 1000,
      price: closes[i],
      pct: firstClose ? ((closes[i] - firstClose) / firstClose) * 100 : 0,
    })).filter(p => p.price != null);

    res.json({ points });
  } catch (err) {
    console.error('SP500 error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✦ Project Sparkles running at http://localhost:${PORT}`);
  console.log(`  Claude key: ${CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' ? '✓ set' : '✗ missing — edit .env'}\n`);
});
