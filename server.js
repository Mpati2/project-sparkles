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

// ── PERSISTENT STORAGE (events.json) ──
const DATA_FILE = path.join(__dirname, 'events.json');

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

// ── HEALTH CHECK ──
app.get('/api/status', (req, res) => {
  res.json({ claude: !!CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' });
});

// ── GET ALL EVENTS ──
app.get('/api/events', (req, res) => {
  const { type } = req.query;
  const data = loadData();
  const events = type ? data.events.filter(e => e.type === type) : data.events;
  // sort: upcoming first, then past by date desc
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
    id,
    type, // 'earnings' or 'economic'
    eventDate,
    eventTime: eventTime || '08:30',
    status: 'pending', // pending | analyzed | resulted
    createdAt: new Date().toISOString(),
    // Earnings fields
    ticker: ticker?.toUpperCase() || null,
    companyName: companyName || null,
    epsEstimate: epsEstimate || null,
    epsPrevious: epsPrevious || null,
    revenueEstimate: revenueEstimate || null,
    revenuePrevious: revenuePrevious || null,
    // Economic fields
    economicName: economicName || null,
    economicConsensus: economicConsensus || null,
    economicPrevious: economicPrevious || null,
    economicUnit: economicUnit || '',
    notes: notes || '',
    // AI output
    analysis: null,
    // Result tracking
    actualEps: null,
    actualRevenue: null,
    actualEconomic: null,
    resultOutcome: null, // 'correct' | 'incorrect' | 'partial'
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

// ── ANALYZE EVENT (calls Claude with web search) ──
app.post('/api/events/:id/analyze', async (req, res) => {
  const data = loadData();
  const event = data.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Claude key not set in .env' });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let prompt;

  if (event.type === 'earnings') {
    prompt = `You are an expert equity analyst and intraday CFD trader. Today is ${today}.
You understand a critical distinction: the ANALYST CONSENSUS is the publicly published EPS estimate.
The MARKET CONSENSUS is what the stock price actually implies — it is DIFFERENT and often HIGHER or LOWER than the analyst number.
Stock moves are driven by the gap between MARKET CONSENSUS and ACTUAL RESULTS, not analyst estimates.

Company: ${event.ticker} (${event.companyName || event.ticker})
Upcoming Earnings Date: ${event.eventDate} ${event.eventTime}
EPS Analyst Consensus: ${event.epsEstimate ? '$' + event.epsEstimate : 'Not provided'}
EPS Previous: ${event.epsPrevious ? '$' + event.epsPrevious : 'Not provided'}
Revenue Analyst Consensus: ${event.revenueEstimate ? '$' + event.revenueEstimate + 'B' : 'Not provided'}
Revenue Previous: ${event.revenuePrevious ? '$' + event.revenuePrevious + 'B' : 'Not provided'}
Additional Notes: ${event.notes || 'None'}

Use web search to gather these 4 proxy signals:
1. Analyst revision trend (upgrades/downgrades in past 30 days)
2. Stock price drift leading up to earnings (bullish/bearish setup)
3. Options implied volatility and put/call ratio
4. Short interest changes

Return ONLY this JSON (no markdown, no code fences):
{
  "analystConsensus": { "eps": "<analyst EPS>", "revenue": "<analyst revenue>" },
  "marketConsensusEstimate": {
    "eps": "<what market is pricing in for EPS>",
    "revenue": "<what market is pricing in for revenue>",
    "direction": "ABOVE_ANALYST or BELOW_ANALYST or IN_LINE",
    "rationale": "<2-3 sentences explaining the proxy signals>"
  },
  "proxySignals": {
    "analystRevisions": "<what revisions show>",
    "stockDrift": "<recent price action>",
    "optionsSentiment": "<IV and put/call findings>",
    "shortInterest": "<short interest trend>"
  },
  "myForecast": {
    "eps": "<your EPS forecast>",
    "revenue": "<your revenue forecast>",
    "rationale": "<2-3 sentences>"
  },
  "expectedMove": {
    "percent": "<e.g. ±5.2%>",
    "direction": "UP or DOWN or NEUTRAL",
    "rationale": "<1-2 sentences>"
  },
  "trade": {
    "direction": "BUY or SHORT or NO_TRADE",
    "asset": "<e.g. AAPL CFD>",
    "entry": "<current price or level>",
    "tp": "<take profit price>",
    "sl": "<stop loss price>",
    "rationale": "<1-2 sentences>"
  },
  "confidenceScore": <0-100>,
  "keyRisks": ["<risk 1>", "<risk 2>", "<risk 3>"]
}`;
  } else {
    prompt = `You are an expert macro economist and intraday CFD trader. Today is ${today}.

Upcoming Economic Event: ${event.economicName}
Release Date/Time: ${event.eventDate} ${event.eventTime} ET
Analyst Consensus: ${event.economicConsensus}${event.economicUnit}
Previous Release: ${event.economicPrevious}${event.economicUnit}
Additional Notes: ${event.notes || 'None'}

Use web search to find recent data, leading indicators, related releases, and analyst commentary to form your OWN independent forecast. Also determine what the market appears to be pricing in vs the published consensus.

Return ONLY this JSON (no markdown, no code fences):
{
  "forecast": "<your predicted value with unit>",
  "forecastRationale": "<2-3 sentences explaining your reasoning>",
  "marketPricedIn": "<what the market actually expects, may differ from consensus>",
  "marketPricedRationale": "<2-3 sentences on how you determined what market is pricing>",
  "beatMissScenario": {
    "beat": "<asset reaction and direction if result beats consensus>",
    "miss": "<asset reaction and direction if result misses consensus>"
  },
  "trade": {
    "direction": "BUY or SHORT",
    "asset": "<CFD asset e.g. EUR/USD, US30, Gold>",
    "entry": "<price level>",
    "tp": "<take profit>",
    "sl": "<stop loss>",
    "rationale": "<1-2 sentences>"
  },
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

    if (!r.ok) {
      const e = await r.json();
      throw new Error(e.error?.message || `Claude error ${r.status}`);
    }

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
  event.resultOutcome = resultOutcome; // 'correct' | 'incorrect' | 'partial'
  event.resultNotes = resultNotes || null;
  event.status = 'resulted';
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

  const byType = { earnings: { total: 0, correct: 0, incorrect: 0, partial: 0 }, economic: { total: 0, correct: 0, incorrect: 0, partial: 0 } };
  resulted.forEach(e => {
    const t = e.type;
    if (byType[t]) {
      byType[t].total++;
      if (e.resultOutcome) byType[t][e.resultOutcome]++;
    }
  });

  res.json({
    total, correct, partial, incorrect,
    winRate: total > 0 ? Math.round((correct / total) * 100) : 0,
    partialRate: total > 0 ? Math.round((partial / total) * 100) : 0,
    byType
  });
});

app.listen(PORT, () => {
  console.log(`\n✦ Project Sparkles running at http://localhost:${PORT}`);
  console.log(`  Claude key: ${CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' ? '✓ set' : '✗ missing — edit .env'}\n`);
});
