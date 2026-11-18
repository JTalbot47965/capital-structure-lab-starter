// app.js: reads the CSV files in data/, runs the math in capstruct.js and fills in the page.
// All of it happens in the browser. Nothing is sent to another website.

(function () {
  'use strict';

  const C = window.CapStruct;

  // Build a DOM element. Text is always set with textContent, never as HTML.
  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'text') node.textContent = v;
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    });
    (children || []).forEach((ch) => node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch));
    return node;
  }

  async function loadCsv(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Could not load ' + path + ' (' + res.status + ')');
    return C.parseCsv(await res.text());
  }

  // ---------- Firm U / Firm L table ----------

  function firmTable(title, stmt) {
    const cols = stmt.columns;
    const head = el('tr', {}, [el('th', { text: '' })].concat(
      cols.map((c) => el('th', { text: 'p = ' + C.formatNumber(c.probability, 2) }))
    ));

    const row = (label, fn, cls) =>
      el('tr', cls ? { class: cls } : {}, [el('th', { scope: 'row', text: label })].concat(
        cols.map((c, i) => {
          const text = fn(c, i);
          return el('td', { text, class: text === 'n/a' ? 'na' : '' });
        })
      ));

    const table = el('table', {}, [
      el('caption', { text: title }),
      el('thead', {}, [head]),
      el('tbody', {}, [
        row('Assets', () => C.formatDollars(stmt.assets)),
        row('Equity', () => C.formatDollars(stmt.equity)),
        row('Sales', (c) => C.formatDollars(c.sales), 'rule'),
        row('Oper. costs', (c) => C.formatParens(c.operatingCosts)),
        row('EBIT', (c) => C.formatDollars(c.ebit)),
        row('Interest', (c) => C.formatParens(c.interest)),
        row('EBT', (c) => C.formatDollars(c.ebt)),
        row('Taxes', (c) => C.formatParens(c.taxes)),
        row('Net income', (c) => C.formatDollars(c.netIncome)),
        row('ROE', (c) => C.formatPercent(c.roe, 1), 'rule'),
        row('TIE', (c) => C.formatMultiple(c.tie)),
      ]),
    ]);

    const stat = (label, text) =>
      el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { text, class: text === 'n/a' ? 'na' : '' })]);

    const summary = el('table', { class: 'summary' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Across all years' }), el('th', { text: title.split(' (')[0] })])]),
      el('tbody', {}, [
        stat('E(ROE)', C.formatPercent(stmt.expectedRoe, 1)),
        stat('σ(ROE)', C.formatPercent(stmt.sdRoe, 1)),
        stat('CV of ROE', C.formatNumber(stmt.cvRoe, 2)),
        stat('E(TIE)', C.formatMultiple(stmt.expectedTie)),
        stat('σ(TIE)', C.formatMultiple(stmt.sdTie)),
      ]),
    ]);

    return el('div', {}, [table, summary]);
  }

  function renderFirms(inputs) {
    const ex = inputs.example;
    const base = { assets: ex.totalAssets, interestRate: ex.interestRate, taxRate: inputs.taxRate };
    const u = C.firmStatement(inputs.scenarios, Object.assign({ debt: 0 }, base));
    const l = C.firmStatement(inputs.scenarios, Object.assign({ debt: ex.firmLDebt }, base));

    const uBox = document.getElementById('firm-u');
    const lBox = document.getElementById('firm-l');
    uBox.replaceChildren(firmTable('Firm U (no debt)', u));
    lBox.replaceChildren(firmTable('Firm L (' + C.formatDollars(ex.firmLDebt) + ' of debt at ' + C.formatPercent(ex.interestRate, 0) + ')', l));

    const note = [
      'Firm U has no interest, so its TIE, E(TIE) and σ(TIE) are n/a. The case prints 0x for Firm U\'s σ(TIE).',
    ];
    if (Math.abs(u.probabilityTotal - 1) > 1e-9) {
      note.push('Warning: the probabilities in ebit_scenarios.csv add up to ' + C.formatNumber(u.probabilityTotal, 4) + ', not 1.');
    }
    document.getElementById('firm-note').textContent = note.join(' ');
  }

  // ---------- CDSS tables ----------

  function cdssTable(analysis, method) {
    const isCase = method === 'case';
    const best = analysis.winners;
    const priceWinner = isCase ? best.casePrice : best.newPrice;
    const waccWinner = isCase ? best.bookWacc : best.marketWacc;
    const waccLabel = isCase ? 'WACC (book weights)' : 'WACC (market weights)';

    const cols = [
      ['Debt', null],
      ['r_d', (r) => (r.costOfDebt === null ? 'n/a' : C.formatPercent(r.costOfDebt, 2))],
      ['r_s', (r) => C.formatPercent(r.costOfEquity, 2)],
      ['Shares repurchased', (r) => C.formatShares(r[method].repurchased)],
      ['Shares remaining', (r) => C.formatShares(r[method].remaining)],
      ['EPS', (r) => C.formatCents(r[method].eps)],
      ['TIE', (r) => C.formatMultiple(r.tie)],
      ['Share price', (r) => C.formatCents(r[method].price), 'price'],
      [waccLabel, (r) => C.formatPercent(r[method].wacc, 2), 'wacc'],
    ];

    const thead = el('thead', {}, [el('tr', {}, cols.map((c) => el('th', { text: c[0] })))]);
    const tbody = el('tbody', {}, analysis.rows.map((r, i) => {
      const cells = cols.slice(1).map((c) => {
        const text = c[1](r, i);
        let cls = text === 'n/a' ? 'na' : '';
        if (c[2] === 'price' && i === priceWinner) cls += ' best';
        if (c[2] === 'wacc' && i === waccWinner) cls += ' best';
        return el('td', { 'data-label': c[0], class: cls.trim(), text });
      });
      return el('tr', {}, [el('th', { scope: 'row', text: C.formatDollars(r.debt) + ' borrowed' })].concat(cells));
    }));

    return el('table', { class: 'stack' }, [thead, tbody]);
  }

  function renderCdss(inputs) {
    const c = inputs.cdss;
    const analysis = C.cdssAnalysis(inputs);

    const facts = [
      ['EBIT', C.formatDollars(c.ebit)],
      ['Tax rate', C.formatPercent(c.taxRate, 0)],
      ['Shares outstanding', C.formatShares(c.shares)],
      ['Share price today', C.formatCents(c.price)],
    ];
    document.getElementById('cdss-facts').replaceChildren(
      ...facts.map((f) => el('div', {}, [el('dt', { text: f[0] }), el('dd', { text: f[1] })]))
    );

    document.getElementById('cdss-warnings').replaceChildren(
      ...analysis.warnings.map((w) => el('p', { class: 'banner warn', text: w }))
    );

    document.getElementById('table-case').replaceChildren(cdssTable(analysis, 'case'));
    document.getElementById('table-new').replaceChildren(cdssTable(analysis, 'newPrice'));

    const w = analysis.winners;
    const rows = analysis.rows;
    const at = (i) => C.formatDollars(rows[i].debt);
    const items = [
      'Highest share price, case method: ' + C.formatCents(rows[w.casePrice].case.price) + ' at ' + at(w.casePrice) + ' of debt.',
      'Highest share price, new-price method: ' + C.formatCents(rows[w.newPrice].newPrice.price) + ' at ' + at(w.newPrice) + ' of debt.',
      'Lowest WACC, book weights: ' + C.formatPercent(rows[w.bookWacc].case.wacc, 2) + ' at ' + at(w.bookWacc) + ' of debt.',
      'Lowest WACC, market weights: ' + C.formatPercent(rows[w.marketWacc].newPrice.wacc, 2) + ' at ' + at(w.marketWacc) + ' of debt.',
    ];
    const summary = document.getElementById('cdss-summary');
    summary.replaceChildren(
      el('ul', { class: 'summary-list' }, items.map((t) => el('li', { text: t }))),
      el('p', {
        class: 'note',
        text: analysis.allAgree
          ? 'All four point to the same amount of debt.'
          : 'These do not all point to the same amount of debt.',
      })
    );
  }

  // ---------- Start ----------

  async function start() {
    const status = document.getElementById('status');
    try {
      const [cdss, assumptions, schedule, example, scenarios] = await Promise.all([
        loadCsv('data/cdss.csv'),
        loadCsv('data/assumptions.csv'),
        loadCsv('data/banker_schedule.csv'),
        loadCsv('data/example_firms.csv'),
        loadCsv('data/ebit_scenarios.csv'),
      ]);
      const inputs = C.buildInputs({ cdss, assumptions, schedule, example, scenarios });
      renderFirms(inputs);
      renderCdss(inputs);
      document.getElementById('firms').hidden = false;
      document.getElementById('cdss').hidden = false;
      status.hidden = true;
    } catch (err) {
      status.className = 'error';
      status.textContent = 'Something went wrong while reading the data files: ' + err.message;
    }
  }

  start();
})();
