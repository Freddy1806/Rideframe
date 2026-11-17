// RIDEFRAME on a Garmin watch: which Garmin sport a recording is (ActivityRecording.createSession :sport / :subSport),
// whether it uses GPS, and the group name shown under a "more" sport (js/theme.js MODES[groupOf(type)].name).
// sp = "run" | "ride" | "other"; t = the Strava sport type of a "more" sport (js/watchfields.js MORE), "" otherwise.
// Constants from Toybox.Activity (API 3.2.0; the ones marked 4.1.6 need that API level, every target runs 5.2).
import Toybox.Activity;
import Toybox.Lang;

module Sports {
    function sport(sp as String, t as String) as Activity.Sport {
        if (sp.equals("run")) { return Activity.SPORT_RUNNING; }
        if (sp.equals("ride")) { return Activity.SPORT_CYCLING; }
        if (t.equals("Walk")) { return Activity.SPORT_WALKING; }
        if (t.equals("Hike")) { return Activity.SPORT_HIKING; }
        if (t.equals("Wheelchair")) { return Activity.SPORT_WHEELCHAIR_PUSH_WALK; }               // 4.1.6
        if (t.equals("IceSkate")) { return Activity.SPORT_ICE_SKATING; }
        if (t.equals("InlineSkate")) { return Activity.SPORT_INLINE_SKATING; }
        if (t.equals("NordicSki") || t.equals("RollerSki")) { return Activity.SPORT_CROSS_COUNTRY_SKIING; }
        if (t.equals("AlpineSki") || t.equals("BackcountrySki")) { return Activity.SPORT_ALPINE_SKIING; }
        if (t.equals("Snowboard")) { return Activity.SPORT_SNOWBOARDING; }
        if (t.equals("Snowshoe")) { return Activity.SPORT_SNOWSHOEING; }
        if (t.equals("Rowing") || t.equals("VirtualRow")) { return Activity.SPORT_ROWING; }
        if (t.equals("Kayaking")) { return Activity.SPORT_KAYAKING; }
        if (t.equals("Canoeing")) { return Activity.SPORT_PADDLING; }
        if (t.equals("StandUpPaddling")) { return Activity.SPORT_STAND_UP_PADDLEBOARDING; }
        if (t.equals("Surfing")) { return Activity.SPORT_SURFING; }
        if (t.equals("Kitesurf")) { return Activity.SPORT_KITESURFING; }
        if (t.equals("Windsurf")) { return Activity.SPORT_WINDSURFING; }
        if (t.equals("Sail")) { return Activity.SPORT_SAILING; }
        if (t.equals("Workout") || t.equals("Yoga") || t.equals("Pilates") || t.equals("Crossfit")) { return Activity.SPORT_TRAINING; }
        if (t.equals("HighIntensityIntervalTraining")) { return Activity.SPORT_HIIT; }                // 4.1.6
        if (t.equals("Elliptical") || t.equals("StairStepper")) { return Activity.SPORT_FITNESS_EQUIPMENT; }
        if (t.equals("Soccer")) { return Activity.SPORT_SOCCER; }
        if (t.equals("Tennis")) { return Activity.SPORT_TENNIS; }
        if (t.equals("TableTennis") || t.equals("Badminton") || t.equals("Squash") || t.equals("Racquetball") || t.equals("Pickleball") || t.equals("Padel")) {
            return Activity.SPORT_RACKET;                                                             // 4.1.6
        }
        if (t.equals("Basketball")) { return Activity.SPORT_BASKETBALL; }
        if (t.equals("Volleyball")) { return Activity.SPORT_VOLLEYBALL; }                           // 4.1.6
        if (t.equals("RockClimbing")) { return Activity.SPORT_ROCK_CLIMBING; }
        if (t.equals("Golf")) { return Activity.SPORT_GOLF; }
        return Activity.SPORT_GENERIC; // Skateboard and anything new: generic
    }
    function sub(sp as String, t as String) as Activity.SubSport {
        if (sp.equals("ride")) { return Activity.SUB_SPORT_ROAD; }
        if (sp.equals("run")) { return Activity.SUB_SPORT_STREET; } // VERIFY: or SUB_SPORT_GENERIC (what the watch's own Run app writes)
        if (t.equals("BackcountrySki")) { return Activity.SUB_SPORT_BACKCOUNTRY; }                  // 4.1.6
        if (t.equals("RollerSki")) { return Activity.SUB_SPORT_SKATE_SKIING; }                     // 4.1.6
        if (t.equals("VirtualRow")) { return Activity.SUB_SPORT_INDOOR_ROWING; }
        if (t.equals("Yoga")) { return Activity.SUB_SPORT_YOGA; }                                  // 4.1.6
        if (t.equals("Pilates")) { return Activity.SUB_SPORT_PILATES; }                            // 4.1.6
        if (t.equals("Workout") || t.equals("Crossfit")) { return Activity.SUB_SPORT_CARDIO_TRAINING; }
        if (t.equals("Elliptical")) { return Activity.SUB_SPORT_ELLIPTICAL; }
        if (t.equals("StairStepper")) { return Activity.SUB_SPORT_STAIR_CLIMBING; }
        if (t.equals("TableTennis")) { return Activity.SUB_SPORT_TABLE_TENNIS; }                   // 4.1.6
        if (t.equals("Badminton")) { return Activity.SUB_SPORT_BADMINTON; }                        // 4.1.6
        if (t.equals("Squash")) { return Activity.SUB_SPORT_SQUASH; }                              // 4.1.6
        if (t.equals("Racquetball")) { return Activity.SUB_SPORT_RACQUETBALL; }                    // 4.1.6
        if (t.equals("Pickleball")) { return Activity.SUB_SPORT_PICKLEBALL; }                      // 4.1.6
        if (t.equals("Padel")) { return Activity.SUB_SPORT_PADEL; }                                // 4.1.6
        return Activity.SUB_SPORT_GENERIC;
    }
    // outdoor sports switch GPS on (Position.enableLocationEvents) from the ready screen to the end of the recording
    function gps(sp as String, t as String) as Boolean {
        if (!sp.equals("other")) { return true; }
        var out = ["Walk", "Hike", "Wheelchair", "InlineSkate", "Skateboard", "NordicSki", "AlpineSki", "BackcountrySki", "Snowboard", "Snowshoe", "RollerSki",
                   "Rowing", "Kayaking", "Canoeing", "StandUpPaddling", "Surfing", "Kitesurf", "Windsurf", "Sail", "Soccer", "Golf"] as Array<String>;
        return out.indexOf(t) >= 0;
    }
    // js/theme.js MODES[groupOf(t)].name (js/sports.js STRAVA groups)
    function group(t as String) as String {
        if (t.equals("Walk") || t.equals("Hike") || t.equals("Wheelchair")) { return "Walk & hike"; }
        if (t.equals("IceSkate") || t.equals("InlineSkate") || t.equals("Skateboard")) { return "Skating"; }
        if (t.equals("NordicSki") || t.equals("AlpineSki") || t.equals("BackcountrySki") || t.equals("Snowboard") || t.equals("Snowshoe") || t.equals("RollerSki")) { return "Snow sports"; }
        if (t.equals("Rowing") || t.equals("VirtualRow") || t.equals("Kayaking") || t.equals("Canoeing") || t.equals("StandUpPaddling") || t.equals("Surfing")
            || t.equals("Kitesurf") || t.equals("Windsurf") || t.equals("Sail")) { return "Water sports"; }
        if (t.equals("Workout") || t.equals("Yoga") || t.equals("Pilates") || t.equals("Crossfit") || t.equals("HighIntensityIntervalTraining") || t.equals("Elliptical")
            || t.equals("StairStepper")) { return "Workout & yoga"; }
        if (t.equals("Soccer") || t.equals("Tennis") || t.equals("TableTennis") || t.equals("Badminton") || t.equals("Squash") || t.equals("Racquetball")
            || t.equals("Pickleball") || t.equals("Padel") || t.equals("Basketball") || t.equals("Volleyball")) { return "Ball & racket"; }
        return "Other sports";
    }
}
