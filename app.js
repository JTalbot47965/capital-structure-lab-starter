/*
 * app.js: reads the CSV files in data/, hands the numbers to capstruct.js,
 * draws the tables, and wires up the two sliders and the buttons. It makes no
 * requests except for the data files, which live in this same site.
 */
(function () {
  'use strict';

  var C = window.CapStruct;

  var FILES = {
    assumptions: 'data/assumptions.csv',
    cdss: 'data/cdss.csv',
    exampleFirms: 'data/example_firms.csv',
    scenarios: 'data/ebit_scenarios.csv',
    schedule: 'data/banker_schedule.csv'
  };

  function fetchCsv(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) throw new Error('Could not read ' + path + ' (' + response.status + ')');
      return response.text();
    }).then(C.parseCsv);
  }

  function loadData() {
    var names = Object.keys(FILES);
    return Promise.all(names.map(function (name) { return fetchCsv(FILES[name]); }))
      .then(function (results) {
        var raw = {};
        names.forEach(function (name, i) { raw[name] = results[i]; });
        return {
          taxRate: C.loadTaxRate(raw.assumptions),
          cdss: C.loadCdss(raw.cdss),
          example: C.loadExampleFirms(raw.exampleFirms),
          scenarios: C.loadScenarios(raw.scenarios),
          schedule: C.loadSchedule(raw.schedule)
        };
      });
  }

  /* ---------- Small HTML helpers ---------- */

  function esc(text) {
    return String(text).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  // One row of a firm table: a label, then one cell per scenario.
  function labelRow(label, cells, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label + '</th>' +
      cells.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
  }

  /* ---------- Firm U and Firm L (question c) ---------- */

  function firmTable(title, stats, taxRate) {
    var cols = stats.columns;
    var head = '<tr><th scope="col">' + esc(title) + '</th>' + cols.map(function (c, i) {
      return '<th scope="col">Scenario ' + (i + 1) + '</th>';
    }).join('') + '</tr>';

    var body = [
      labelRow('Assets', cols.map(function () { return C.dollars(stats.totalAssets); })),
      labelRow('Equity', cols.map(function () { return C.dollars(stats.equity); })),
      labelRow('Probability', cols.map(function (c) { return C.plain(c.probability, 2); })),
      labelRow('Sales', cols.map(function (c) { return C.dollars(c.sales); }), 'group-start'),
      labelRow('Oper. costs', cols.map(function (c) { return C.dollarsParen(c.operatingCosts); })),
      labelRow('EBIT', cols.map(function (c) { return C.dollars(c.ebit); }), 'highlight'),
      labelRow('Interest', cols.map(function (c) { return C.dollarsParen(c.interest); })),
      labelRow('EBT', cols.map(function (c) { return C.dollars(c.ebt); })),
      labelRow('Taxes (' + C.percent(taxRate).replace(/\.00%$/, '%') + ')',
        cols.map(function (c) { return C.dollarsParen(c.taxes); })),
      labelRow('Net income', cols.map(function (c) { return C.dollars(c.netIncome); }), 'highlight'),
      labelRow('ROE', cols.map(function (c) { return C.percent(c.roe); }), 'group-start'),
      labelRow('TIE', cols.map(function (c) { return C.multiple(c.tie); }))
    ].join('');

    return '<table class="firm-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
  }

  // Firm U and Firm L side by side: ROE and TIE in each kind of year, then the
  // expected values and the risk measures.
  function firmCompareTable(u, l) {
    function row(label, fu, fl, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label +
        '</th><td>' + esc(fu) + '</td><td>' + esc(fl) + '</td></tr>';
    }
    var rows = '';
    u.columns.forEach(function (c, i) {
      rows += row('ROE, scenario ' + (i + 1) + ' (prob. ' + C.plain(c.probability, 2) + ')',
        C.percent(c.roe), C.percent(l.columns[i].roe), i === 0 ? '' : '');
    });
    u.columns.forEach(function (c, i) {
      rows += row('TIE, scenario ' + (i + 1), C.multiple(c.tie), C.multiple(l.columns[i].tie),
        i === 0 ? 'group-start' : '');
    });
    rows += row('E(ROE)', C.percent(u.expectedRoe), C.percent(l.expectedRoe), 'group-start highlight');
    rows += row('&sigma;(ROE)', C.percent(u.sdRoe), C.percent(l.sdRoe));
    rows += row('CV of ROE', C.multiple(u.cvRoe), C.multiple(l.cvRoe));
    rows += row('E(TIE)', C.multiple(u.expectedTie), C.multiple(l.expectedTie), 'group-start');
    rows += row('&sigma;(TIE)', C.multiple(u.sdTie), C.multiple(l.sdTie));
    return '<table class="summary-table"><thead><tr><th scope="col">Firm U next to Firm L</th>' +
      '<th scope="col">Firm U</th><th scope="col">Firm L</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderFirmsShell(data) {
    var ex = data.example;
    return '<section id="firms">' +
      '<h2>Firm U and Firm L (question c)</h2>' +
      '<p>Two imaginary firms with the same ' + C.dollars(ex.totalAssets) + ' of assets and the same ' +
      'chance of each EBIT outcome. Firm U has no debt. Firm L&rsquo;s debt is up to you; the case uses ' +
      C.dollars(ex.firmLDebt) + '.</p>' +
      '<div class="control">' +
        '<label for="firm-slider">Firm L&rsquo;s debt: <output id="firm-debt-out" for="firm-slider"></output></label>' +
        '<input type="range" id="firm-slider" min="0" max="' + ex.sliderMax + '" step="' + ex.sliderStep +
          '" value="' + ex.firmLDebt + '">' +
        '<div class="range-ends"><span>' + C.dollars(0) + '</span><span>' + C.dollars(ex.sliderMax) + '</span></div>' +
        '<div class="buttons"><button type="button" id="firm-case">Case (' + C.dollars(ex.firmLDebt) + ')</button></div>' +
      '</div>' +
      '<p class="note">The interest rate is held at ' + C.percent(ex.interestRate) + ' at every amount of debt, ' +
      'so this slider shows what debt does to Firm L&rsquo;s return and risk, not how lenders would respond.</p>' +
      '<div id="firm-out" aria-live="polite"></div>' +
      '</section>';
  }

  /* ---------- CDSS ---------- */

  function cdssRowHtml(cells) {
    return '<tr>' + cells.map(function (cell) {
      return '<td data-label="' + esc(cell[0]) + '">' + esc(cell[1]) + '</td>';
    }).join('') + '</tr>';
  }

  function cdssTableHtml(rows, method) {
    var header = ['Debt', 'Shares repurchased', 'Shares remaining', 'EPS', 'TIE', 'Share price', 'WACC'];
    var head = '<thead><tr>' + header.map(function (h) {
      return '<th scope="col">' + h + '</th>';
    }).join('') + '</tr></thead>';
    var body = rows.map(function (r) {
      var m = r[method];
      return cdssRowHtml([
        ['Debt', C.dollars(r.debt)],
        ['Shares repurchased', C.shares(m.repurchased)],
        ['Shares remaining', C.shares(m.remaining)],
        ['EPS', C.price(m.eps)],
        ['TIE', C.multiple(r.tie)],
        ['Share price', C.price(m.price)],
        ['WACC', C.percent(m.wacc)]
      ]);
    }).join('');
    return '<table class="cdss-table cards">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function scheduleTableHtml(rows) {
    var header = ['Debt', 'Cost of debt (r_d)', 'Cost of equity (r_s)', 'Interest', 'Net income'];
    var head = '<thead><tr>' + header.map(function (h) {
      return '<th scope="col">' + esc(h) + '</th>';
    }).join('') + '</tr></thead>';
    var body = rows.map(function (r) {
      return cdssRowHtml([
        ['Debt', C.dollars(r.debt)],
        ['Cost of debt (r_d)', r.costOfDebt === null ? 'n/a' : C.percent(r.costOfDebt)],
        ['Cost of equity (r_s)', C.percent(r.costOfEquity)],
        ['Interest', C.dollars(r.interest)],
        ['Net income', C.dollars(r.netIncome)]
      ]);
    }).join('');
    return '<table class="cdss-table cards">' + head + '<tbody>' + body + '</tbody></table>';
  }

  function atDebt(rows, index) {
    return index < 0 ? 'n/a' : C.dollars(rows[index].debt);
  }

  // Which amount of debt wins under one method. The best-of rules live in capstruct.js.
  function picksHtml(rows, best, method) {
    var isCase = method === 'caseMethod';
    var priceIdx = isCase ? best.casePrice : best.newPrice;
    var epsIdx = isCase ? best.caseEps : best.newEps;
    var waccIdx = isCase ? best.caseWacc : best.newWacc;
    return '<p class="note"><strong>Highest share price:</strong> ' + atDebt(rows, priceIdx) +
      ' of debt. <strong>Highest EPS:</strong> ' + atDebt(rows, epsIdx) +
      ' of debt. <strong>Lowest WACC (' + (isCase ? 'book' : 'market') + ' weights):</strong> ' +
      atDebt(rows, waccIdx) + ' of debt.</p>';
  }

  function agreementHtml(rows, best) {
    if (best.allAgree) {
      return '<p class="ok-line">Both buyback methods and both WACCs point to the same amount of debt: ' +
        atDebt(rows, best.casePrice) + '.</p>';
    }
    return '<p class="warning">The methods do not all agree. Highest price: ' +
      atDebt(rows, best.casePrice) + ' (case method) and ' + atDebt(rows, best.newPrice) +
      ' (new price). Lowest WACC: ' + atDebt(rows, best.caseWacc) + ' (book weights) and ' +
      atDebt(rows, best.newWacc) + ' (market weights).</p>';
  }

  function checksHtml(data, rows) {
    var out = '';
    var base = C.baselineCheck(data.cdss, rows);
    if (!base.ok) out += '<p class="warning"><strong>Check failed.</strong> ' + esc(base.message) + '</p>';
    var badEps = rows.filter(function (r) { return !r.newPrice.epsCheck; });
    if (badEps.length) {
      out += '<p class="warning"><strong>Check failed.</strong> With the new-price buyback, EPS does not ' +
        'equal r_s &times; price at ' + badEps.map(function (r) { return C.dollars(r.debt); }).join(', ') + '.</p>';
    }
    var badWacc = rows.filter(function (r) { return !r.newPrice.waccCheck; });
    if (badWacc.length) {
      out += '<p class="warning"><strong>Check failed.</strong> Market-weight WACC does not equal ' +
        'EBIT &times; (1 &minus; T) / V at ' + badWacc.map(function (r) { return C.dollars(r.debt); }).join(', ') + '.</p>';
    }
    if (!out) {
      out = '<p class="ok-line">Checks passed: EPS / r_s at $0 of debt equals today&rsquo;s price; ' +
        'with the new-price buyback, EPS = r_s &times; price and market-weight WACC = EBIT &times; (1 &minus; T) / V.</p>';
    }
    return out;
  }

  function renderCdss(data, rows, best) {
    var c = data.cdss;
    var ebit = C.cdssEbit(c);
    var last = rows.length - 1;

    return '<section id="cdss">' +
      '<h2>CDSS at each amount of borrowing (questions d(3) to d(7))</h2>' +
      '<p>CDSS borrows, then uses the money to buy back its own shares. EBIT stays at ' + C.dollars(ebit) +
      ' (sales ' + C.dollars(c.sales) + ' &times; (1 &minus; ' + C.percent(c.variableCostRate) +
      ') &minus; fixed costs ' + C.dollars(c.fixedCosts) + '). Tax rate ' + C.percent(data.taxRate) +
      '. Today: ' + C.shares(c.sharesOutstanding) + ' shares at ' + C.price(c.sharePrice) +
      '. All earnings are paid out, so dividends per share = EPS and g = 0.</p>' +

      '<h3>Try an amount of debt</h3>' +
      '<div class="control">' +
        '<label for="cdss-slider">CDSS&rsquo;s debt: <output id="cdss-debt-out" for="cdss-slider"></output></label>' +
        '<input type="range" id="cdss-slider" min="0" max="' + last + '" step="1" value="0" list="cdss-ticks">' +
        '<datalist id="cdss-ticks">' + rows.map(function (r, i) {
          return '<option value="' + i + '"></option>';
        }).join('') + '</datalist>' +
        '<div class="range-ends"><span>' + C.dollars(rows[0].debt) + '</span><span>' +
          C.dollars(rows[last].debt) + '</span></div>' +
        '<p class="note">The slider stops only at the amounts in the banker&rsquo;s schedule.</p>' +
        '<div class="buttons">' +
          '<button type="button" id="cdss-best-price">Best price</button>' +
          '<button type="button" id="cdss-best-eps">Highest EPS</button>' +
        '</div>' +
        '<div id="cdss-note" aria-live="polite"></div>' +
      '</div>' +
      '<div id="cdss-out" aria-live="polite"></div>' +

      '<h3>The banker&rsquo;s schedule</h3>' + scheduleTableHtml(rows) +

      '<h3>1. The case&rsquo;s buyback: shares bought at today&rsquo;s ' + C.price(c.sharePrice) + '</h3>' +
      '<div class="formula">' +
        '<div>Shares repurchased = D / P&#8320;</div>' +
        '<div>Shares remaining = n &minus; shares repurchased</div>' +
        '<div>EPS = net income / shares remaining</div>' +
        '<div>Share price = EPS / r_s</div>' +
        '<div>WACC (book weights) = D/A &times; r_d &times; (1 &minus; T) + (A &minus; D)/A &times; r_s, ' +
        'with A = ' + C.dollars(c.totalAssets) + ' of total book assets</div>' +
      '</div>' +
      cdssTableHtml(rows, 'caseMethod') + picksHtml(rows, best, 'caseMethod') +

      '<h3>2. Buying back at the new price (the price after the announcement)</h3>' +
      '<div class="formula">' +
        '<div>Value of equity S = net income / r_s</div>' +
        '<div>Value of the firm V = S + D</div>' +
        '<div>New price P = V / n</div>' +
        '<div>Shares repurchased = D / P; shares remaining = n &minus; D / P</div>' +
        '<div>EPS = net income / shares remaining</div>' +
        '<div>WACC (market weights) = D/V &times; r_d &times; (1 &minus; T) + S/V &times; r_s</div>' +
      '</div>' +
      cdssTableHtml(rows, 'newPrice') + picksHtml(rows, best, 'newPrice') +

      '<h3>Do the two methods agree?</h3>' + agreementHtml(rows, best) +
      checksHtml(data, rows) +
      '<p class="note">Share counts are not rounded; they show to two decimals. ' +
      'Dollars show to the nearest dollar, prices and EPS to the cent.</p>' +
      '</section>';
  }

  /* ---------- What the CDSS slider shows ---------- */

  function stakeCell(m) {
    var s = m.management;
    if (s.status === 'allBought') {
      return esc(C.percent(s.stake)) + ' <span class="muted">(no outside shareholders left)</span>';
    }
    if (s.status === 'tooMany') {
      return '<span class="bad">Not possible: management would have to sell</span>';
    }
    return esc(C.percent(s.stake));
  }

  function cdssPanelHtml(row, cdss) {
    var a = row.caseMethod;
    var b = row.newPrice;
    function line(label, ca, nb, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label +
        '</th><td>' + ca + '</td><td>' + nb + '</td></tr>';
    }
    var notes = '';
    [['case method', a], ['new-price method', b]].forEach(function (pair) {
      var s = pair[1].management;
      if (s.status === 'allBought') {
        notes += '<p class="note">With the ' + pair[0] + ', the buyback takes every share the outside investors own, ' +
          'so management would own 100% of CDSS.</p>';
      } else if (s.status === 'tooMany') {
        notes += '<p class="warning">With the ' + pair[0] + ', the buyback is bigger than the outside investors&rsquo; ' +
          'shares, so management would have to sell. There is no stake to show.</p>';
      }
    });
    return '<table class="compare-table"><thead><tr><th scope="col">At ' + esc(C.dollars(row.debt)) +
      ' of debt</th><th scope="col">Case: buy back at ' + esc(C.price(cdss.sharePrice)) +
      '</th><th scope="col">New price</th></tr></thead><tbody>' +
      line('Share price', esc(C.price(a.price)), esc(C.price(b.price)), 'highlight') +
      line('Shares repurchased', esc(C.shares(a.repurchased)), esc(C.shares(b.repurchased))) +
      line('Shares remaining', esc(C.shares(a.remaining)), esc(C.shares(b.remaining))) +
      line('EPS', esc(C.price(a.eps)), esc(C.price(b.eps)), 'group-start') +
      line('Dividends per share', esc(C.price(a.dps)), esc(C.price(b.dps))) +
      line('TIE', esc(C.multiple(row.tie)), esc(C.multiple(row.tie))) +
      line('WACC', esc(C.percent(a.wacc)) + ' <span class="muted">book weights</span>',
        esc(C.percent(b.wacc)) + ' <span class="muted">market weights</span>', 'group-start') +
      line('Management&rsquo;s share', stakeCell(a), stakeCell(b)) +
      '</tbody></table>' + notes;
  }

  /* ---------- Start up ---------- */

  function showError(error) {
    var app = document.getElementById('app');
    var onFile = window.location.protocol === 'file:';
    app.innerHTML = '<section><h2>The app could not load its data</h2>' +
      '<p class="warning">' + esc(error.message) + '</p>' +
      (onFile ? '<p>This page was opened straight from a file, and browsers do not let a page read ' +
        'other files that way. Open it from a web address (the published GitHub Pages site, or a ' +
        'local server) instead.</p>' : '') +
      '</section>';
  }

  function start(data) {
    var rows = C.cdssTable(data.cdss, data.taxRate, data.schedule);
    var best = C.cdssBest(rows);
    var ex = data.example;
    var firmU = C.firmStats(data.scenarios, ex.totalAssets, 0, 0, data.taxRate);

    document.getElementById('app').innerHTML = renderFirmsShell(data) + renderCdss(data, rows, best);

    var firmSlider = document.getElementById('firm-slider');
    var cdssSlider = document.getElementById('cdss-slider');
    var cdssNote = document.getElementById('cdss-note');

    // Firm L: redraw the two firm tables and the comparison for the slider's debt.
    function updateFirms() {
      var debt = Number(firmSlider.value);
      var firmL = C.firmStats(data.scenarios, ex.totalAssets, debt, ex.interestRate, data.taxRate);
      document.getElementById('firm-debt-out').textContent = C.dollars(debt);
      var lead = debt === 0 ? ' With no debt, Firm L is the same as Firm U.' : '';
      document.getElementById('firm-out').innerHTML =
        '<h3>Firm U (no debt)</h3>' + firmTable('Firm U', firmU, data.taxRate) +
        '<h3>Firm L (' + esc(C.dollars(debt)) + ' of debt at ' + esc(C.percent(ex.interestRate)) + ')</h3>' +
        firmTable('Firm L', firmL, data.taxRate) +
        '<h3>Expected return and risk</h3>' + firmCompareTable(firmU, firmL) +
        '<p class="note">ROE = net income / book equity (assets &minus; debt). TIE = EBIT / interest. ' +
        'Firm U pays no interest, so its TIE, E(TIE) and &sigma;(TIE) show n/a. (The case&rsquo;s table prints 0x for ' +
        'Firm U&rsquo;s &sigma;(TIE); there is no TIE to measure.)' + lead + '</p>';
    }

    // CDSS: redraw the comparison panel for the schedule row the slider is on.
    function updateCdss() {
      var row = rows[Number(cdssSlider.value)];
      document.getElementById('cdss-debt-out').textContent = C.dollars(row.debt);
      document.getElementById('cdss-out').innerHTML = cdssPanelHtml(row, data.cdss);
    }

    function goTo(kind) {
      var target = C.buttonTarget(rows, kind);
      if (target.index < 0) return;
      cdssSlider.value = String(target.index);
      updateCdss();
      cdssNote.innerHTML = target.note ? '<p class="warning">' + esc(target.note) + '</p>' : '';
    }

    firmSlider.addEventListener('input', updateFirms);
    document.getElementById('firm-case').addEventListener('click', function () {
      firmSlider.value = String(ex.firmLDebt);
      updateFirms();
    });
    cdssSlider.addEventListener('input', function () {
      cdssNote.innerHTML = '';
      updateCdss();
    });
    document.getElementById('cdss-best-price').addEventListener('click', function () { goTo('price'); });
    document.getElementById('cdss-best-eps').addEventListener('click', function () { goTo('eps'); });

    // Start the CDSS slider at today's debt (the schedule row that matches cdss.csv).
    var startIndex = 0;
    rows.forEach(function (r, i) { if (r.debt === data.cdss.debt) startIndex = i; });
    cdssSlider.value = String(startIndex);

    updateFirms();
    updateCdss();
  }

  // Register the service worker (sw.js) so the app works offline. A failure here
  // (for example when the page is opened from a file) just means no offline mode.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  loadData().then(start).catch(showError);
})();
