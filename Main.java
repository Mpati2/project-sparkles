public class Main {

    }
    // Example list of events (you can later save these to a database)
let manualEvents = [
  { asset: 'AAPL', type: 'Earnings', consensus: '1.40', previous: '1.20', sentiment: 'Bullish' },
  { asset: 'USD/JPY', type: 'Economic (NFP)', consensus: '200k', previous: '180k', sentiment: 'Neutral' }
];

async function

    loadDashboard() {
  const container = document.getElementById('events-container');
  container.innerHTML = 'Loading AI Forecasts...';

  // AUTOMATIC TRIGGER: Map through events and call the AI for each immediately
  const analyses = await Promise.all(manualEvents.map(async (event) => {
    const res =

    await fetch('/api/analyze-manual-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });
    const aiData = await res.json();
    return { ...event, ...aiData };
  }));

  renderCards(analyses);
}

function renderCards(data) {
  const container = document.getElementById('events-container');
  container.innerHTML = data.map(item => `
    <div class="card">
      <h3>${item.asset} - ${item.type}</h3>
      <p><b>AI Forecast:</b> ${item.forecast}</p>
      <p><b>Priced In:</b> ${item.pricedIn}</p>
      <div class="trade-box">
        <b>Trade:</b> ${item.trade.direction} @ ${item.trade.entry}<br>
        TP: ${item.trade.tp} | SL: ${item.trade.sl}
      </div>
    </div>
  `).join('');
}

// Trigger as soon as the page loads
window.onload = loadDashboard;