// Salary & allowance calculation engine
// Rules:
//   Basic: ₹26,000/month
//   OT: ₹100/hr for hours outside 08:00–20:00 (non-Outstation only)
//   Sunday: ₹1,000 extra (applies to all duty types)
//   Outstation: flat ₹500/day, +₹500 if duty extends ≥30 min past midnight

const SALARY = {
  BASIC_MONTHLY: 26000,
  OT_RATE: 100,        // ₹ per hour
  SUNDAY_BONUS: 1000,
  OUTSTATION_DAILY: 500,
  WORK_START: 8 * 60,  // 480 mins = 08:00
  WORK_END: 20 * 60,   // 1200 mins = 20:00
  OUTSTATION_MIDNIGHT_THRESHOLD: 30 // mins past midnight to count as next day
};

function _toMins(timeStr) {
  if (!timeStr) return -1;
  const parts = timeStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function _dayDiff(dateA, dateB) {
  if (!dateA || !dateB) return 0;
  return Math.round((new Date(dateB + 'T00:00:00') - new Date(dateA + 'T00:00:00')) / 86400000);
}

// Returns overtime hours outside 08:00–20:00.
// Correctly handles same-day, overnight, and multi-day duties.
// Example: startDate=2024-01-15 startTime=15:00 endDate=2024-01-16 endTime=01:30
//          → OT = 20:00→midnight + midnight→01:30 = 5.5 h
function calcOvertimeHours(startDate, startTime, endDate, endTime) {
  const s  = _toMins(startTime);
  const e  = _toMins(endTime);
  if (s < 0 || e < 0) return 0;

  const WS  = SALARY.WORK_START; // 480
  const WE  = SALARY.WORK_END;   // 1200
  const DAY = 1440;
  const dd  = _dayDiff(startDate, endDate);

  if (dd === 0) {
    // Same day
    let ot = 0;
    if (s < WS) ot += Math.min(e, WS) - s;
    if (e > WE) ot += e - Math.max(s, WE);
    return Math.max(0, ot) / 60;
  }

  // Multi-day: day-1 portion + full middle days + last day portion
  let ot = 0;

  // First day (s → midnight)
  if (s < WS) ot += WS - s;           // pre-08:00 (rare)
  ot += DAY - Math.max(s, WE);        // post-20:00 until midnight

  // Full calendar days in between (each day: midnight→08:00 + 20:00→midnight = 720 OT mins)
  if (dd > 1) ot += (dd - 1) * (WS + (DAY - WE));

  // Last day (midnight → e)
  ot += Math.min(e, WS);              // midnight → min(e, 08:00)
  if (e > WE) ot += e - WE;          // past 20:00 on last day

  return Math.max(0, ot) / 60;
}

// Calculate all allowances for a single duty record.
// Accepts both raw form payload (camelCase) and sheet row data (header-keyed).
function calcDutyAllowance(duty) {
  const startTime = duty['Start Time'] || duty.startTime || '';
  const endTime   = duty['End Time']   || duty.endTime   || '';
  const startDate = duty['Start Date'] || duty.startDate || duty['Duty Date'] || duty.dutyDate || '';
  const endDate   = duty['End Date']   || duty.endDate   || duty['Duty Date'] || duty.dutyDate || '';
  const dutyType  = duty['Duty Type']  || duty.dutyType  || '';
  const dutyDate  = duty['Duty Date']  || duty.dutyDate  || startDate;

  const _dp = dutyDate ? dutyDate.split('-') : [];
  const isSunday = _dp.length === 3
    ? new Date(+_dp[0], +_dp[1] - 1, +_dp[2]).getDay() === 0
    : false;
  const sundayBonus = isSunday ? SALARY.SUNDAY_BONUS : 0;

  let overtimeHours = 0;
  let overtimeAmount = 0;
  let outstationDays = 0;
  let outstationAllowance = 0;

  if (dutyType === 'Outstation' || dutyType === 'Outstation Round-Trip') {
    const dd    = _dayDiff(startDate, endDate);
    const eMins = _toMins(endTime);
    // Number of outstation days:
    //   same day                         → 1
    //   next day, end < 30 min past 00:00 → 1 (trivial midnight cross)
    //   next day, end ≥ 30 min past 00:00 → 2
    //   two days later                    → 3, etc.
    outstationDays = dd > 0
      ? dd + (eMins >= SALARY.OUTSTATION_MIDNIGHT_THRESHOLD ? 1 : 0)
      : 1;
    outstationDays = Math.max(1, outstationDays);
    outstationAllowance = outstationDays * SALARY.OUTSTATION_DAILY;
  } else {
    overtimeHours  = calcOvertimeHours(startDate, startTime, endDate, endTime);
    overtimeAmount = Math.round(overtimeHours * SALARY.OT_RATE);
  }

  return {
    isSunday,
    sundayBonus,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    overtimeAmount,
    outstationDays,
    outstationAllowance,
    totalAllowance: overtimeAmount + outstationAllowance + sundayBonus
  };
}

// Calculate monthly salary for a driver given an array of duty records.
function calcMonthlySalary(duties, driverName, yearMonth) {
  const myDuties = duties.filter(d => {
    const driver = d['Driver Name'] || d.driverName || '';
    const date   = d['Duty Date']   || d.dutyDate   || '';
    return driver === driverName && date.startsWith(yearMonth);
  });

  let totalOT = 0, totalOutstation = 0, totalSunday = 0;
  const breakdown = myDuties.map(d => {
    const a = calcDutyAllowance(d);
    totalOT         += a.overtimeAmount;
    totalOutstation += a.outstationAllowance;
    totalSunday     += a.sundayBonus;
    return { duty: d, allowance: a };
  });

  return {
    driver: driverName,
    month: yearMonth,
    totalDuties: myDuties.length,
    basicSalary: SALARY.BASIC_MONTHLY,
    overtimePay: totalOT,
    outstationAllowance: totalOutstation,
    sundayBonus: totalSunday,
    grossSalary: SALARY.BASIC_MONTHLY + totalOT + totalOutstation + totalSunday,
    breakdown
  };
}

// Format minutes as "Xh Ym"
function fmtDuration(mins) {
  const m = Math.round(mins);
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

// Format currency in Indian style
function fmtINR(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

// ── Salary advances ────────────────────────────────────────────────
// An advance is recovered ONLY from allowances (overtime + outstation +
// Sunday bonus). Basic salary is never touched. Recovery runs at 100% of
// whatever allowances the driver earns, starting in the month the advance
// was taken, oldest advance first, until the balance clears.

// The slice of a month's salary an advance can be recovered from.
function recoverableAllowance(monthlySalary) {
  return monthlySalary.overtimePay
       + monthlySalary.outstationAllowance
       + monthlySalary.sundayBonus;
}

function _monthOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

function _nextMonth(ym) {
  let [y, m] = ym.split('-').map(Number);
  if (++m > 12) { m = 1; y++; }
  return y + '-' + String(m).padStart(2, '0');
}

function _thisMonth() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
}

// Normalise raw Advances sheet rows into a sorted, clean list for one driver.
function _driverAdvances(advances, driverName) {
  return (advances || [])
    .filter(a => (a['Driver Name'] || a.driverName || '') === driverName)
    .map(a => ({
      timestamp: a['Timestamp']     || '',
      date:      a['Advance Date']  || a.advanceDate || '',
      amount:    parseFloat(a['Amount'] !== undefined ? a['Amount'] : a.amount) || 0,
      mode:      a['Mode']  || '',
      notes:     a['Notes'] || ''
    }))
    .filter(a => a.amount > 0 && a.date)
    .sort((x, y) => x.date.localeCompare(y.date));
}

// Build the month-by-month recovery ledger for one driver.
// Returns totals plus a `monthly` map keyed by 'YYYY-MM' so the salary report
// and payslip can look up exactly what was recovered in a given month.
function calcAdvanceLedger(duties, advances, driverName, upToMonth) {
  const mine = _driverAdvances(advances, driverName);

  const ledger = {
    driver: driverName,
    advances: mine,
    totalAdvanced: 0,
    totalRecovered: 0,
    balance: 0,
    schedule: [],
    monthly: {}
  };
  if (!mine.length) return ledger;

  ledger.totalAdvanced = mine.reduce((s, a) => s + a.amount, 0);

  // Outstanding amount per advance, drawn down oldest-first (FIFO).
  const remaining  = mine.map(a => a.amount);
  const startMonth = _monthOf(mine[0].date);
  const target     = upToMonth || _thisMonth();
  const endMonth   = target >= startMonth ? target : startMonth;

  let ym = startMonth;
  for (let guard = 0; ym <= endMonth && guard < 600; guard++, ym = _nextMonth(ym)) {
    // Every advance taken on or before this month is now recoverable.
    const outstanding = mine.reduce(
      (s, a, i) => s + (_monthOf(a.date) <= ym ? remaining[i] : 0), 0
    );
    const advancedThisMonth = mine.reduce(
      (s, a) => s + (_monthOf(a.date) === ym ? a.amount : 0), 0
    );

    const allowances = recoverableAllowance(calcMonthlySalary(duties, driverName, ym));
    const recovered  = Math.min(allowances, outstanding);

    // Draw down oldest advance first.
    let toApply = recovered;
    mine.forEach((a, i) => {
      if (toApply <= 0 || _monthOf(a.date) > ym) return;
      const take = Math.min(remaining[i], toApply);
      remaining[i] -= take;
      toApply      -= take;
    });

    ledger.totalRecovered += recovered;

    const row = {
      month: ym,
      opening: outstanding - advancedThisMonth,
      advanced: advancedThisMonth,
      allowances,
      recovered,
      closing: outstanding - recovered
    };
    ledger.schedule.push(row);
    ledger.monthly[ym] = row;
  }

  ledger.balance = ledger.totalAdvanced - ledger.totalRecovered;
  return ledger;
}

// What gets deducted from one driver's payslip for a given month.
function advanceRecoveryForMonth(duties, advances, driverName, ym) {
  const row = calcAdvanceLedger(duties, advances, driverName, ym).monthly[ym];
  return row || { month: ym, opening: 0, advanced: 0, allowances: 0, recovered: 0, closing: 0 };
}

// Outstanding balances for every driver who has ever taken an advance.
function calcAllAdvanceBalances(duties, advances, drivers, upToMonth) {
  return drivers
    .map(d => calcAdvanceLedger(duties, advances, d, upToMonth))
    .filter(l => l.totalAdvanced > 0);
}
