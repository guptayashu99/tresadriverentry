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

// Returns overtime hours outside 08:00–20:00 for a single duty.
// Handles overnight shifts correctly.
// Example: start=15:00 end=01:30 → OT = 20:00→midnight + midnight→01:30 = 5.5 h
function calcOvertimeHours(startTime, endTime) {
  const s = _toMins(startTime);
  const e = _toMins(endTime);
  if (s < 0 || e < 0) return 0;

  const WS = SALARY.WORK_START; // 480
  const WE = SALARY.WORK_END;   // 1200
  const DAY = 1440;

  const isOvernight = e < s;
  let otMins = 0;

  if (!isOvernight) {
    // Same-day duty
    if (s < WS) otMins += Math.min(e, WS) - s;   // early morning OT
    if (e > WE) otMins += e - Math.max(s, WE);   // evening OT
  } else {
    // Overnight: split into [s → midnight] and [midnight → e]

    // Day portion OT
    if (s < WS) otMins += WS - s;               // pre-08:00 at start (rare)
    otMins += DAY - Math.max(s, WE);            // post-20:00 until midnight

    // Night portion OT (midnight → e)
    otMins += Math.min(e, WS);                  // from midnight to min(e, 08:00)
    if (e > WE) otMins += e - WE;              // past 20:00 next day (very long duty)
  }

  return Math.max(0, otMins) / 60;
}

// Calculate all allowances for a single duty record.
// Accepts both raw form data (camelCase) and sheet row data (header-keyed).
function calcDutyAllowance(duty) {
  const startTime = duty['Start Time'] || duty.startTime || '';
  const endTime   = duty['End Time']   || duty.endTime   || '';
  const dutyType  = duty['Duty Type']  || duty.dutyType  || '';
  const dutyDate  = duty['Duty Date']  || duty.dutyDate  || '';

  const isSunday = dutyDate
    ? new Date(dutyDate + 'T00:00:00').getDay() === 0
    : false;
  const sundayBonus = isSunday ? SALARY.SUNDAY_BONUS : 0;

  let overtimeHours = 0;
  let overtimeAmount = 0;
  let outstationDays = 0;
  let outstationAllowance = 0;

  if (dutyType === 'Outstation') {
    const s = _toMins(startTime);
    const e = _toMins(endTime);
    const isOvernight = s >= 0 && e >= 0 && e < s;
    outstationDays = 1;
    if (isOvernight && e >= SALARY.OUTSTATION_MIDNIGHT_THRESHOLD) {
      outstationDays = 2; // worked 30+ min past midnight → next-day allowance
    }
    outstationAllowance = outstationDays * SALARY.OUTSTATION_DAILY;
  } else {
    overtimeHours = calcOvertimeHours(startTime, endTime);
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
