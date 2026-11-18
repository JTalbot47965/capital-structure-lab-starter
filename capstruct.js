// capstruct.js: the finance math for the AGE capital structure app.
// Plain functions only. Nothing here touches the page or fetches files,
// so every function can be checked with Node.

(function (root) {
  'use strict';

  // ---------- Rounding and formatting ----------

  // Round half up on the decimal value. toFixed rounds the binary value and gets
  // cases like 14.025 and 3.495 wrong, so scale, trim float noise, then round.
  function roundHalfUp(x, d) {
    const f = 10 ** d;
    const sign = x < 0 ? -1 : 1;
    const r = (sign * Math.round(Number((Math.abs(x) * f).toPrecision(12)))) / f;
    return r === 0 ? 0 : r; // avoid "-0"
  }

  function formatNumber(x, d) {
    if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
    return roundHalfUp(x, d).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function formatDollars(x) {
    if (x === null || x === undefined) return 'n/a';
    const s = formatNumber(Math.abs(x), 0);
    return (x < 0 && s !== '0' ? '-$' : '$') + s;
  }

  // Costs shown the way the case prints them: (4,000)
  function formatParens(x) {
    if (x === null || x === undefined) return 'n/a';
    return '(' + formatNumber(Math.abs(x), 0) + ')';
  }

  function formatCents(x) {
    if (x === null || x === undefined) return 'n/a';
    return (x < 0 ? '-$' : '$') + formatNumber(Math.abs(x), 2);
  }

  function formatPercent(x, d) {
    if (x === null || x === undefined) return 'n/a';
    return formatNumber(x * 100, d === undefined ? 2 : d) + '%';
  }

  function formatMultiple(x) {
    if (x === null || x === undefined) return 'n/a';
    return formatNumber(x, 2) + '×';
  }

  function formatShares(x) {
    if (x === null || x === undefined) return 'n/a';
    return formatNumber(x, 2);
  }

  // ---------- Reading CSV text ----------

  // Small CSV reader: header row, comma separated, double quotes allowed.
  // Returns an array of objects keyed by the header names.
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const src = String(text).replace(/^﻿/, '');
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((v) => v.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    if (rows.length === 0) return [];
    const header = rows[0].map((h) => h.trim());
    return rows.slice(1).map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : r[i]).trim(); });
      return o;
    });
  }

  // A number from CSV text; an empty cell is null (the $0 row has no cost of debt).
  function num(text, what) {
    if (text === '' || text === undefined || text === null) return null;
    const v = Number(text);
    if (!Number.isFinite(v)) throw new Error('"' + text + '" is not a number (' + what + ')');
    return v;
  }

  function needNum(text, what) {
    const v = num(text, what);
    if (v === null) throw new Error('Missing value: ' + what);
    return v;
  }

  function lookup(rows, keyCol, key, valueCol, file) {
    const r = rows.find((x) => x[keyCol] === key);
    if (!r) throw new Error('Missing "' + key + '" in ' + file);
    return r[valueCol];
  }

  // Turn the parsed CSV files into one inputs object. Nothing is typed in here:
  // every figure comes from the files.
  function buildInputs(files) {
    const taxRate = needNum(lookup(files.assumptions, 'assumption', 'tax_rate', 'value', 'assumptions.csv'), 'tax_rate');

    const cd = (item) => lookup(files.cdss, 'item', item, 'value', 'cdss.csv');
    const sales = needNum(cd('sales'), 'sales');
    const variableCostRate = needNum(cd('variable_cost_rate'), 'variable_cost_rate');
    const fixedCosts = needNum(cd('fixed_costs'), 'fixed_costs');
    const cdss = {
      sales,
      variableCostRate,
      fixedCosts,
      ebit: sales * (1 - variableCostRate) - fixedCosts,
      totalAssets: needNum(cd('total_assets'), 'total_assets'),
      bookDebt: needNum(cd('debt'), 'debt'),
      shares: needNum(cd('shares_outstanding'), 'shares_outstanding'),
      price: needNum(cd('share_price'), 'share_price'),
      managementShare: needNum(cd('management_share'), 'management_share'),
      taxRate,
    };

    const schedule = files.schedule
      .map((r) => ({
        debt: needNum(r.debt, 'debt'),
        costOfDebt: num(r.cost_of_debt, 'cost_of_debt'),
        costOfEquity: needNum(r.cost_of_equity, 'cost_of_equity'),
      }))
      .sort((a, b) => a.debt - b.debt);
    if (schedule.length === 0) throw new Error('The banker schedule has no rows');
    schedule.forEach((r) => {
      if (r.debt > 0 && r.costOfDebt === null) throw new Error('Missing cost_of_debt at debt ' + r.debt);
    });

    const ex = (item) => lookup(files.example, 'item', item, 'value', 'example_firms.csv');
    const example = {
      totalAssets: needNum(ex('total_assets'), 'total_assets'),
      firmLDebt: needNum(ex('firm_l_debt'), 'firm_l_debt'),
      interestRate: needNum(ex('interest_rate'), 'interest_rate'),
      sliderMax: needNum(ex('slider_max'), 'slider_max'),
      sliderStep: needNum(ex('slider_step'), 'slider_step'),
      taxRate,
    };

    const scenarios = files.scenarios.map((r) => ({
      probability: needNum(r.probability, 'probability'),
      sales: needNum(r.sales, 'sales'),
      operatingCosts: needNum(r.operating_costs, 'operating_costs'),
    }));
    if (scenarios.length === 0) throw new Error('ebit_scenarios.csv has no rows');

    return { cdss, schedule, example, scenarios, taxRate };
  }

  // ---------- Firm U and Firm L (question c) ----------

  // Income statement and ratios for one firm. debt = 0 is Firm U.
  function firmStatement(scenarios, params) {
    const { assets, debt, interestRate, taxRate } = params;
    const interest = interestRate * debt;
    const equity = assets - debt;
    const columns = scenarios.map((s) => {
      const ebit = s.sales - s.operatingCosts;
      const ebt = ebit - interest;
      const taxes = taxRate * ebt;
      const netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operatingCosts,
        ebit,
        interest,
        ebt,
        taxes,
        netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null, // no interest: n/a, not infinity
      };
    });
    const stats = (key) => {
      const mean = columns.reduce((a, c) => a + c.probability * c[key], 0);
      const variance = columns.reduce((a, c) => a + c.probability * (c[key] - mean) ** 2, 0);
      const sd = Math.sqrt(variance);
      return { mean, sd, cv: mean === 0 ? null : sd / mean };
    };
    const roe = stats('roe');
    const tie = interest > 0 ? stats('tie') : { mean: null, sd: null, cv: null };
    return {
      assets,
      debt,
      equity,
      interest,
      columns,
      probabilityTotal: columns.reduce((a, c) => a + c.probability, 0),
      expectedRoe: roe.mean,
      sdRoe: roe.sd,
      cvRoe: roe.cv,
      expectedTie: tie.mean,
      sdTie: tie.sd,
    };
  }

  // ---------- CDSS at each amount of borrowing ----------

  // One row of the banker's schedule under both buyback methods.
  function cdssAtDebt(c, sched) {
    const T = c.taxRate;
    const n = c.shares;
    const P0 = c.price;
    const A = c.totalAssets;
    const D = sched.debt;
    const rd = sched.costOfDebt === null ? 0 : sched.costOfDebt;
    const rs = sched.costOfEquity;

    const interest = rd * D;
    const netIncome = (c.ebit - interest) * (1 - T);
    const tie = interest > 0 ? c.ebit / interest : null;

    // Case method: buy back at today's price.
    const caseRepurchased = D / P0;
    const caseRemaining = n - caseRepurchased;
    const caseEps = netIncome / caseRemaining;
    const casePrice = caseEps / rs; // all earnings paid out, g = 0
    const waccBook = (D / A) * rd * (1 - T) + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    const equityValue = netIncome / rs;
    const firmValue = equityValue + D;
    const newPrice = firmValue / n;
    const newRepurchased = D / newPrice;
    const newRemaining = n - newRepurchased;
    const newEps = netIncome / newRemaining;
    const waccMarket = (D / firmValue) * rd * (1 - T) + (equityValue / firmValue) * rs;

    return {
      debt: D,
      costOfDebt: sched.costOfDebt,
      costOfEquity: rs,
      interest,
      netIncome,
      tie,
      case: {
        repurchased: caseRepurchased,
        remaining: caseRemaining,
        eps: caseEps,
        price: casePrice,
        wacc: waccBook,
      },
      newPrice: {
        equityValue,
        firmValue,
        price: newPrice,
        repurchased: newRepurchased,
        remaining: newRemaining,
        eps: newEps,
        wacc: waccMarket,
        // EPS should equal r_s x P, and market WACC should equal EBIT(1-T)/V.
        epsCheckOk: Math.abs(newEps - rs * newPrice) <= 1e-9 * Math.max(1, Math.abs(newEps)),
        waccCheckOk:
          Math.abs(waccMarket - (c.ebit * (1 - T)) / firmValue) <= 1e-9,
      },
    };
  }

  // Index of the best row by `pick` (a function row => number). `dir` is 'max' or 'min'.
  // On an exact tie the smaller amount of debt wins (rows are sorted by debt).
  function bestIndex(rows, pick, dir) {
    let best = 0;
    for (let i = 1; i < rows.length; i++) {
      const a = pick(rows[i]);
      const b = pick(rows[best]);
      const tol = 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
      const better = dir === 'max' ? a > b + tol : a < b - tol;
      if (better) best = i;
    }
    return best;
  }

  function cdssAnalysis(inputs) {
    const c = inputs.cdss;
    const rows = inputs.schedule.map((s) => cdssAtDebt(c, s));
    const warnings = [];

    const base = rows.find((r) => r.debt === 0);
    if (!base) {
      warnings.push('The banker schedule has no $0 row, so today\'s price could not be checked.');
    } else if (Math.abs(base.netIncome / c.shares / base.costOfEquity - c.price) >= 0.005) {
      warnings.push(
        'Check failed: with no debt, EPS / r_s = ' + formatCents(base.netIncome / c.shares / base.costOfEquity) +
        ', but the share price in cdss.csv is ' + formatCents(c.price) + '.'
      );
    }
    rows.forEach((r) => {
      if (!r.newPrice.epsCheckOk) warnings.push('Check failed at ' + formatDollars(r.debt) + ': new-price EPS does not equal r_s × price.');
      if (!r.newPrice.waccCheckOk) warnings.push('Check failed at ' + formatDollars(r.debt) + ': market-weight WACC does not equal EBIT × (1 − T) / V.');
      if (r.case.remaining <= 0) warnings.push('At ' + formatDollars(r.debt) + ' the $' + c.price + ' buyback would retire every share.');
    });

    const winners = {
      casePrice: bestIndex(rows, (r) => r.case.price, 'max'),
      newPrice: bestIndex(rows, (r) => r.newPrice.price, 'max'),
      bookWacc: bestIndex(rows, (r) => r.case.wacc, 'min'),
      marketWacc: bestIndex(rows, (r) => r.newPrice.wacc, 'min'),
    };
    const amounts = Object.values(winners).map((i) => rows[i].debt);
    const allAgree = amounts.every((a) => a === amounts[0]);

    return { ebit: c.ebit, rows, warnings, winners, allAgree };
  }

  const api = {
    roundHalfUp, formatNumber, formatDollars, formatParens, formatCents, formatPercent,
    formatMultiple, formatShares,
    parseCsv, buildInputs,
    firmStatement, cdssAtDebt, cdssAnalysis, bestIndex,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CapStruct = api;
})(typeof self !== 'undefined' ? self : this);
