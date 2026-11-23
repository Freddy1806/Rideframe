// RIDEFRAME on a Garmin watch, 23.11.: the radio of the indoor trainer. Carries the actions of the link (Trainer.mc TLink.act, = js/watchtrainer.js
// L.act) to Toybox.BluetoothLowEnergy and the BleDelegate callbacks back into the flow as E_BLE events (RideframeApp.bleEv). The JS twin is the
// pretend KICKR of the preview (js/watchkickr.js); nothing here decides anything, so the tested state machine stays the one in Trainer.mc.
// Sources (garmin/README.md, "Indoor trainer"): Toybox.BluetoothLowEnergy (API 3.1.0; permission BluetoothLowEnergy): registerProfile
// ("the current limit is 3" profiles), setScanState / onScanResults, pairDevice (ScanResult -> Device, "does not persist across application
// instances"), onConnectedStateChanged, Characteristic.requestWrite (:writeType, max 20 bytes), Descriptor.requestWrite on cccdUuid(),
// onCharacteristicWrite / onDescriptorWrite / onCharacteristicChanged. The forum: one GATT operation at a time ("Operation already in progress").
import Toybox.BluetoothLowEnergy;
import Toybox.Lang;
import Toybox.System;

class TrainerBle extends BluetoothLowEnergy.BleDelegate {
    var app;
    var uFtms; var uIbd; var uFcp; var uCps; var uCpm; var uWcp;
    var regs as Number = 0;                 // profiles registered (FTMS, then Cycling Power + Wahoo); one at a time
    var regOk as Boolean = false;
    var scanning as Boolean = false;
    var wantScan as Boolean = false;        // a scan asked for before the profiles were registered
    var seen as Dictionary = {} as Dictionary;   // name -> the latest ScanResult (pairDevice needs one; a ScanResult cannot be stored)
    var dev = null;                         // BluetoothLowEnergy.Device of the trainer

    function initialize(a) {
        BleDelegate.initialize();
        app = a;
        var B = BluetoothLowEnergy;
        uFtms = B.stringToUuid("00001826-0000-1000-8000-00805f9b34fb");
        uIbd = B.stringToUuid("00002ad2-0000-1000-8000-00805f9b34fb");
        uFcp = B.stringToUuid("00002ad9-0000-1000-8000-00805f9b34fb");
        uCps = B.stringToUuid("00001818-0000-1000-8000-00805f9b34fb");
        uCpm = B.stringToUuid("00002a63-0000-1000-8000-00805f9b34fb");
        uWcp = B.stringToUuid("a026e005-0a7d-4ab3-97fa-f1500f9feb8b");
        B.setDelegate(self);
        register();
    }
    // two profiles of the three allowed, one after the other (a second registerProfile before the first answered failed on some
    // watches: forum "onprofileregister returns status value 2 on every 2nd and 3rd registerprofile"). Only registered characteristics
    // and descriptors can be used, so each carries the CCCD.
    // VERIFY (BluetoothLowEnergy.registerProfile): the dictionary keys :uuid / :characteristics / :descriptors and the exception type
    function register() as Void {
        var B = BluetoothLowEnergy, c = [B.cccdUuid()];
        try {
            if (regs == 0) {
                B.registerProfile({ :uuid => uFtms, :characteristics => [{ :uuid => uIbd, :descriptors => c }, { :uuid => uFcp, :descriptors => c }] });
            } else if (regs == 1) {
                B.registerProfile({ :uuid => uCps, :characteristics => [{ :uuid => uCpm, :descriptors => c }, { :uuid => uWcp, :descriptors => c }] });
            }
        } catch (e) { System.println("ble: profile " + regs.toString() + " not registered"); regs = 2; regOk = false; }
    }
    function onProfileRegister(uuid, status) as Void {
        regs++;
        if (status == BluetoothLowEnergy.STATUS_SUCCESS) { regOk = true; } else { System.println("ble: profile status " + status.toString()); }
        if (regs < 2) { register(); return; }
        if (wantScan) { setScan(true); }
    }
    function setScan(on as Boolean) as Void {
        wantScan = on;
        if (on && regs < 2) { return; } // after the profiles (VERIFY: scanning works before they are registered too)
        if (on == scanning) { return; }
        scanning = on;
        BluetoothLowEnergy.setScanState(on ? BluetoothLowEnergy.SCAN_STATE_SCANNING : BluetoothLowEnergy.SCAN_STATE_OFF);
        if (on) { seen = {} as Dictionary; }
    }
    // the actions of the link, in order (Trainer.mc TLink.act); at most one cccd / write among them at a time (the link sees to it)
    // An event raised right here (a failed pair or write calls app.bleEv, which drains and comes back to run) does not run its actions
    // in the middle of these: busy keeps them in L.act, and the loop takes them after the current ones, in order.
    var busy as Boolean = false;
    function run(L as TLink) as Void {
        if (busy) { return; }
        busy = true;
        while (L.act.size() > 0) {
            var acts = L.act;
            L.act = [] as Array<Dictionary>;
            for (var i = 0; i < acts.size(); i++) {
                var x = acts[i], k = strOf(x["k"]);
                try {
                    if (k.equals("scan")) { setScan(x["on"] == true); }
                    else if (k.equals("pair")) { pair(strOf(x["name"])); }
                    else if (k.equals("unpair")) { unpair(); }
                    else if (k.equals("cccd") || k.equals("write")) { gatt(k.equals("cccd"), strOf(x["ch"]), arrOf(x["v"])); }
                } catch (e) { System.println("ble: " + k + " failed"); } // a write is timed out by the link (T_OP_S)
            }
        }
        busy = false;
    }
    function pair(name as String) as Void {
        var r = seen[name];
        if (r == null) { app.bleEv({ "k" => "drop" }); return; } // not in this scan: the link tries again
        try { dev = BluetoothLowEnergy.pairDevice(r as BluetoothLowEnergy.ScanResult); }
        catch (e) { dev = null; } // DevicePairException: too many paired devices, or unknown
        if (dev == null) { app.bleEv({ "k" => "drop" }); }
        // connected: onConnectedStateChanged (VERIFY: it comes after pairDevice; forum "onConnectedStateChanged is never called after a ble pairing
        // request" was a device already paired to the phone)
    }
    function unpair() as Void {
        var d = dev; dev = null;
        if (d != null) { try { BluetoothLowEnergy.unpairDevice(d); } catch (e) { } }
    }
    function bytes(v as Array) as ByteArray {
        var b = new [v.size()]b;
        for (var i = 0; i < v.size(); i++) { b[i] = numOf(v[i]); }
        return b;
    }
    function charOf(ch as String) {
        var d = dev;
        if (d == null) { return null; }
        var s = null, u = null;
        if (ch.equals("ibd")) { s = d.getService(uFtms); u = uIbd; }
        else if (ch.equals("fcp")) { s = d.getService(uFtms); u = uFcp; }
        else if (ch.equals("cpm")) { s = d.getService(uCps); u = uCpm; }
        else if (ch.equals("wcp")) { s = d.getService(uCps); u = uWcp; }
        return s != null ? s.getCharacteristic(u) : null;
    }
    // one GATT operation: subscribe (CCCD 01 00 notify, 02 00 indicate) or write with response; its answer is the link's "done"
    function gatt(cccd as Boolean, ch as String, v as Array) as Void {
        var c = charOf(ch);
        try {
            if (c == null) { app.bleEv({ "k" => "done", "ok" => false }); return; }
            if (cccd) {
                var d = c.getDescriptor(BluetoothLowEnergy.cccdUuid());
                if (d == null) { app.bleEv({ "k" => "done", "ok" => false }); return; }
                d.requestWrite(bytes(v));
            } else {
                c.requestWrite(bytes(v), { :writeType => BluetoothLowEnergy.WRITE_TYPE_WITH_RESPONSE });
            }
        } catch (e) { app.bleEv({ "k" => "done", "ok" => false }); } // InvalidRequestException ("Operation already in progress", over 20 bytes)
    }

    // ---- the callbacks ----
    // VERIFY on the fenix 8: the KICKR Core 2 advertises 0x1826 in its advertising data and its name in the scan response (getDeviceName may be
    // null on the first result; the next one has it)
    function onScanResults(results) as Void {
        var l = [] as Array<Dictionary>;
        for (var r = results.next(); r != null; r = results.next()) {
            var sr = r as BluetoothLowEnergy.ScanResult, n = sr.getDeviceName(), ftms = false, cps = false;
            var us = sr.getServiceUuids();
            for (var u = us.next(); u != null; u = us.next()) { if (u.equals(uFtms)) { ftms = true; } else if (u.equals(uCps)) { cps = true; } }
            if (n == null || !(ftms || cps)) { continue; }
            seen[n] = sr;
            l.add({ "name" => n, "ftms" => ftms, "cps" => cps, "rssi" => sr.getRssi() });
        }
        if (l.size() > 0) { app.bleEv({ "k" => "found", "list" => l }); }
    }
    function onConnectedStateChanged(device, state) as Void {
        if (dev == null || !device.equals(dev)) { return; } // VERIFY: Device.equals tells the same device (else compare names)
        if (state == BluetoothLowEnergy.CONNECTION_STATE_CONNECTED) {
            var w = false, s = device.getService(uCps);
            if (s != null) { w = s.getCharacteristic(uWcp) != null; }
            app.bleEv({ "k" => "conn", "ftms" => device.getService(uFtms) != null, "wahoo" => w });
        } else {
            app.bleEv({ "k" => "drop" });
        }
    }
    function onDescriptorWrite(descriptor, status) as Void { app.bleEv({ "k" => "done", "ok" => status == BluetoothLowEnergy.STATUS_SUCCESS }); }
    function onCharacteristicWrite(characteristic, status) as Void { app.bleEv({ "k" => "done", "ok" => status == BluetoothLowEnergy.STATUS_SUCCESS }); }
    // notifications (Indoor Bike Data, Cycling Power) and indications (the control point's answers)
    function onCharacteristicChanged(characteristic, value) as Void {
        var u = characteristic.getUuid(), ch = "";
        if (u.equals(uIbd)) { ch = "ibd"; } else if (u.equals(uFcp)) { ch = "fcp"; } else if (u.equals(uCpm)) { ch = "cpm"; } else if (u.equals(uWcp)) { ch = "wcp"; }
        if (ch.length() > 0) { app.bleEv({ "k" => "ind", "ch" => ch, "v" => value }); }
    }
    // the app closes: no scan, no trainer held (another app can take it)
    function close() as Void { if (scanning) { setScan(false); } unpair(); }
}
