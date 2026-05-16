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

  if (dutyType === 'Outstation') {
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
