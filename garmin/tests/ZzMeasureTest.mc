// 23.11.8: on-device measurements (monkeyc -t): the system fonts' height, ascent and descent and the widths of worst-case texts as
// this watch (and its font size setting) has them, logged to compare with js/watchfontdata.js (tools/watch-fonts-gen.py), and
// layoutCheck: the layout helpers of Draw.mc on worst-case texts keep every text inside its room on this watch.
// Only in test builds: (:test) code is left out of every other build (monkey.jungle).
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Test;

(:test)
function measureFonts(logger as Logger) as Boolean {
    var dc = SmokeKit.smokeDc();
    var fonts = [Graphics.FONT_XTINY, Graphics.FONT_TINY, Graphics.FONT_SMALL, Graphics.FONT_MEDIUM, Graphics.FONT_LARGE, Graphics.FONT_NUMBER_MILD, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_THAI_HOT] as Array;
    var names = ["XTINY", "TINY", "SMALL", "MEDIUM", "LARGE", "NUMBER_MILD", "NUMBER_MEDIUM", "NUMBER_HOT", "NUMBER_THAI_HOT"] as Array<String>;
    var strs = ["102.5", "80", "12", "SET 2 OF 4", "Bench press", "Incline bench press", "1:30"] as Array<String>;
    var ds = System.getDeviceSettings();
    logger.debug("screen " + ds.screenWidth + "x" + ds.screenHeight);
    for (var i = 0; i < fonts.size(); i++) {
        var line = names[i] + " h=" + dc.getFontHeight(fonts[i]) + " asc=" + Graphics.getFontAscent(fonts[i]) + " desc=" + Graphics.getFontDescent(fonts[i]);
        for (var j = 0; j < strs.size(); j++) { line = line + " [" + strs[j] + "]=" + dc.getTextWidthInPixels(strs[j], fonts[i]); }
        logger.debug(line);
    }
    return true;
}
// the helpers' promises on this watch's fonts: pick / put never give a text wider than its room (a fixed text: its shortest variant
// fits a list row's room on the round screen), byInk / fontIn / inPill keep the ink inside the height, the set screen's numbers fit
(:test)
function layoutCheck(logger as Logger) as Boolean {
    var dc = SmokeKit.smokeDc(), S = dc.getWidth(), c = S / 2, bad = 0;
    var XT = Graphics.FONT_XTINY, SM = Graphics.FONT_SMALL, ME = Graphics.FONT_MEDIUM;
    // fixed texts with their variants, as the screens use them, at the row they take in the worst case (0.845 S: the far list row)
    var fixed = ["Sends when the phone is near|Waiting for the phone|Not sent yet", "Searching, START connects|Searching", "Hold to finish|Hold to end|Hold",
        "Choose sports in the app:|Choose in the app:|In the app:", "Another app controls it.|Another app has it.|App in use", "NO CONTROL, OTHER APP|NO CONTROL",
        "Close it, or ride without ERG|Or ride without ERG|Or ride, no ERG", "TO FINISH|TO GO", "START resume|Resume"] as Array<String>;
    var ys = [0.15, 0.5, 0.82, 0.62, 0.61, 0.205, 0.675, 0.885, 0.85] as Array<Float>;
    for (var i = 0; i < fixed.size(); i++) {
        var y = S * ys[i], m = Draw.roomC(dc, c, y, XT, Draw.first(fixed[i]), Draw.R0), t = Draw.pick(dc, fixed[i], XT, m, false), w = dc.getTextWidthInPixels(t, XT);
        if (w > m) { bad++; logger.debug("too wide: \"" + t + "\" " + w + " > " + m + " px at " + ys[i]); }
    }
    // the fonts the helpers pick keep the ink inside the height asked for (or are the last of the list)
    var hs = [S * 0.1, S * 0.11, S * 0.12, S * 0.14] as Array<Float>;
    for (var i = 0; i < hs.size(); i++) {
        var f = Draw.byInk(dc, [ME, SM, XT], hs[i]);
        if (f != XT && Draw.inkH(dc, f) > hs[i]) { bad++; logger.debug("byInk: ink " + Draw.inkH(dc, f) + " > " + hs[i]); }
        var p = Draw.inPill(dc, "Discard", [SM, XT], S * 0.42, hs[i]);
        if (p != XT && (Draw.up(dc, p) > hs[i] / 2.0 - 1 || Draw.dn(dc, p, "Discard") > hs[i] / 2.0 - 1)) { bad++; logger.debug("inPill: Discard does not sit in " + hs[i]); }
    }
    // the set screen's worst case: 102.5 x 10 in one number font inside both columns and the circle
    var top = S * 0.38, bot = S * 0.62, xs = [S * 0.285, S * 0.735] as Array<Float>, mx = [(S * 0.34).toNumber(), (S * 0.28).toNumber()] as Array<Number>;
    var nf = Draw.numIn(dc, ["102.5", "10"], [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM, Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE, ME, SM], mx, xs, top, bot, Draw.R0);
    if (dc.getTextWidthInPixels("102.5", nf) > mx[0]) { bad++; logger.debug("102.5 is wider than its column"); }
    logger.debug("screen " + S + " layoutCheck findings " + bad + " (font size setting: whatever the watch is set to)");
    Test.assertEqualMessage(bad, 0, "layoutCheck: " + bad + " findings");
    return true;
}
