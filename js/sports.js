// Every sport, not only bike and run (Freddy 17.11.: "alle Fitnessdaten und alle Sportarten in einer App", ice skating from the
// Garmin shows up like on Strava). Strava's sport_type names are the one vocabulary: imports keep them raw, manual entries and
// files use them too. Each maps to a group (colour, icon, filter chip, totals) and gets an English label. Pure, no DOM (Node tests).

/** sport_type -> [group, label]; groups ride/trainer/run/kraft are the existing modes, the rest are new (theme.js MODES) */
export const STRAVA = {
  Ride: ['ride', 'Ride'], MountainBikeRide: ['ride', 'Mountain bike ride'], GravelRide: ['ride', 'Gravel ride'], EBikeRide: ['ride', 'E-bike ride'],
  EMountainBikeRide: ['ride', 'E-mountain bike ride'], Velomobile: ['ride', 'Velomobile'], Handcycle: ['ride', 'Handcycle'], VirtualRide: ['trainer', 'Virtual ride'],
  Run: ['run', 'Run'], TrailRun: ['run', 'Trail run'], VirtualRun: ['run', 'Virtual run'],
  Walk: ['walk', 'Walk'], Hike: ['walk', 'Hike'], Wheelchair: ['walk', 'Wheelchair'],
  Swim: ['swim', 'Swim'],
  IceSkate: ['skate', 'Ice skating'], InlineSkate: ['skate', 'Inline skating'], Skateboard: ['skate', 'Skateboarding'],
  NordicSki: ['ski', 'Cross-country skiing'], AlpineSki: ['ski', 'Alpine skiing'], BackcountrySki: ['ski', 'Backcountry skiing'], Snowboard: ['ski', 'Snowboarding'],
  Snowshoe: ['ski', 'Snowshoeing'], RollerSki: ['ski', 'Roller skiing'],
  Rowing: ['water', 'Rowing'], VirtualRow: ['water', 'Indoor rowing'], Kayaking: ['water', 'Kayaking'], Canoeing: ['water', 'Canoeing'], StandUpPaddling: ['water', 'Stand up paddling'],
  Surfing: ['water', 'Surfing'], Kitesurf: ['water', 'Kitesurfing'], Windsurf: ['water', 'Windsurfing'], Sail: ['water', 'Sailing'],
  WeightTraining: ['kraft', 'Weight training'],
  Workout: ['fit', 'Workout'], Yoga: ['fit', 'Yoga'], Pilates: ['fit', 'Pilates'], Crossfit: ['fit', 'CrossFit'], HighIntensityIntervalTraining: ['fit', 'HIIT'],
  Elliptical: ['fit', 'Elliptical'], StairStepper: ['fit', 'Stair stepper'],
  Soccer: ['ball', 'Football'], Tennis: ['ball', 'Tennis'], TableTennis: ['ball', 'Table tennis'], Badminton: ['ball', 'Badminton'], Squash: ['ball', 'Squash'],
  Racquetball: ['ball', 'Racquetball'], Pickleball: ['ball', 'Pickleball'], Padel: ['ball', 'Padel'], Basketball: ['ball', 'Basketball'], Volleyball: ['ball', 'Volleyball'],
  RockClimbing: ['other', 'Climbing'], Golf: ['other', 'Golf'],
};
/** "StandUpPaddling" -> "Stand up paddling", for sport types Strava adds later */
export const pretty = t => { const s = String(t || '').replace(/[^A-Za-z0-9]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim().toLowerCase(); return s ? s[0].toUpperCase() + s.slice(1) : 'Other'; };
export const groupOf = t => STRAVA[t]?.[0] || 'other';
export const labelOf = t => STRAVA[t]?.[1] || pretty(t);
/** the family for dedupe and the bike-only numbers: every bike group is one ('bike'), the rest is their group */
export const famOf = g => ['ride', 'trainer', 'world'].includes(g) ? 'bike' : g;
/** the picker for manual entries and files: the common ones first, then the rest alphabetically */
const TOP = ['Ride', 'Run', 'Walk', 'Hike', 'Swim', 'IceSkate', 'NordicSki', 'AlpineSki', 'WeightTraining', 'Workout', 'Yoga', 'VirtualRide'];
export const PICK = [...TOP, ...Object.keys(STRAVA).filter(k => !TOP.includes(k)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)))];

/** a sport_type for what a file says (GPX <type>, TCX Sport="…"); the person can still change it before saving */
export function typeFromText(s) {
  const t = String(s || '').toLowerCase();
  if (!t) return '';
  for (const k of Object.keys(STRAVA)) if (k.toLowerCase() === t.replace(/[^a-z]/g, '')) return k;
  return /virtual.*(ride|cycl|bik)|indoor.*cycl/.test(t) ? 'VirtualRide' : /trail/.test(t) ? 'TrailRun' : /run/.test(t) ? 'Run' : /mountain/.test(t) ? 'MountainBikeRide' : /gravel/.test(t) ? 'GravelRide'
    : /e.?bik/.test(t) ? 'EBikeRide' : /bik|cycl|ride|velo/.test(t) ? 'Ride' : /hik/.test(t) ? 'Hike' : /walk/.test(t) ? 'Walk' : /swim/.test(t) ? 'Swim' : /ice/.test(t) ? 'IceSkate'
    : /inline|roller.?skat/.test(t) ? 'InlineSkate' : /cross.?country|nordic|langlauf/.test(t) ? 'NordicSki' : /snowboard/.test(t) ? 'Snowboard' : /ski/.test(t) ? 'AlpineSki'
    : /row/.test(t) ? 'Rowing' : /kayak|paddl|canoe/.test(t) ? 'Kayaking' : /yoga/.test(t) ? 'Yoga' : /strength|weight/.test(t) ? 'WeightTraining' : '';
}
