/*
 * app.js: reads the CSV files in data/, hands the numbers to capstruct.js,
 * and draws the tables. It makes no requests except for those files, which
 * live in this same site.
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

  function firmSummaryTable(u, l) {
    function row(label, fu, fl) {
      return '<tr><th scope="row">' + label + '</th><td>' + esc(fu) + '</td><td>' + esc(fl) + '</td></tr>';
    }
    return '<table class="summary-table"><thead><tr><th scope="col">Across the scenarios</th>' +
      '<th scope="col">Firm U</th><th scope="col">Firm L</th></tr></thead><tbody>' +
      row('E(ROE)', C.percent(u.expectedRoe), C.percent(l.expectedRoe)) +
      row('&sigma;(ROE)', C.percent(u.sdRoe), C.percent(l.sdRoe)) +
      row('CV of ROE', C.multiple(u.cvRoe), C.multiple(l.cvRoe)) +
      row('E(TIE)', C.multiple(u.expectedTie), C.multiple(l.expectedTie)) +
      row('&sigma;(TIE)', C.multiple(u.sdTie), C.multiple(l.sdTie)) +
      '</tbody></table>';
  }

  function renderFirms(data) {
    var ex = data.example;
    var u = C.firmStats(data.scenarios, ex.totalAssets, 0, 0, data.taxRate);
    var l = C.firmStats(data.scenarios, ex.totalAssets, ex.firmLDebt, ex.interestRate, data.taxRate);
    return '<section id="firms">' +
      '<h2>Firm U and Firm L (question c)</h2>' +
      '<p>Two imaginary firms with the same ' + C.dollars(ex.totalAssets) + ' of assets and the same ' +
      'chance of each EBIT outcome. Firm U has no debt. Firm L has ' + C.dollars(ex.firmLDebt) +
      ' of debt at ' + C.percent(ex.interestRate) + '.</p>' +
      '<h3>Firm U (no debt)</h3>' + firmTable('Firm U', u, data.taxRate) +
      '<h3>Firm L (' + C.dollars(ex.firmLDebt) + ' of debt at ' + C.percent(ex.interestRate) + ')</h3>' +
      firmTable('Firm L', l, data.taxRate) +
      '<h3>Expected return and risk</h3>' + firmSummaryTable(u, l) +
      '<p class="note">ROE = net income / book equity. TIE = EBIT / interest. Firm U pays no interest, so ' +
      'its TIE, E(TIE) and &sigma;(TIE) show n/a. (The case&rsquo;s table prints 0x for Firm U&rsquo;s ' +
      '&sigma;(TIE); there is no TIE to measure.)</p>' +
      '</section>';
  }

  /* ---------- CDSS ---------- */

  function cdssRowHtml(r, cells) {
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
      return cdssRowHtml(r, [
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
      return cdssRowHtml(r, [
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

  function renderCdss(data) {
    var c = data.cdss;
    var rows = C.cdssTable(c, data.taxRate, data.schedule);
    var best = C.cdssBest(rows);
    var ebit = C.cdssEbit(c);

    return '<section id="cdss">' +
      '<h2>CDSS at each amount of borrowing (questions d(3) to d(7))</h2>' +
      '<p>CDSS borrows, then uses the money to buy back its own shares. EBIT stays at ' + C.dollars(ebit) +
      ' (sales ' + C.dollars(c.sales) + ' &times; (1 &minus; ' + C.percent(c.variableCostRate) +
      ') &minus; fixed costs ' + C.dollars(c.fixedCosts) + '). Tax rate ' + C.percent(data.taxRate) +
      '. Today: ' + C.shares(c.sharesOutstanding) + ' shares at ' + C.price(c.sharePrice) +
      '. All earnings are paid out, so dividends per share = EPS and g = 0.</p>' +

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

  loadData().then(function (data) {
    document.getElementById('app').innerHTML = renderFirms(data) + renderCdss(data);
  }).catch(showError);
})();
