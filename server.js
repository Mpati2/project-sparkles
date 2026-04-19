require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const PORT = process.env.PORT || 3000;

// ── DATABASE ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT,
      event_date TEXT,
      event_time TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      ticker TEXT,
      company_name TEXT,
      eps_estimate TEXT,
      eps_previous TEXT,
      revenue_estimate TEXT,
      revenue_previous TEXT,
      economic_name TEXT,
      economic_consensus TEXT,
      economic_previous TEXT,
      economic_unit TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      analysis JSONB,
      actual_eps TEXT,
      actual_revenue TEXT,
      actual_economic TEXT,
      result_outcome TEXT,
      result_notes TEXT,
      resulted_at TEXT,
      analyzed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      asset TEXT,
      direction TEXT,
      entry_price TEXT,
      exit_price TEXT,
      pnl NUMERIC,
      trade_date TEXT,
      trade_time TEXT,
      linked_event_id TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS portfolio (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT INTO portfolio (key, value) VALUES ('starting_balance', '10000') ON CONFLICT DO NOTHING;
  `);
  console.log('Database ready');
}

// ── HEALTH CHECK ──
app.get('/api/status', (req, res) => {
  res.json({ claude: !!CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' });
});

// ── GET ALL EVENTS ──
app.get('/api/events', async (req, res) => {
  const { type } = req.query;
  try {
    const query = type
      ? 'SELECT * FROM events WHERE type = $1 ORDER BY event_date ASC'
      : 'SELECT * FROM events ORDER BY event_date ASC';
    const params = type ? [type] : [];
    const result = await pool.query(query, params);
    const events = result.rows.map(dbToEvent);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function dbToEvent(row) {
  return {
    id: row.id,
    type: row.type,
    eventDate: row.event_date,
    eventTime: row.event_time,
    status: row.status,
    createdAt: row.created_at,
    ticker: row.ticker,
    companyName: row.company_name,
    epsEstimate: row.eps_estimate,
    epsPrevious: row.eps_previous,
    revenueEstimate: row.revenue_estimate,
    revenuePrevious: row.revenue_previous,
    economicName: row.economic_name,
    economicConsensus: row.economic_consensus,
    economicPrevious: row.economic_previous,
    economicUnit: row.economic_unit || '',
    notes: row.notes || '',
    analysis: row.analysis,
    actualEps: row.actual_eps,
    actualRevenue: row.actual_revenue,
    actualEconomic: row.actual_economic,
    resultOutcome: row.result_outcome,
    resultNotes: row.result_notes,
    resultedAt: row.resulted_at,
    analyzedAt: row.analyzed_at,
  };
}

// ── ADD EVENT ──
app.post('/api/events', async (req, res) => {
  const { type, ticker, companyName, eventDate, eventTime,
          epsEstimate, epsPrevious, revenueEstimate, revenuePrevious,
          economicName, economicConsensus, economicPrevious, economicUnit, notes } = req.body;

  if (!type || !eventDate) return res.status(400).json({ error: 'type and eventDate required' });

  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();

  try {
    await pool.query(`
      INSERT INTO events (id, type, event_date, event_time, status, created_at,
        ticker, company_name, eps_estimate, eps_previous, revenue_estimate, revenue_previous,
        economic_name, economic_consensus, economic_previous, economic_unit, notes)
      VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    `, [id, type, eventDate, eventTime || '08:30', now,
        ticker?.toUpperCase() || null, companyName || null,
        epsEstimate || null, epsPrevious || null, revenueEstimate || null, revenuePrevious || null,
        economicName || null, economicConsensus || null, economicPrevious || null,
        economicUnit || '', notes || '']);

    const result = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    res.json({ event: dbToEvent(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE EVENT ──
app.delete('/api/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ANALYZE EVENT ──
app.post('/api/events/:id/analyze', async (req, res) => {
  const result = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Claude key not set' });

  const event = dbToEvent(result.rows[0]);
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

    const analysis = JSON.parse(match[0]);
    const now = new Date().toISOString();

    await pool.query(
      'UPDATE events SET analysis = $1, status = $2, analyzed_at = $3 WHERE id = $4',
      [JSON.stringify(analysis), 'analyzed', now, event.id]
    );

    const updated = await pool.query('SELECT * FROM events WHERE id = $1', [event.id]);
    res.json({ event: dbToEvent(updated.rows[0]) });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── RECORD RESULT ──
app.post('/api/events/:id/result', async (req, res) => {
  const { actualEps, actualRevenue, actualEconomic, resultOutcome, resultNotes } = req.body;
  try {
    const status = resultOutcome ? 'resulted' : 'analyzed';
    await pool.query(
      'UPDATE events SET actual_eps=$1, actual_revenue=$2, actual_economic=$3, result_outcome=$4, result_notes=$5, status=$6, resulted_at=$7 WHERE id=$8',
      [actualEps || null, actualRevenue || null, actualEconomic || null,
       resultOutcome || null, resultNotes || null, status, new Date().toISOString(), req.params.id]
    );
    const updated = await pool.query('SELECT * FROM events WHERE id = $1', [req.params.id]);
    res.json({ event: dbToEvent(updated.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STATS ──
app.get('/api/stats', async (req, res) => {
  try {
    const r = await pool.query("SELECT result_outcome, COUNT(*) FROM events WHERE status='resulted' GROUP BY result_outcome");
    let correct = 0, partial = 0, incorrect = 0;
    r.rows.forEach(row => {
      if (row.result_outcome === 'correct') correct = parseInt(row.count);
      if (row.result_outcome === 'partial') partial = parseInt(row.count);
      if (row.result_outcome === 'incorrect') incorrect = parseInt(row.count);
    });
    const total = correct + partial + incorrect;
    res.json({ total, correct, partial, incorrect, winRate: total > 0 ? Math.round((correct / total) * 100) : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORTFOLIO: GET ──
app.get('/api/portfolio', async (req, res) => {
  try {
    const balRow = await pool.query("SELECT value FROM portfolio WHERE key='starting_balance'");
    const startingBalance = parseFloat(balRow.rows[0]?.value || 10000);
    const trades = await pool.query('SELECT * FROM trades ORDER BY trade_date ASC, trade_time ASC');
    res.json({ startingBalance, trades: trades.rows.map(dbToTrade) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function dbToTrade(row) {
  return {
    id: row.id, asset: row.asset, direction: row.direction,
    entryPrice: row.entry_price, exitPrice: row.exit_price,
    pnl: parseFloat(row.pnl), tradeDate: row.trade_date, tradeTime: row.trade_time,
    linkedEventId: row.linked_event_id, notes: row.notes, createdAt: row.created_at,
  };
}

// ── PORTFOLIO: ADD TRADE ──
app.post('/api/portfolio/trades', async (req, res) => {
  const { asset, direction, entryPrice, exitPrice, pnl, tradeDate, tradeTime, linkedEventId, notes } = req.body;
  if (!asset || pnl === undefined) return res.status(400).json({ error: 'asset and pnl required' });

  const id = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
  try {
    await pool.query(
      'INSERT INTO trades (id, asset, direction, entry_price, exit_price, pnl, trade_date, trade_time, linked_event_id, notes, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, asset, direction || 'BUY', entryPrice || null, exitPrice || null,
       parseFloat(pnl), tradeDate || new Date().toISOString().split('T')[0],
       tradeTime || '12:00', linkedEventId || null, notes || '', new Date().toISOString()]
    );
    const result = await pool.query('SELECT * FROM trades WHERE id = $1', [id]);
    res.json({ trade: dbToTrade(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORTFOLIO: DELETE TRADE ──
app.delete('/api/portfolio/trades/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM trades WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PORTFOLIO: UPDATE BALANCE ──
app.post('/api/portfolio/balance', async (req, res) => {
  const { startingBalance } = req.body;
  try {
    await pool.query("INSERT INTO portfolio (key, value) VALUES ('starting_balance', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [String(startingBalance)]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── S&P 500 ──
app.get('/api/sp500', async (req, res) => {
  const { interval } = req.query;
  const validIntervals = { '5m': { interval: '5m', range: '1d' }, '1h': { interval: '1h', range: '5d' }, '1d': { interval: '1d', range: '1mo' }, '1wk': { interval: '1wk', range: '1y' } };
  const params = validIntervals[interval] || validIntervals['1d'];
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=${params.interval}&range=${params.range}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
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
    res.status(500).json({ error: err.message });
  }
});

// ── CHAT ──
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'Claude key not set' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, system: systemPrompt || 'You are a helpful financial analyst.', messages })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'Claude error'); }
    const data = await r.json();
    const reply = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── START ──
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✦ Project Sparkles running at http://localhost:${PORT}`);
    console.log(`  Claude key: ${CLAUDE_KEY && CLAUDE_KEY !== 'your_anthropic_key_here' ? '✓ set' : '✗ missing'}`);
    console.log(`  Database: PostgreSQL\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
