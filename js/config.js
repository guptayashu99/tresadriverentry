const CONFIG = {
  // Paste your Google Apps Script Web App URL here after deployment
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyQPX1pKgi-1ERBbM3RX_RyTjYYzpK5l6FKKkXEfaXTkAhUOS7WCd97OE_MEwDZ1ktOSQ/exec',

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

  // Garage locations — check-in/out allowed within GARAGE_RADIUS_M of any location
  GARAGES: [
    { name: 'Garage - Dwarka Sector 18B', lat: 28.58458,  lng: 77.03453  },
    { name: 'Garage - Dwarka Sector 13',  lat: 28.596932, lng: 77.033040 },
  ],
  GARAGE_RADIUS_M: 150
};
