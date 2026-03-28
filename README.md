# ✨ Project Sparkles: Quant AI Terminal

A full-stack application that leverages LLM orchestration to identify market mispricing by analyzing real-time financial data against analyst consensus.

## 🛠 Tech Stack
- **Backend:** Node.js, Express
- **Frontend:** HTML5, CSS3 (Terminal UI), JavaScript (ES6+)
- **AI Engine:** Claude 3.5 Sonnet API
- **Data Ingestion:** Alpha Vantage & Finnhub REST APIs

## 🏗 Architecture
Project Sparkles uses a dual-layer approach:
1. **Inference Layer:** Uses AI to generate independent forecasts for economic events (CPI, NFP) and corporate earnings.
2. **Execution Layer:** Maps forecasts to structured trade signals including Direction, Entry, Take-Profit, and Stop-Loss.

## 🚀 Setup
1. Clone the repo: `git clone https://github.com/YOUR_USERNAME/project-sparkles.git`
2. Install dependencies: `npm install`
3. Create a `.env` file with your `CLAUDE_KEY` and `FINNHUB_KEY`.
4. Start the server: `node server.js`