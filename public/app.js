async function analyze() {
    const results = document.getElementById('results');
    const data = {
        type: document.getElementById('type').value,
        asset: document.getElementById('asset').value,
        consensus: document.getElementById('consensus').value,
        previous: document.getElementById('previous').value
    };

    const id = Date.now();
    const newCard = document.createElement('div');
    newCard.id = id;
    newCard.className = 'card';
    newCard.innerHTML = "CLAUDE AI IS ANALYZING...";
    results.prepend(newCard);

    try {
        const res = await fetch('/api/predict-manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const trade = await res.json();
        document.getElementById(id).innerHTML = `
            <strong>${data.asset}</strong> [${data.type}]<br>
            <span style="color:#fff">SIGNAL: ${trade.trade.dir} @ ${trade.trade.entry}</span><br>
            <small>TP: ${trade.trade.tp} | SL: ${trade.trade.sl}</small><br>
            <p style="font-size:0.8em">${trade.mispriced}</p>
        `;
    } catch (e) {
        document.getElementById(id).innerHTML = "SERVER ERROR - CHECK CONSOLE";
    }
}