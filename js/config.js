const CONFIG = {
  // Paste your Google Apps Script Web App URL here after deployment
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwCS6-x2M41wcN9hZRhFYYcDAzBGs9TWStkBv7x3GuUkSWTtCljtya70_DMGP3PhmRa3Q/exec',

  // Change this before going live
  DASHBOARD_PASSWORD: 'tresa2024',

  DRIVERS: ['Prem Singh Rawat', 'Laxman Singh Negi', 'Shreyas Gupta'],
  VEHICLES: ['HR55AX4347', 'HR55BB8418', 'DL6CR6615'],
  VENDORS: ['WTI', 'Tresa Fleet Management', 'Personal Use/Service', 'Other'],
  DUTY_TYPES: ['Hourly Rental', 'Airport Transfer', 'Outstation'],

  // Per-driver PINs for My Duties page — change these before sharing with drivers
  DRIVER_PINS: {
    'Prem Singh Rawat':  '1111',
    'Laxman Singh Negi': '2222',
    'Shreyas Gupta':     '3333'
  },

  // Garage location — attendance check-in/out is only allowed within GARAGE_RADIUS_M metres
  GARAGE_LAT: 28.58458,
  GARAGE_LNG: 77.03453,
  GARAGE_RADIUS_M: 150
};
