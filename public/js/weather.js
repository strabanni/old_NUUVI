// The weather in Ardell City (NUUVI's version of New York). It's made up, but steady: the same day
// always has the same forecast for everyone, and it follows New York's seasons (snow in winter,
// thunderstorms in summer, crisp autumn days).

// Typical New York highs and lows by month, in °F.
const CLIMATE = [
  [39, 27],
  [42, 29],
  [50, 35],
  [62, 45],
  [72, 55],
  [80, 64],
  [85, 70],
  [84, 69],
  [76, 61],
  [65, 50],
  [54, 41],
  [44, 32],
];
// How likely each kind of sky is, by season.
const SKIES = {
  winter: [
    ['sunny', 3],
    ['partly', 3],
    ['cloudy', 3],
    ['snow', 2],
    ['rain', 1],
    ['fog', 1],
  ],
  spring: [
    ['sunny', 4],
    ['partly', 4],
    ['cloudy', 2],
    ['rain', 3],
    ['fog', 1],
  ],
  summer: [
    ['sunny', 6],
    ['partly', 3],
    ['storm', 2],
    ['rain', 1],
    ['hot', 2],
  ],
  autumn: [
    ['sunny', 4],
    ['partly', 4],
    ['cloudy', 2],
    ['rain', 2],
    ['wind', 1],
    ['fog', 1],
  ],
};
export const SKY = {
  sunny: { icon: '☀️', label: 'Sunny' },
  partly: { icon: '⛅', label: 'Partly cloudy' },
  cloudy: { icon: '☁️', label: 'Cloudy' },
  rain: { icon: '🌧️', label: 'Rain' },
  storm: { icon: '⛈️', label: 'Thunderstorms' },
  snow: { icon: '🌨️', label: 'Snow' },
  fog: { icon: '🌫️', label: 'Foggy' },
  wind: { icon: '🌬️', label: 'Windy' },
  hot: { icon: '🥵', label: 'Heat wave' },
};
const LINES = {
  sunny: ['Clear skies over the skyline.', 'Rooftop weather.', 'Sunglasses on, Ardell.'],
  partly: ['A bit of sun, a bit of cloud.', 'Soft light over the river.', 'Nice enough for a walk downtown.'],
  cloudy: ['Grey and moody.', 'Overcast all day.', 'Perfect brooding weather.'],
  rain: ['Bring an umbrella.', 'Wet streets, neon reflections.', 'Rain on and off.'],
  storm: ['Storms rolling in tonight.', 'Thunder over the harbour.', 'Stay in if you can.'],
  snow: ['Snow on the avenues.', 'The city goes quiet under the snow.', 'Bundle up.'],
  fog: ['Fog over the bridges this morning.', 'The towers vanish into the mist.'],
  wind: ['Gusty along the waterfront.', 'Hold on to your hat.'],
  hot: ['Sticky and sweltering.', 'Find some shade (or a pool).'],
};

function rand(seed) {
  let x = (seed * 2654435761) >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}
const season = (m) => (m === 11 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn');

// The forecast for one day.
export function forecast(date) {
  const d = new Date(date);
  const r = rand(d.getFullYear() * 1000 + d.getMonth() * 40 + d.getDate());
  r();
  r();
  const m = d.getMonth();
  const options = SKIES[season(m)];
  let total = options.reduce((t, [, w]) => t + w, 0) * r();
  let sky = options[0][0];
  for (const [k, w] of options) {
    if ((total -= w) < 0) {
      sky = k;
      break;
    }
  }
  const [hi0, lo0] = CLIMATE[m];
  const swing = Math.round((r() - 0.5) * 14);
  let hi = hi0 + swing + (sky === 'hot' ? 8 : 0) - (sky === 'rain' || sky === 'storm' ? 3 : 0);
  let lo = lo0 + Math.round(swing * 0.7);
  if (sky === 'snow') {
    hi = Math.min(hi, 34);
    lo = Math.min(lo, 26);
  }
  const toC = (f) => Math.round(((f - 32) * 5) / 9);
  const lines = LINES[sky];
  return {
    sky,
    ...SKY[sky],
    hi,
    lo,
    hiC: toC(hi),
    loC: toC(lo),
    line: lines[Math.floor(r() * lines.length)],
    rain: sky === 'rain' || sky === 'storm' ? 60 + Math.round(r() * 35) : Math.round(r() * 20),
  };
}
