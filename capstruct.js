/*
 * capstruct.js: the finance math for the AGE capital structure app.
 *
 * Everything here is a plain function that never touches the page, so we can
 * check it with Node (node -e "const c = require('./capstruct.js'); ...")
 * and the browser can load the same file with a <script> tag.
 *
 * Notation: T = tax rate, D = amount borrowed, n = shares outstanding before
 * any buyback, P0 = today's price, A = total book assets.
 */
(function (root) {
  'use strict';

  /* ---------- Rounding and display ---------- */

  // Round half up on the decimal value. toFixed rounds the binary value, so it
  // shows 14.02% for an exact 14.025%. Going through toPrecision(12) first
  // removes the tiny binary error before we round.
  function roundHalfUp(x, d) {
    var scale = Math.pow(10, d);
    var sign = x < 0 ? -1 : 1;
    var scaled = Math.abs(Number((x * scale).toPrecision(12)));
    return (sign * Math.round(scaled)) / scale;
  }

  function fixed(x, d) {
    return roundHalfUp(x, d).toFixed(d);
  }

  function withCommas(text) {
    var parts = text.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  var NA = 'n/a';

  function isMissing(x) {
    return x === null || x === undefined || !isFinite(x);
  }

  // Dollars to the nearest dollar.
  function dollars(x) {
    if (isMissing(x)) return NA;
    var r = roundHalfUp(x, 0);
    return (r < 0 ? '-$' : '$') + withCommas(String(Math.abs(r)));
  }

  // A cost shown the way the case shows it: in parentheses.
  function dollarsParen(x) {
    if (isMissing(x)) return NA;
    return '(' + dollars(Math.abs(x)) + ')';
  }

  // Prices, EPS and dividends to the cent.
  function price(x) {
    if (isMissing(x)) return NA;
    var r = roundHalfUp(x, 2);
    return (r < 0 ? '-$' : '$') + withCommas(Math.abs(r).toFixed(2));
  }

  // Share counts to two decimals (never rounded before this point).
  function shares(x) {
    if (isMissing(x)) return NA;
    return withCommas(fixed(x, 2));
  }

  // Rates as percents to two decimals.
  function percent(x) {
    if (isMissing(x)) return NA;
    return fixed(x * 100, 2) + '%';
  }

  // TIE, CV and other multiples to two decimals.
  function multiple(x) {
    if (isMissing(x)) return NA;
    return fixed(x, 2) + '×';
  }

  function plain(x, d) {
    if (isMissing(x)) return NA;
    return fixed(x, d);
  }

  /* ---------- Reading the CSV files ---------- */

  // Small CSV reader: handles quoted fields and blank cells (blank -> '').
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i, ch;
    text = String(text).replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
    if (!rows.length) return [];
    var header = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).map(function (r) {
      var obj = {};
      header.forEach(function (h, k) { obj[h] = (r[k] === undefined ? '' : r[k]).trim(); });
      return obj;
    });
  }

  function num(value, label) {
    if (value === '' || value === undefined || value === null) {
      throw new Error('Missing number for ' + label);
    }
    var n = Number(value);
    if (!isFinite(n)) throw new Error('Not a number for ' + label + ': "' + value + '"');
    return n;
  }

  // Turn item,value rows (optionally filtered by section) into {item: number}.
  function itemMap(rows, section) {
    var map = {};
    rows.forEach(function (r) {
      if (section && r.section !== section) return;
      map[r.item] = r.value;
    });
    return map;
  }

  function loadTaxRate(assumptionRows) {
    var row = assumptionRows.filter(function (r) { return r.assumption === 'tax_rate'; })[0];
    if (!row) throw new Error('assumptions.csv has no tax_rate row');
    return num(row.value, 'tax_rate');
  }

  function loadCdss(rows) {
    var ops = itemMap(rows, 'operations');
    var bs = itemMap(rows, 'balance_sheet');
    var mkt = itemMap(rows, 'market');
    return {
      sales: num(ops.sales, 'sales'),
      variableCostRate: num(ops.variable_cost_rate, 'variable_cost_rate'),
      fixedCosts: num(ops.fixed_costs, 'fixed_costs'),
      totalAssets: num(bs.total_assets, 'total_assets'),
      debt: num(bs.debt, 'debt'),
      sharesOutstanding: num(mkt.shares_outstanding, 'shares_outstanding'),
      sharePrice: num(mkt.share_price, 'share_price'),
      managementShare: num(mkt.management_share, 'management_share')
    };
  }

  function loadExampleFirms(rows) {
    var m = itemMap(rows);
    return {
      totalAssets: num(m.total_assets, 'total_assets'),
      firmLDebt: num(m.firm_l_debt, 'firm_l_debt'),
      interestRate: num(m.interest_rate, 'interest_rate'),
      sliderMax: num(m.slider_max, 'slider_max'),
      sliderStep: num(m.slider_step, 'slider_step')
    };
  }

  function loadScenarios(rows) {
    var scenarios = rows.map(function (r) {
      return {
        probability: num(r.probability, 'probability'),
        sales: num(r.sales, 'sales'),
        operatingCosts: num(r.operating_costs, 'operating_costs')
      };
    });
    var total = scenarios.reduce(function (s, x) { return s + x.probability; }, 0);
    if (Math.abs(total - 1) > 1e-9) {
      throw new Error('Probabilities in ebit_scenarios.csv add up to ' + total + ', not 1');
    }
    return scenarios;
  }

  // The banker's schedule, smallest debt first. The $0 row has no cost of debt
  // (null); every other row must have one.
  function loadSchedule(rows) {
    var schedule = rows.map(function (r) {
      var debt = num(r.debt, 'debt');
      var rd = r.cost_of_debt === '' ? null : num(r.cost_of_debt, 'cost_of_debt');
      var rs = num(r.cost_of_equity, 'cost_of_equity');
      if (debt > 0 && rd === null) {
        throw new Error('The schedule has no cost of debt at $' + debt);
      }
      return { debt: debt, costOfDebt: rd, costOfEquity: rs };
    });
    schedule.sort(function (a, b) { return a.debt - b.debt; });
    if (!schedule.length) throw new Error('The banker schedule has no rows');
    return schedule;
  }

  /* ---------- Firm U and Firm L (question c) ---------- */

  // Probability-weighted mean, standard deviation and coefficient of variation.
  // Values that are null ("n/a", for example Firm U's TIE) give null.
  function distribution(probs, values) {
    if (values.some(function (v) { return v === null; })) {
      return { expected: null, sd: null, cv: null };
    }
    var expected = 0;
    probs.forEach(function (p, i) { expected += p * values[i]; });
    var variance = 0;
    probs.forEach(function (p, i) { variance += p * Math.pow(values[i] - expected, 2); });
    var sd = Math.sqrt(variance);
    return { expected: expected, sd: sd, cv: expected === 0 ? null : sd / expected };
  }

  function firmStats(scenarios, totalAssets, debt, interestRate, taxRate) {
    var equity = totalAssets - debt;
    var interest = interestRate * debt;
    var columns = scenarios.map(function (s) {
      var ebit = s.sales - s.operatingCosts;
      var ebt = ebit - interest;
      var taxes = taxRate * ebt;
      var netIncome = ebt - taxes;
      return {
        probability: s.probability,
        sales: s.sales,
        operatingCosts: s.operatingCosts,
        ebit: ebit,
        interest: interest,
        ebt: ebt,
        taxes: taxes,
        netIncome: netIncome,
        roe: netIncome / equity,
        tie: interest > 0 ? ebit / interest : null
      };
    });
    var probs = columns.map(function (c) { return c.probability; });
    var roe = distribution(probs, columns.map(function (c) { return c.roe; }));
    var tie = distribution(probs, columns.map(function (c) { return c.tie; }));
    return {
      totalAssets: totalAssets,
      debt: debt,
      equity: equity,
      columns: columns,
      expectedRoe: roe.expected,
      sdRoe: roe.sd,
      cvRoe: roe.cv,
      expectedTie: tie.expected,
      sdTie: tie.sd
    };
  }

  /* ---------- CDSS at each amount of borrowing ---------- */

  // EBIT = sales x (1 - variable cost rate) - fixed costs. It stays the same at
  // every amount of debt, because the case says EBIT is constant.
  function cdssEbit(cdss) {
    return cdss.sales * (1 - cdss.variableCostRate) - cdss.fixedCosts;
  }

  function close(a, b) {
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }

  // Management's stake after the buyback. Management does not sell, so its
  // stake = management's share x n / shares remaining.
  //   status 'ok'        : stake is a normal percentage
  //   status 'allBought' : the buyback takes every outside share, so management
  //                        owns 100% and no outside shareholders are left
  //   status 'tooMany'   : more shares would be bought than outsiders own, so
  //                        management would have to sell (there is no stake)
  function managementStake(cdss, repurchased, remaining) {
    var n = cdss.sharesOutstanding;
    var outsiders = (1 - cdss.managementShare) * n;
    if (close(repurchased, outsiders)) {
      return { status: 'allBought', stake: 1 };
    }
    if (repurchased > outsiders || !(remaining > 0)) {
      return { status: 'tooMany', stake: null };
    }
    return { status: 'ok', stake: (cdss.managementShare * n) / remaining };
  }

  // One row of the banker's schedule, worked out both ways.
  function cdssAtDebt(cdss, taxRate, scheduleRow) {
    var T = taxRate;
    var D = scheduleRow.debt;
    var rd = scheduleRow.costOfDebt;
    var rs = scheduleRow.costOfEquity;
    var n = cdss.sharesOutstanding;
    var P0 = cdss.sharePrice;
    var A = cdss.totalAssets;
    var ebit = cdssEbit(cdss);
    var interest = D === 0 ? 0 : rd * D;
    var netIncome = (ebit - interest) * (1 - T);
    var tie = interest > 0 ? ebit / interest : null;
    var afterTaxDebtCost = D === 0 ? 0 : rd * (1 - T);

    // Case method: buy back at today's price P0.
    var cRepurchased = D / P0;
    var cRemaining = n - cRepurchased;
    var cOk = cRemaining > 0;
    var cEps = cOk ? netIncome / cRemaining : null;
    var cPrice = cOk ? cEps / rs : null;
    var cWacc = (D / A) * afterTaxDebtCost + ((A - D) / A) * rs;

    // New-price method: buy back at the price after the announcement.
    var S = netIncome / rs;
    var V = S + D;
    var nPrice = V / n;
    var nRepurchased = D / nPrice;
    var nRemaining = n - nRepurchased;
    var nOk = nRemaining > 0;
    var nEps = nOk ? netIncome / nRemaining : null;
    var nWacc = (D / V) * afterTaxDebtCost + (S / V) * rs;

    return {
      debt: D,
      costOfDebt: rd,
      costOfEquity: rs,
      ebit: ebit,
      interest: interest,
      netIncome: netIncome,
      tie: tie,
      caseMethod: {
        repurchased: cRepurchased,
        remaining: cRemaining,
        eps: cEps,
        dps: cEps, // CDSS pays out all earnings, so dividends per share = EPS
        price: cPrice,
        wacc: cWacc,
        management: managementStake(cdss, cRepurchased, cRemaining)
      },
      newPrice: {
        equityValue: S,
        firmValue: V,
        repurchased: nRepurchased,
        remaining: nRemaining,
        eps: nEps,
        dps: nEps,
        price: nPrice,
        wacc: nWacc,
        management: managementStake(cdss, nRepurchased, nRemaining),
        // Checks: EPS must equal r_s x P, and market-weight WACC must equal
        // EBIT x (1 - T) / V.
        epsCheck: nOk ? close(nEps, rs * nPrice) : false,
        waccCheck: close(nWacc, (ebit * (1 - T)) / V)
      }
    };
  }

  function cdssTable(cdss, taxRate, schedule) {
    return schedule.map(function (row) { return cdssAtDebt(cdss, taxRate, row); });
  }

  // Index of the row with the largest (or smallest) value. Rows are in order of
  // debt, so on an exact tie the smaller amount of debt wins.
  function pickIndex(rows, getValue, wantHighest) {
    var best = -1;
    var bestValue = null;
    rows.forEach(function (row, i) {
      var v = getValue(row);
      if (isMissing(v)) return;
      var better = wantHighest ? v > bestValue : v < bestValue;
      if (best === -1 || (better && !close(v, bestValue))) {
        best = i;
        bestValue = v;
      }
    });
    return best;
  }

  // Which amount of debt gives the highest price and the lowest WACC under each
  // method. If the answers differ, the page says so instead of picking one.
  function cdssBest(rows) {
    var out = {
      casePrice: pickIndex(rows, function (r) { return r.caseMethod.price; }, true),
      newPrice: pickIndex(rows, function (r) { return r.newPrice.price; }, true),
      caseWacc: pickIndex(rows, function (r) { return r.caseMethod.wacc; }, false),
      newWacc: pickIndex(rows, function (r) { return r.newPrice.wacc; }, false),
      caseEps: pickIndex(rows, function (r) { return r.caseMethod.eps; }, true),
      newEps: pickIndex(rows, function (r) { return r.newPrice.eps; }, true)
    };
    out.allAgree = out.casePrice === out.newPrice && out.casePrice === out.caseWacc &&
      out.casePrice === out.newWacc;
    return out;
  }

  // Where the Best price (kind 'price') and Highest EPS (kind 'eps') buttons send
  // the CDSS debt slider. If both buyback methods pick the same amount, go there.
  // If they pick different amounts, go to the case method's amount and return a
  // note that names both. On an exact tie the smaller amount of debt wins (see
  // pickIndex). Returns { index, note } where note is '' when the methods agree.
  function buttonTarget(rows, kind) {
    var best = cdssBest(rows);
    var caseIdx = kind === 'eps' ? best.caseEps : best.casePrice;
    var newIdx = kind === 'eps' ? best.newEps : best.newPrice;
    var what = kind === 'eps' ? 'EPS' : 'share price';
    if (caseIdx === -1 && newIdx === -1) return { index: -1, note: '' };
    if (caseIdx === newIdx) return { index: caseIdx, note: '' };
    var caseText = caseIdx === -1 ? 'none' : dollars(rows[caseIdx].debt);
    var newText = newIdx === -1 ? 'none' : dollars(rows[newIdx].debt);
    return {
      index: caseIdx === -1 ? newIdx : caseIdx,
      note: 'The two buyback methods disagree on the highest ' + what + ': ' + caseText +
        ' of debt with the case’s $20 buyback, ' + newText + ' with the new price. ' +
        'The slider is at the case method’s amount.'
    };
  }

  // EPS / r_s at $0 of debt must equal today's share price from cdss.csv. If it
  // does not (for example with a schedule the student loads), the page warns.
  function baselineCheck(cdss, rows) {
    var first = rows.filter(function (r) { return r.debt === 0; })[0];
    if (!first) {
      return { ok: false, message: 'The schedule has no $0 row, so today’s price cannot be checked.' };
    }
    var implied = first.caseMethod.eps / first.costOfEquity;
    var ok = Math.abs(implied - cdss.sharePrice) < 0.005;
    return {
      ok: ok,
      implied: implied,
      actual: cdss.sharePrice,
      message: ok ? '' :
        'EPS / r_s at $0 of debt is ' + price(implied) + ', but cdss.csv says today’s price is ' +
        price(cdss.sharePrice) + '. The schedule and the case figures do not agree.'
    };
  }

  var api = {
    roundHalfUp: roundHalfUp,
    fixed: fixed,
    dollars: dollars,
    dollarsParen: dollarsParen,
    price: price,
    shares: shares,
    percent: percent,
    multiple: multiple,
    plain: plain,
    parseCsv: parseCsv,
    loadTaxRate: loadTaxRate,
    loadCdss: loadCdss,
    loadExampleFirms: loadExampleFirms,
    loadScenarios: loadScenarios,
    loadSchedule: loadSchedule,
    distribution: distribution,
    firmStats: firmStats,
    cdssEbit: cdssEbit,
    cdssAtDebt: cdssAtDebt,
    cdssTable: cdssTable,
    cdssBest: cdssBest,
    buttonTarget: buttonTarget,
    managementStake: managementStake,
    baselineCheck: baselineCheck
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CapStruct = api;
  }
})(typeof self !== 'undefined' ? self : this);
